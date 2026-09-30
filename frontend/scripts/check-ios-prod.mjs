// Run after `npm run ios:prod` (CI, and Codemagic before every TestFlight
// build): fails if the synced iOS project could reach production with dev-only
// settings. Capacitor writes them at sync time into
// ios/App/App/capacitor.config.json; App Transport Security exceptions in
// Info.plist would let the app talk plain http. There is no Mac here, so this
// is the only check the project gets before Codemagic builds it.
//   node scripts/check-ios-prod.mjs [iosDir]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
// Already installed as a dependency of @capacitor/cli; no new package.
import plist from 'plist';

const root = process.argv[2] ?? 'ios';
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
    warnings.push('the web inspector is on (CAP_IOS_INSPECTABLE=1): fine for internal TestFlight, off for any external or App Store build');
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
}

for (const w of warnings) console.warn(`WARNING: ${w}`);
if (problems.length) {
  console.error(`iOS prod-config check FAILED:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('iOS prod-config check passed: no remote server URL, no cleartext, default origin, no ATS exceptions.');
