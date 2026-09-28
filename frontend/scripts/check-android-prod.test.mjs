// Proves check-android-prod.mjs still catches what it exists to catch. CI runs
// it before the real prod sync, where the check can only ever pass.
//   node scripts/check-android-prod.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const script = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'check-android-prod.mjs');

function project({ config, manifest = '<manifest><application/></manifest>', staleBuild = false }) {
  const root = mkdtempSync(path.join(tmpdir(), 'vv-android-'));
  mkdirSync(path.join(root, 'app/src/main/assets'), { recursive: true });
  if (config) writeFileSync(path.join(root, 'app/src/main/assets/capacitor.config.json'), JSON.stringify(config));
  writeFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), manifest);
  if (staleBuild) {
    mkdirSync(path.join(root, 'app/build/intermediates'), { recursive: true });
    writeFileSync(path.join(root, 'app/build/intermediates/AndroidManifest.xml'), '<application android:usesCleartextTraffic="true"/>');
  }
  return root;
}
const run = (root) => spawnSync(process.execPath, [script, root], { encoding: 'utf8' });

const cases = [
  ['a clean prod sync passes', { config: { appId: 'x' } }, 0],
  ['stale gradle output is ignored', { config: { appId: 'x' }, staleBuild: true }, 0],
  ['server.cleartext fails', { config: { server: { cleartext: true } } }, 1],
  ['allowMixedContent fails', { config: { android: { allowMixedContent: true } } }, 1],
  ['server.url fails', { config: { server: { url: 'http://10.0.2.2:5173' } } }, 1],
  ['an http androidScheme fails', { config: { server: { androidScheme: 'http' } } }, 1],
  ['allowNavigation fails', { config: { server: { allowNavigation: ['*.example.com'] } } }, 1],
  ['a cleartext manifest fails', { config: {}, manifest: '<application android:usesCleartextTraffic="true"/>' }, 1],
  ['a missing sync fails', {}, 1],
];
for (const [name, spec, expected] of cases) {
  const root = project(spec);
  try {
    assert.equal(run(root).status, expected, name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log(`check-android-prod.test.mjs passed (${cases.length} cases)`);
