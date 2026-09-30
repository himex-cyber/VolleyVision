/**
 * Deletes an account on request by email (9.4; the web route on
 * /delete-account). Karlos checks the request came from the account's own
 * address first. Runs the same deletion as Profile → Delete account, minus the
 * password.
 *
 *   Local:      DATABASE_URL=postgresql://…@localhost… npx ts-node scripts/delete-account.ts --email <address> [--apply]
 *   Production: npx ts-node scripts/delete-account.ts --prod --email <address> [--apply]   (backend/.env; backup first)
 *
 * A dry run by default: what would be removed, as counts. Refuses, like the
 * app, while the account owns a team. Prints the database's project ref, never
 * its URL.
 */
import path from 'node:path';
import { adminScriptTarget, projectRef } from '../src/lib/adminScript';

async function main() {
  // Before anything loads Prisma or dotenv (see lib/adminScript.ts).
  const argv = process.argv.slice(2);
  const target = adminScriptTarget(argv, process.env);
  if ('error' in target) {
    console.error(target.error);
    process.exit(1);
  }
  const emailArg = argv[argv.indexOf('--email') + 1];
  if (!argv.includes('--email') || !emailArg || emailArg.startsWith('--')) {
    console.error('Usage: npx ts-node scripts/delete-account.ts [--prod] --email <address> [--apply]');
    process.exit(1);
  }
  Object.assign(process.env, target.env);
  if (target.prod) (await import('dotenv')).config({ path: path.join(__dirname, '..', '.env') });

  const { prisma } = await import('../src/lib/prisma');
  const { normalizeEmail } = await import('../src/lib/email');
  const { deleteAccount, planAccountDeletion } = await import('../src/services/accountDeletion.service');
  const { blockersMessage } = await import('../src/lib/accountDeletion');
  console.log(`Database: ${projectRef(process.env.DATABASE_URL)}${target.prod ? ' (production, from backend/.env)' : ''}`);

  try {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(emailArg) }, select: { id: true } });
    if (!user) {
      console.log('No account uses that address. Nothing to do.');
      return;
    }
    const plan = await planAccountDeletion(user.id);
    if (!plan) return;
    if (plan.blockers.length) {
      console.log(`Refused: ${blockersMessage(plan.blockers)}`);
      console.log('Reply asking them to transfer or delete those teams first (Team → Settings), then run this again.');
      process.exitCode = 1;
      return;
    }
    console.log(`Would delete the account and: ${plan.messages} message(s) erased, ${plan.files} file(s) removed, `
      + `${plan.players} player record(s) renamed "Former player", ${plan.invitations} invitation(s) deleted, `
      + `${plan.auditRows} audit row(s) anonymised.`);
    if (!target.apply) {
      console.log('Dry run: nothing changed. Run again with --apply to delete it.');
      return;
    }
    await deleteAccount(user.id);
    console.log('Deleted. A confirmation email was sent to the old address (if email is set up). Reply to their request to say it\'s done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
