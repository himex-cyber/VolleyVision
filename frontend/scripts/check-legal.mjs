// The legal pages (public/*.html, 9.2) are static files Vite copies as they
// are, so they can't import the values in src/lib/legal.ts. This fails if the
// two disagree: the company, the support email, and the Terms version (also
// backend/src/lib/terms.ts, which decides who must accept again).
//   node scripts/check-legal.mjs [--release]
// --release (Android release builds, Codemagic, deploy.ps1 prod) also refuses
// the SUPPORT_EMAIL_TBD placeholder and any "TO CONFIRM" left in a page.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const front = path.join(here, '..');
const read = (p) => readFileSync(p, 'utf8');
const constant = (src, name) => new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(src)?.[1];

const legal = read(path.join(front, 'src/lib/legal.ts'));
const entity = constant(legal, 'LEGAL_ENTITY');
const email = constant(legal, 'SUPPORT_EMAIL');
const version = constant(legal, 'TERMS_VERSION');
const backendVersion = constant(read(path.join(front, '../backend/src/lib/terms.ts')), 'CURRENT_TERMS_VERSION');

const problems = [];
if (!entity || !email || !version) problems.push('src/lib/legal.ts: LEGAL_ENTITY, SUPPORT_EMAIL and TERMS_VERSION must all be set');
if (version !== backendVersion) problems.push(`Terms version ${version} in legal.ts, ${backendVersion} in backend/src/lib/terms.ts`);
if (process.argv.includes('--release') && /TBD/.test(email ?? '')) problems.push('the support email is still a placeholder (SUPPORT_EMAIL_TBD): set it in src/lib/legal.ts and the pages');

for (const page of ['privacy', 'terms', 'delete-account', 'support']) {
  const file = path.join(front, 'public', `${page}.html`);
  if (!existsSync(file)) { problems.push(`public/${page}.html is missing`); continue; }
  const html = read(file);
  if (entity && !html.includes(entity)) problems.push(`public/${page}.html doesn't name ${entity}`);
  if (email && !html.includes(email)) problems.push(`public/${page}.html doesn't give ${email}`);
  // Facts the code can't show are drafted as "TO CONFIRM"; none may ship.
  if (process.argv.includes('--release') && html.includes('TO CONFIRM')) problems.push(`public/${page}.html still has a TO CONFIRM`);
}
const terms = existsSync(path.join(front, 'public/terms.html')) ? read(path.join(front, 'public/terms.html')) : '';
if (version && !terms.includes(`data-terms-version="${version}"`)) problems.push(`public/terms.html isn't marked data-terms-version="${version}"`);

if (problems.length) {
  console.error(`Legal pages check FAILED:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`Legal pages check passed: ${entity}, ${email}, Terms ${version}.`);
