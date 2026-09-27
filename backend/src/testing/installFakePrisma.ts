// Side-effect import: puts a fake module into require.cache at the resolved
// path of src/lib/prisma.ts, so any later `require`/`import` of it (by
// services, middleware, ...) gets the fake instead of ever constructing a real
// PrismaClient. Must be imported FIRST in a test file, before anything that
// transitively imports lib/prisma — CommonJS import order is preserved by
// ts-node, so this only works if it runs before those requires happen.
import Module from 'module';
import { db, resetDb, callsFor } from './fakePrisma';

const prismaPath = require.resolve('../lib/prisma');

const fakeExports = {
  prisma: db,
  runSerializable: async (fn: (tx: any) => any) => fn(db),
};

const fakeModule = new (Module as unknown as { new (id: string, parent?: NodeModule): NodeModule })(
  prismaPath,
  module,
);
fakeModule.filename = prismaPath;
fakeModule.loaded = true;
fakeModule.exports = fakeExports;

require.cache[prismaPath] = fakeModule;

export { db, resetDb, callsFor };
