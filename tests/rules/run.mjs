// Runs the Firestore security-rules tests (tests/rules/*.test.mjs) against a Firestore emulator on
// its own ports (see rules/firebase.json: firestore 8180, websocket 9250, hub 4410, logging 4510),
// so it can run next to the app's emulators on the default ports.
//   cd tests && npm run test:rules
// Needs Java: JAVA_HOME, or `java` on the PATH.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(here, '..');
const win = process.platform === 'win32';

// ---- Java ----
const env = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
if (env.JAVA_HOME) {
  const bin = path.join(env.JAVA_HOME, 'bin');
  if (!fs.existsSync(path.join(bin, win ? 'java.exe' : 'java'))) {
    console.error(`JAVA_HOME is set to "${env.JAVA_HOME}", but ${path.join(bin, 'java')} does not exist.`);
    process.exit(2);
  }
  env[pathKey] = bin + path.delimiter + (env[pathKey] || '');
}
const java = spawnSync('java', ['-version'], { env, stdio: 'ignore', shell: false });
if (java.error || java.status !== 0) {
  console.error('Java was not found. The Firestore emulator needs Java 11+:\n'
    + '  set JAVA_HOME to a JDK/JRE folder, or put `java` on the PATH, then run `npm run test:rules` again.');
  process.exit(2);
}

// ---- test files (one at a time: they share the emulator and clear it between tests) ----
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()
  .map((f) => path.join('rules', f).replace(/\\/g, '/'));
if (!files.length) { console.error('no tests in tests/rules'); process.exit(2); }
const inner = ['node', '--test', '--test-concurrency=1', ...files].join(' ');

const firebaseBin = path.join(testsDir, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
// uuid-shim.cjs: works around firebase-tools' universal-analytics → uuid 14 (ESM-only) on Node < 20.19
const args = ['-r', path.join(here, 'uuid-shim.cjs'), firebaseBin, 'emulators:exec', '--only', 'firestore', '--project', 'demo-rules',
  '--config', path.join('rules', 'firebase.json'), inner];
const r = spawnSync(process.execPath, args, { cwd: testsDir, env, stdio: 'inherit' });
if (r.error) { console.error(r.error); process.exit(1); }
process.exit(r.status == null ? 1 : r.status);
