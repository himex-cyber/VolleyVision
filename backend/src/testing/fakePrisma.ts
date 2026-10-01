// Hand-rolled fake Prisma client for tests (see installFakePrisma.ts for how it
// replaces the real one). Every model is created on demand via a Proxy: any
// method throws until a test assigns one, and every call is recorded — args
// included — so a test can assert on the `where` clause a security property
// actually rests on, not just that some query ran.
//
// No test framework here (see CLAUDE.md); this stays small on purpose.

type AnyFn = (...args: any[]) => any;

const modelHandlers = new Map<string, Record<string, AnyFn>>();
const modelCalls = new Map<string, Record<string, any[][]>>();
const models = new Map<string, Record<string, AnyFn>>();
const rawCalls: any[][] = [];

/** Every $queryRaw/$executeRaw call's arguments, in order. */
export function rawCallsMade(): any[][] {
  return rawCalls;
}

function createModel(name: string): Record<string, AnyFn> {
  const handlers: Record<string, AnyFn> = {};
  const calls: Record<string, any[][]> = {};
  modelHandlers.set(name, handlers);
  modelCalls.set(name, calls);
  return new Proxy({} as Record<string, AnyFn>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return (...args: any[]) => {
        (calls[prop] ??= []).push(args);
        const handler = handlers[prop];
        if (!handler) throw new Error(`fakePrisma: ${name}.${prop} not stubbed`);
        return handler(...args);
      };
    },
    set(_target, prop, value) {
      if (typeof prop === 'string') handlers[prop] = value;
      return true;
    },
  });
}

/** The recorded argument lists for every call made to `model.method`, in order. */
export function callsFor(model: string, method: string): any[][] {
  return modelCalls.get(model)?.[method] ?? [];
}

/** Clears every model, its stubs and its recorded calls. Call between tests. */
export function resetDb(): void {
  models.clear();
  modelHandlers.clear();
  modelCalls.clear();
  rawCalls.length = 0;
}

/**
 * `db` — the fake `prisma` client. `db.team.findUnique = async (args) => ...`
 * stubs a method; `db.team.findUnique` (no assignment) throws until stubbed.
 * `db.$transaction(fn)` calls `fn(db)`, same shape as a real interactive
 * transaction, since every model reachable from `db` is the same fake.
 */
export const db: any = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === '$transaction') {
        // An array of already-started operations (batch form), or an interactive callback.
        return async (fn: any) => (Array.isArray(fn) ? Promise.all(fn) : fn(db));
      }
      // Raw SQL (e.g. recordOneEvent's row lock) is a recorded no-op here;
      // only the integration tests prove what it does.
      if (prop === '$queryRaw' || prop === '$executeRaw') {
        return async (...args: any[]) => { rawCalls.push(args); return []; };
      }
      if (typeof prop !== 'string') return undefined;
      if (!models.has(prop)) models.set(prop, createModel(prop));
      return models.get(prop);
    },
  },
);
