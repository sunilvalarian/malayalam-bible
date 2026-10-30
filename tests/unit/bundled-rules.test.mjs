// isBundled() in firestore.rules must list exactly the chapters in app/js/data.js: the app writes
// hasBase = "this chapter is bundled", and the rules refuse a chapter whose hasBase differs, so a
// book added to data.js but not to the rules can't be saved by anyone (permission-denied).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readApp } from './lib/env.mjs';

const ctx = { window: {} };
vm.runInNewContext(readApp('data.js'), ctx);
const bundled = new Map(ctx.window.BIBLE_DATA.books.map((b) => [b.id, new Set(Object.keys(b.chapters).map(Number))]));

// the body of isBundled(b, c) in firestore.rules, turned into JavaScript
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const body = rules.match(/function isBundled\(b, c\) \{\s*return ([\s\S]*?);\s*\}/)[1];
const isBundled = new Function('b', 'c', 'return ' + body
  .replace(/==/g, '===')
  .replace(/\bc in (\[[\d,\s]*\])/g, '$1.includes(c)'));

test('firestore.rules isBundled() matches the chapters in app/js/data.js', () => {
  const ids = new Set([...bundled.keys(), ...[...body.matchAll(/b == '(\w+)'/g)].map((m) => m[1])]);
  const wrong = [];
  for (const b of ids) {
    for (let c = 1; c <= 200; c++) {
      const inData = !!(bundled.get(b) && bundled.get(b).has(c));
      if (isBundled(b, c) !== inData) wrong.push(`${b} ${c}: ${inData ? 'in data.js, not in the rules' : 'in the rules, not in data.js'}`);
    }
  }
  assert.deepEqual(wrong, [], 'update isBundled() in firestore.rules and publish the rules');
});
