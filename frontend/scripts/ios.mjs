// Builds the web app for the iOS shell and copies it into ios/.
//   node scripts/ios.mjs prod    release build against production
// There is no local mode: there's no Mac or simulator here, and App Transport
// Security blocks the plain http:// a PC's API would need. CAP_ENV is always
// cleared so capacitor.config.ts can't add its emulator-only cleartext, and
// check-ios-prod.mjs proves the result. `cap sync ios` only copies files and
// rewrites the SPM package list, so it runs on Windows and Linux too.
import { spawnSync } from 'node:child_process';

if (process.argv[2] !== 'prod') {
  console.error('Usage: node scripts/ios.mjs prod');
  process.exit(1);
}
const env = { ...process.env };
delete env.CAP_ENV;

for (const cmd of ['npm run build:native:prod', 'npx cap sync ios']) {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
