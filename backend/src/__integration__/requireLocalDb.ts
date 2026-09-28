// Side-effect import: must be the FIRST import of every integration file, so it
// runs before anything loads dotenv or Prisma. Run directly (not through
// npm run test:integration), those files would otherwise pick up backend/.env,
// which is production.
import { localDbUrlError } from '../lib/localDb';

const error = localDbUrlError(process.env);
if (error) {
  console.error(error);
  process.exit(1);
}
