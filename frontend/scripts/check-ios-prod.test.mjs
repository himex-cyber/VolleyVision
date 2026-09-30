// Proves check-ios-prod.mjs still catches what it exists to catch. CI runs it
// before the real prod sync, where the check can only ever pass.
//   node scripts/check-ios-prod.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import plist from 'plist';

const script = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'check-ios-prod.mjs');

const goodPlist = { CFBundleDisplayName: 'VolleyVision' };

function project({ config, info = goodPlist, rawInfo }) {
  const root = mkdtempSync(path.join(tmpdir(), 'vv-ios-'));
  const app = path.join(root, 'App/App');
  mkdirSync(app, { recursive: true });
  if (config) writeFileSync(path.join(app, 'capacitor.config.json'), JSON.stringify(config));
  if (rawInfo !== undefined) writeFileSync(path.join(app, 'Info.plist'), rawInfo);
  else if (info) writeFileSync(path.join(app, 'Info.plist'), plist.build(info));
  return root;
}
const run = (root) => spawnSync(process.execPath, [script, root], { encoding: 'utf8' });

const cases = [
  ['a clean prod sync passes', { config: { appId: 'x' } }, 0],
  ['server.url fails', { config: { server: { url: 'http://192.168.1.2:5173' } } }, 1],
  ['server.cleartext fails', { config: { server: { cleartext: true } } }, 1],
  ['allowNavigation fails', { config: { server: { allowNavigation: ['*.example.com'] } } }, 1],
  ['a custom iosScheme fails', { config: { server: { iosScheme: 'https' } } }, 1],
  ['a custom hostname fails', { config: { server: { hostname: 'app.example.com' } } }, 1],
  ['NSAllowsArbitraryLoads fails', { config: {}, info: { ...goodPlist, NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } } }, 1],
  ['NSAllowsArbitraryLoadsInWebContent fails', { config: {}, info: { ...goodPlist, NSAppTransportSecurity: { NSAllowsArbitraryLoadsInWebContent: true } } }, 1],
  ['NSAllowsLocalNetworking fails', { config: {}, info: { ...goodPlist, NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } }, 1],
  ['an insecure exception domain fails', { config: {}, info: { ...goodPlist, NSAppTransportSecurity: { NSExceptionDomains: { 'example.com': { NSExceptionAllowsInsecureHTTPLoads: true } } } } }, 1],
  ['ATS switched off explicitly (false) passes', { config: {}, info: { ...goodPlist, NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } } }, 0],
  ['a missing sync fails', {}, 1],
  ['a missing Info.plist fails', { config: {}, info: null }, 1],
  ['an Info.plist that does not parse fails', { config: {}, rawInfo: '<plist><dict><key>x</key>' }, 1],
];
for (const [name, spec, expected] of cases) {
  const root = project(spec);
  try {
    assert.equal(run(root).status, expected, name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The web inspector (8.5.6) is allowed for internal TestFlight builds, so it
// only warns; Phase 9 turns it off for anything external.
{
  const root = project({ config: { ios: { webContentsDebuggingEnabled: true } } });
  try {
    const r = run(root);
    assert.equal(r.status, 0, 'the inspector alone does not fail');
    assert.match(r.stdout + r.stderr, /WARNING.*inspect/i, 'but it warns');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log(`check-ios-prod.test.mjs passed (${cases.length + 1} cases)`);
