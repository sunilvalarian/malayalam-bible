// functions/api/where.js — GET /api/where (Cloudflare Pages Function).
// functions/ has no package.json, so the files are copied (unchanged) into a temp folder that
// declares "type": "module", keeping the ../_lib/util.js import working.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/env.mjs';

let dir, onRequestGet;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'where-test-'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.mkdirSync(path.join(dir, '_lib'));
  fs.copyFileSync(path.join(ROOT, 'functions', 'api', 'where.js'), path.join(dir, 'api', 'where.js'));
  fs.copyFileSync(path.join(ROOT, 'functions', '_lib', 'util.js'), path.join(dir, '_lib', 'util.js'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }');
  ({ onRequestGet } = await import(pathToFileURL(path.join(dir, 'api', 'where.js')).href));
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const call = async (headers = {}, cf) => {
  const request = new Request('https://bible.example.org/api/where', { headers });
  if (cf !== undefined) Object.defineProperty(request, 'cf', { value: cf });
  const res = await onRequestGet({ request, env: {} });
  return { res, body: await res.json() };
};

describe('functions/api/where.js', () => {
  test('JSON with ip + request.cf fields; no-store', async () => {
    const { res, body } = await call(
      { 'CF-Connecting-IP': '203.0.113.7' },
      { country: 'IN', region: 'Kerala', city: 'Kochi', asOrganization: 'Example Broadband', colo: 'BOM' },
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(body, { ip: '203.0.113.7', country: 'IN', region: 'Kerala', city: 'Kochi', isp: 'Example Broadband' });
  });
  test('CF-Connecting-IP wins over X-Forwarded-For and X-Real-IP', async () => {
    const { body } = await call({ 'CF-Connecting-IP': '198.51.100.1', 'X-Forwarded-For': '10.0.0.1', 'X-Real-IP': '10.0.0.2' });
    assert.equal(body.ip, '198.51.100.1');
  });
  test('then the first X-Forwarded-For entry (trimmed)', async () => {
    const { body } = await call({ 'X-Forwarded-For': '  192.0.2.44 , 10.0.0.1, 10.0.0.2', 'X-Real-IP': '10.0.0.3' });
    assert.equal(body.ip, '192.0.2.44');
  });
  test('then X-Real-IP', async () => {
    assert.equal((await call({ 'X-Real-IP': '192.0.2.9' })).body.ip, '192.0.2.9');
    assert.equal((await call({ 'X-Forwarded-For': ' ', 'X-Real-IP': '192.0.2.9' })).body.ip, '192.0.2.9');
  });
  test('nothing known (local dev server: no request.cf) → empty strings', async () => {
    const { body } = await call();
    assert.deepEqual(body, { ip: '', country: '', region: '', city: '', isp: '' });
  });
  test('partial request.cf', async () => {
    const { body } = await call({ 'X-Real-IP': '::1' }, { country: 'AE' });
    assert.deepEqual(body, { ip: '::1', country: 'AE', region: '', city: '', isp: '' });
  });
});
