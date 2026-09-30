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

const goodPlist = {
  CFBundleDisplayName: 'VolleyVision',
  ITSAppUsesNonExemptEncryption: false,
  NSCameraUsageDescription: 'VolleyVision uses the camera so you can take a photo to share in team chat.',
  NSPhotoLibraryUsageDescription: 'VolleyVision uses your photo library so you can share photos in team chat.',
};
// Both build configurations of the project and of the App target.
const goodPbx = [1, 2, 3, 4].map(() => 'IPHONEOS_DEPLOYMENT_TARGET = 16.4;').join('\n')
  + '\nTARGETED_DEVICE_FAMILY = 1;\nTARGETED_DEVICE_FAMILY = 1;\n';

// Just enough of a PNG header: byte 25 is the colour type (2 = RGB, 6 = RGBA).
const png = (colourType, extra = '') => { const b = Buffer.alloc(33); b[25] = colourType; return Buffer.concat([b, Buffer.from(extra)]); };

function project({ config, info = goodPlist, rawInfo, pbx = goodPbx, icon = png(2) }) {
  const root = mkdtempSync(path.join(tmpdir(), 'vv-ios-'));
  const app = path.join(root, 'App/App');
  mkdirSync(app, { recursive: true });
  mkdirSync(path.join(root, 'App/App.xcodeproj'), { recursive: true });
  const iconDir = path.join(app, 'Assets.xcassets/AppIcon.appiconset');
  mkdirSync(iconDir, { recursive: true });
  if (icon) writeFileSync(path.join(iconDir, 'AppIcon-512@2x.png'), icon);
  if (pbx != null) writeFileSync(path.join(root, 'App/App.xcodeproj/project.pbxproj'), pbx);
  if (config) writeFileSync(path.join(app, 'capacitor.config.json'), JSON.stringify(config));
  if (rawInfo !== undefined) writeFileSync(path.join(app, 'Info.plist'), rawInfo);
  // JSON round trip: a key set to undefined is left out, as if never written.
  else if (info) writeFileSync(path.join(app, 'Info.plist'), plist.build(JSON.parse(JSON.stringify(info))));
  return root;
}
const run = (root, ...flags) => spawnSync(process.execPath, [script, ...flags, root], { encoding: 'utf8' });

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
  // 8.5.3: settings a build can't do without.
  ['no camera text fails (Take Photo would crash the app)', { config: {}, info: { ...goodPlist, NSCameraUsageDescription: undefined } }, 1],
  ['no photo library text fails', { config: {}, info: { ...goodPlist, NSPhotoLibraryUsageDescription: '' } }, 1],
  ['export compliance as the string NO fails', { config: {}, info: { ...goodPlist, ITSAppUsesNonExemptEncryption: 'NO' } }, 1],
  ['no export compliance key fails', { config: {}, info: { ...goodPlist, ITSAppUsesNonExemptEncryption: undefined } }, 1],
  ['iPad support fails', { config: {}, pbx: goodPbx.replace('TARGETED_DEVICE_FAMILY = 1;', 'TARGETED_DEVICE_FAMILY = "1,2";') }, 1],
  ['iOS 15 fails', { config: {}, pbx: goodPbx.replace('16.4', '15.0') }, 1],
  ['another target on 16.4 passes', { config: {}, pbx: goodPbx + 'IPHONEOS_DEPLOYMENT_TARGET = 16.4;\n' }, 0],
  ['a missing project fails', { config: {}, pbx: null }, 1],
  // 8.5.4: the App Store rejects an app icon with an alpha channel.
  ['an icon with alpha fails', { config: {}, icon: png(6) }, 1],
  ['an RGB icon with a transparency chunk fails', { config: {}, icon: png(2, '....tRNS') }, 1],
  ['a missing icon fails', { config: {}, icon: null }, 1],
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

// A truncated Info.plist fails because it doesn't parse, not only because the
// keys checked later are missing.
{
  const truncated = plist.build(goodPlist).replace(/<\/dict>\s*<\/plist>\s*$/, '');
  const root = project({ config: {}, rawInfo: truncated });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not parse/, 'reported as a parse failure');
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
    // 9.9: the App Store workflow runs the check with --release, where it fails.
    const release = run(root, '--release');
    assert.equal(release.status, 1, 'a release build with the inspector on fails');
    assert.match(release.stderr, /inspector/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log(`check-ios-prod.test.mjs passed (${cases.length + 3} cases)`);
