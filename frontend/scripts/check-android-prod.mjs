// Run after `npm run android:prod` (CI, and before every release build):
// fails if the synced Android project could reach production with the
// emulator-only settings on. Capacitor writes them at sync time into
// android/app/src/main/assets/capacitor.config.json, and cleartext can also
// arrive through any AndroidManifest.xml (merged ones included once gradle has run).
//   node scripts/check-android-prod.mjs [androidDir]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'android';
const problems = [];

const configPath = path.join(root, 'app/src/main/assets/capacitor.config.json');
if (!existsSync(configPath)) {
  problems.push(`${configPath} is missing: run npm run android:prod first`);
} else {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.server?.cleartext === true) problems.push('capacitor.config.json: server.cleartext is true');
  if (config.android?.allowMixedContent === true) problems.push('capacitor.config.json: android.allowMixedContent is true');
  if (config.server?.url) problems.push(`capacitor.config.json: server.url is set (${config.server.url}); the app would load remote code`);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name === '.gradle') continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (name === 'AndroidManifest.xml' && /usesCleartextTraffic\s*=\s*"true"/.test(readFileSync(full, 'utf8'))) {
      problems.push(`${full}: usesCleartextTraffic="true"`);
    }
  }
}
if (existsSync(root)) walk(root);

if (problems.length) {
  console.error(`Android prod-config check FAILED:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('Android prod-config check passed: no cleartext, no mixed content, no remote server URL.');
