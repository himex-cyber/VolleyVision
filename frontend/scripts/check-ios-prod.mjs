// Run after `npm run ios:prod` (CI, and Codemagic before every TestFlight
// build): fails if the synced iOS project could reach production with dev-only
// settings. Capacitor writes them at sync time into
// ios/App/App/capacitor.config.json; App Transport Security exceptions in
// Info.plist would let the app talk plain http. There is no Mac here, so this
// is the only check the project gets before Codemagic builds it.
//   node scripts/check-ios-prod.mjs [--release] [iosDir]
// --release (the App Store workflow, 9.9) turns the web-inspector warning into
// a failure: only internal TestFlight builds may have it on.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
// Already installed as a dependency of @capacitor/cli; no new package.
import plist from 'plist';

const args = process.argv.slice(2);
const release = args.includes('--release');
const root = args.find((a) => !a.startsWith('--')) ?? 'ios';
const problems = [];
const warnings = [];

const configPath = path.join(root, 'App/App/capacitor.config.json');
if (!existsSync(configPath)) {
  problems.push(`${configPath} is missing: run npm run ios:prod first`);
} else {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const server = config.server ?? {};
  if (server.url) problems.push(`capacitor.config.json: server.url is set (${server.url}); the app would load remote code`);
  if (server.cleartext === true) problems.push('capacitor.config.json: server.cleartext is true');
  if (server.allowNavigation?.length) problems.push('capacitor.config.json: server.allowNavigation lets the WebView navigate to other hosts');
  // The API's CORS allowlist expects the default origin, capacitor://localhost.
  if (server.iosScheme) problems.push(`capacitor.config.json: server.iosScheme is set (${server.iosScheme}); keep the default capacitor://`);
  if (server.hostname) problems.push(`capacitor.config.json: server.hostname is set (${server.hostname}); keep the default localhost`);
  if (config.ios?.webContentsDebuggingEnabled === true) {
    if (release) problems.push('the web inspector is on (CAP_IOS_INSPECTABLE=1): a release build must not have it');
    else warnings.push('the web inspector is on (CAP_IOS_INSPECTABLE=1): fine for internal TestFlight, off for any external or App Store build');
  }
}

const infoPath = path.join(root, 'App/App/Info.plist');
let info = null;
if (!existsSync(infoPath)) {
  problems.push(`${infoPath} is missing`);
} else {
  try {
    info = plist.parse(readFileSync(infoPath, 'utf8'));
  } catch (err) {
    problems.push(`${infoPath} does not parse: ${err.message}`);
  }
}
if (info) {
  const ats = info.NSAppTransportSecurity ?? {};
  for (const key of ['NSAllowsArbitraryLoads', 'NSAllowsArbitraryLoadsInWebContent', 'NSAllowsLocalNetworking']) {
    if (ats[key] === true) problems.push(`Info.plist: NSAppTransportSecurity.${key} is true`);
  }
  for (const [domain, rules] of Object.entries(ats.NSExceptionDomains ?? {})) {
    if (rules?.NSExceptionAllowsInsecureHTTPLoads === true) problems.push(`Info.plist: ${domain} allows insecure http`);
  }
  // Chat and feedback file inputs offer Take Photo: without this text iOS
  // kills the app the moment it's chosen.
  for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    if (typeof info[key] !== 'string' || !info[key].trim()) problems.push(`Info.plist: ${key} is missing`);
  }
  // A boolean false (not the string NO) skips the export-compliance question on every upload.
  if (info.ITSAppUsesNonExemptEncryption !== false) problems.push('Info.plist: ITSAppUsesNonExemptEncryption must be <false/>');
}

// iPhone only (iPad would need its own screenshots and review) and iOS 16.4+
// (Web Locks, crypto.randomUUID, and the web inspector in release builds).
const pbxPath = path.join(root, 'App/App.xcodeproj/project.pbxproj');
if (!existsSync(pbxPath)) {
  problems.push(`${pbxPath} is missing`);
} else {
  const pbx = readFileSync(pbxPath, 'utf8');
  const values = (key) => [...pbx.matchAll(new RegExp(`${key} = ([^;]+);`, 'g'))].map((m) => m[1]);
  const families = values('TARGETED_DEVICE_FAMILY');
  if (!families.length || families.some((v) => v !== '1')) problems.push(`project.pbxproj: TARGETED_DEVICE_FAMILY must be 1 (iPhone only), found ${families.join(', ') || 'none'}`);
  const targets = values('IPHONEOS_DEPLOYMENT_TARGET');
  if (!targets.length || targets.some((v) => v !== '16.4')) problems.push(`project.pbxproj: IPHONEOS_DEPLOYMENT_TARGET must be 16.4 everywhere, found ${targets.join(', ') || 'none'}`);
}

// The App Store rejects an app icon with an alpha channel. PNG byte 25 is the
// colour type: 2 is RGB; 4 and 6 carry alpha, 3 (palette) can, and a tRNS
// chunk adds transparency to any of them.
const iconPath = path.join(root, 'App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const icon = existsSync(iconPath) ? readFileSync(iconPath) : null;
if (!icon) problems.push(`${iconPath} is missing`);
else if (icon[25] !== 2 || icon.includes('tRNS')) problems.push('AppIcon-512@2x.png is not plain RGB: flatten it (see assets/README.md)');

for (const w of warnings) console.warn(`WARNING: ${w}`);
if (problems.length) {
  console.error(`iOS prod-config check FAILED:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('iOS prod-config check passed: no remote server URL, no cleartext, default origin, no ATS exceptions, iPhone-only iOS 16.4 with its permission texts.');
