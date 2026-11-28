// app/js/lectionary.js (daily Mass readings) holds only references: every one must point at verses
// that app/js/data.js has, or the readings window shows "not in the app yet" for them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readApp } from './lib/env.mjs';

const ctx = { window: {} };
vm.runInNewContext(readApp('data.js'), ctx);
vm.runInNewContext(readApp('lectionary.js'), ctx);
const books = new Map(ctx.window.BIBLE_DATA.books.map((b) => [b.id, b]));
const days = ctx.window.LECTIONARY.days;

// verses the bundled text doesn't have yet (the readings window lists them as missing)
// (Psalm 103 has only verses 1-4 so far; Luke 2:30-31 is one sentence in this translation, printed as verse 30)
const KNOWN_MISSING = new Set(['PSA 103:8', 'PSA 103:10', 'LUK 2:31']);

const has = (id, c, v) => {
  const b = books.get(id);
  return !!(b && b.chapters[c] && b.chapters[c].some((it) => it.v === v));
};
const segments = (ref) => ref.split(';').flatMap((part) => {
  const [c, vs] = part.trim().split(':');
  return vs.split(',').map((r) => { const [a, z] = r.trim().split('-').map(Number); return [+c, a, z || a]; });
});

test('lectionary days are in date order, one per day, with a known colour', () => {
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    assert.match(d.d, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['green', 'white', 'red', 'violet', 'rose'].includes(d.c), `${d.d}: colour ${d.c}`);
    assert.ok(d.t && d.s, `${d.d}: title and season`);
    assert.ok(d.r.some((r) => r[0] === 'gospel'), `${d.d}: a gospel`);
    if (i) {
      const gap = (Date.parse(d.d) - Date.parse(days[i - 1].d)) / 864e5;
      assert.equal(gap, 1, `${days[i - 1].d} → ${d.d}`);
    }
  }
});

test('every reading and verse of the day is in the bundled text', () => {
  const missing = [];
  for (const d of days) {
    for (const [kind, id, ref] of d.r) {
      assert.ok(['first', 'psalm', 'second', 'gospel'].includes(kind), `${d.d}: kind ${kind}`);
      assert.ok(books.has(id), `${d.d}: book ${id}`);
      for (const [c, a, z] of segments(ref)) {
        assert.ok(a <= z, `${d.d}: ${id} ${ref}`);
        for (let v = a; v <= z; v++) if (!has(id, c, v) && !KNOWN_MISSING.has(`${id} ${c}:${v}`)) missing.push(`${d.d} ${id} ${c}:${v}`);
      }
    }
    const m = /^(\S+) (\d+):(\d+)(?:-(\d+))?$/.exec(d.w || '');
    assert.ok(m, `${d.d}: verse of the day ${d.w}`);
    for (let v = +m[3]; v <= +(m[4] || m[3]); v++) if (!has(m[1], +m[2], v)) missing.push(`${d.d} w ${d.w}`);
  }
  assert.deepEqual(missing, []);
});
