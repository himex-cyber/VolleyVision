// Builds the web app for the Android shell and copies it into android/.
//   node scripts/android.mjs local   emulator build against the local stack
//   node scripts/android.mjs prod    release build against production
// CAP_ENV=local is what lets capacitor.config.ts allow cleartext HTTP (the
// emulator reaches the PC's API over http://10.0.2.2). A prod sync never sets
// it, and check-android-prod.mjs proves the result. Plain Node rather than
// cross-env: the package is ESM and has no cross-env.
import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (target !== 'local' && target !== 'prod') {
  console.error('Usage: node scripts/android.mjs local|prod');
  process.exit(1);
}
const env = { ...process.env };
if (target === 'local') env.CAP_ENV = 'local';
else delete env.CAP_ENV;

for (const cmd of [`npm run build:native:${target}`, 'npx cap sync android']) {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
