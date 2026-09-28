// Browser end-to-end tests: starts the Firebase emulators (auth + firestore, repo firebase.json /
// firestore.rules) and the local Pages server (tools/dev-server.mjs), runs e2e/*.test.mjs with
// node:test one file at a time, and always shuts everything down again.
//
//   cd tests && npm run test:e2e            (needs Java 11+: JAVA_HOME or java on PATH, and Chrome/Edge)
//
// Environment: JAVA_HOME, CHROME_PATH (browser executable), E2E_PORT (dev server, default 8788),
// E2E_KEEP_LOGS=1 (print the emulator / server logs at the end), E2E_HEADFUL=1.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTS = path.resolve(HERE, '..');
const ROOT = path.resolve(TESTS, '..');
const LOGS = path.join(HERE, 'logs');
const PORT = +(process.env.E2E_PORT || 8788);
// the app hardcodes these two in app/js/cloud.js (?emulator)
const AUTH_PORT = 9099;
const FS_PORT = 8080;
const isWin = process.platform === 'win32';

function fail(msg) {
  console.error('\n[e2e] ' + msg + '\n');
  process.exit(2);
}

// ---------- Java (the Firestore emulator is a Java program) ----------
function findJava() {
  const exe = isWin ? 'java.exe' : 'java';
  if (process.env.JAVA_HOME) {
    const p = path.join(process.env.JAVA_HOME, 'bin', exe);
    if (fs.existsSync(p)) return { bin: path.dirname(p), how: 'JAVA_HOME' };
    fail(`JAVA_HOME is set to ${process.env.JAVA_HOME}, but ${p} does not exist.`);
  }
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8' });
  if (!r.error && r.status === 0) return { bin: null, how: 'PATH' };
  fail('Java was not found. The Firestore emulator needs Java 11 or newer: install a JDK/JRE and put java on PATH, or set JAVA_HOME.');
}

// ---------- browser ----------
function findBrowser() {
  const c = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) fail('No Chrome / Edge found. Set CHROME_PATH to the browser executable.');
  return hit;
}

const portFree = (port, host = '127.0.0.1') => new Promise((res) => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.once('listening', () => s.close(() => res(true)));
  s.listen(port, host);
});

async function waitHttp(url, ms, proc, name) {
  const end = Date.now() + ms;
  for (;;) {
    if (proc && proc.exitCode != null) throw new Error(`${name} exited early (code ${proc.exitCode}), see ${LOGS}`);
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch (e) { /* not up yet */ }
    if (Date.now() > end) throw new Error(`${name} did not answer at ${url} within ${ms / 1000} s, see ${LOGS}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const children = [];
function killTree(p) {
  if (!p || p.exitCode != null || p.killed && p.exitCode != null) return;
  try {
    if (isWin) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-p.pid, 'SIGTERM');
  } catch (e) { /* already gone */ }
}
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const p of children.reverse()) killTree(p);
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => { cleanup(); process.exit(130); });
}
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

function start(name, cmd, args, opts) {
  const log = fs.openSync(path.join(LOGS, name + '.log'), 'w');
  const p = spawn(cmd, args, Object.assign({ stdio: ['ignore', log, log], detached: !isWin, windowsHide: true }, opts));
  children.push(p);
  return p;
}

async function main() {
  fs.mkdirSync(LOGS, { recursive: true });
  const java = findJava();
  const browser = findBrowser();
  for (const [port, what] of [[AUTH_PORT, 'auth emulator'], [FS_PORT, 'firestore emulator'], [PORT, 'dev server']]) {
    if (!(await portFree(port))) fail(`Port ${port} (${what}) is already in use. Stop whatever runs there (another emulator / dev server?) and try again.`);
  }
  const env = Object.assign({}, process.env);
  if (java.bin) env.PATH = java.bin + path.delimiter + (env.PATH || env.Path || '');
  if (isWin && env.Path && java.bin) env.Path = env.PATH;

  console.log(`[e2e] java from ${java.how}; browser ${browser}`);
  console.log('[e2e] starting emulators (auth :9099, firestore :8080) …');
  const firebaseBin = path.join(TESTS, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  // cwd = e2e/logs, so firestore-debug.log etc. land there and not in the repository
  // uuid-shim.cjs: firebase-tools' universal-analytics → uuid 14 (ESM-only) fails on Node < 20.19
  const emu = start('emulators', process.execPath, ['-r', path.join(HERE, 'uuid-shim.cjs'), firebaseBin,'emulators:start', '--only', 'auth,firestore', '--project', 'demo-bible', '--config', path.join(ROOT, 'firebase.json')], { cwd: LOGS, env });
  console.log(`[e2e] starting dev server on :${PORT} …`);
  const dev = start('dev-server', process.execPath, [path.join(ROOT, 'tools', 'dev-server.mjs'), String(PORT)], {
    cwd: ROOT, env: Object.assign({}, env, { FIREBASE_EMULATOR_HOST_FIRESTORE: `127.0.0.1:${FS_PORT}`, FIREBASE_PROJECT_ID: 'demo-bible' }),
  });
  await waitHttp(`http://localhost:${PORT}/`, 20000, dev, 'dev server');
  await waitHttp(`http://127.0.0.1:${FS_PORT}/`, 90000, emu, 'firestore emulator');
  await waitHttp(`http://127.0.0.1:${AUTH_PORT}/`, 30000, emu, 'auth emulator');
  console.log('[e2e] emulators and dev server are up\n');

  const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort()
    .filter((f) => !process.argv[2] || f.includes(process.argv[2]))
    .map((f) => path.join(HERE, f));
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files], {
    cwd: TESTS, stdio: 'inherit',
    env: Object.assign({}, env, { E2E_BASE: `http://localhost:${PORT}`, E2E_BROWSER: browser }),
  });
  if (process.env.E2E_KEEP_LOGS) {
    for (const f of ['emulators.log', 'dev-server.log']) {
      console.log(`\n----- ${f} -----\n` + fs.readFileSync(path.join(LOGS, f), 'utf8').slice(-8000));
    }
  }
  cleanup();
  process.exit(r.status == null ? 1 : r.status);
}

main().catch((e) => { console.error('[e2e]', e.message || e); cleanup(); process.exit(1); });
