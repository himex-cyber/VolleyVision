#!/usr/bin/env node
/**
 * Fail the build when src/ contains a circular import.
 *
 *   npm run check:cycles
 *   node scripts/check-import-cycles.js
 *
 * Also runs first inside `npm test` (see scripts/run-tests.js).
 *
 * A require cycle does not crash — it hands one of the modules a
 * half-initialised copy of the other. Anything read at module scope from that
 * copy is `undefined`, so the failure surfaces later, somewhere else, as a
 * "cannot read property of undefined" in code that looks innocent. We already
 * paid for one of those (invitation -> teamMembership -> teamActions ->
 * invitation); this script is the tripwire that stops it coming back.
 *
 * What counts as an edge:
 *   - relative `import ... from './x'` and `export ... from './x'` — runtime
 *   - bare specifiers (`from 'express'`) — ignored, they cannot close a cycle
 *     inside this codebase
 *   - `import type {...}` / `export type {...}`, and brace lists where every
 *     specifier is `type`-prefixed — ignored, TypeScript erases them, so they
 *     produce no require at runtime and flagging them would be a false alarm
 *
 * Known limits, both deliberate:
 *   - a commented-out import still counts (no comment stripping — cheap to add
 *     the day it actually misfires)
 *   - reports at least one cycle per tangled component, not every simple cycle
 *     through it; fix what it prints and re-run to surface the rest
 *   - dynamic `await import('./x')` is not an edge: it resolves after the
 *     module body has run, which is the usual way people break a cycle on
 *     purpose
 *
 * Exit code 0 when clean, 1 when any cycle is found.
 */
const { readdirSync, statSync, readFileSync } = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const ROOT_DIR = path.join(__dirname, '..');

// The clause between `import`/`export` and `from` may span lines but never
// contains a quote or a semicolon — that bound stops the match from running
// past the end of an earlier statement and mis-reading its clause.
const IMPORT_RE = /\b(?:import|export)\s+([^'";]*?)\bfrom\s*['"](\.[^'"]+)['"]/g;

function tsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** True when the statement is erased at compile time and cannot cause a require. */
function isTypeOnly(clause) {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return true;

  // `import { type Foo, bar }` keeps a runtime edge because of `bar`;
  // `import { type Foo, type Bar }` does not.
  const braces = trimmed.match(/^\{([^}]*)\}$/);
  if (!braces) return false;
  const specifiers = braces[1].split(',').map((s) => s.trim()).filter(Boolean);
  return specifiers.length > 0 && specifiers.every((s) => /^type\b/.test(s));
}

/** Resolve a relative specifier to a file on disk, or null if it is not one of ours. */
function resolve(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Nothing there — try the next shape, then give up (.json, .css, a
      // path-mapped alias: none of them can close a TypeScript cycle).
    }
  }
  return null;
}

function buildGraph(files) {
  const graph = new Map(files.map((f) => [f, []]));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const [, clause, spec] of source.matchAll(IMPORT_RE)) {
      if (isTypeOnly(clause)) continue;
      const target = resolve(file, spec);
      if (target && graph.has(target) && target !== file) graph.get(file).push(target);
    }
  }
  return graph;
}

const rel = (file) => path.relative(ROOT_DIR, file).split(path.sep).join('/');

/** Rotate so the smallest member leads: the same loop found from a different entry point is the same loop. */
function normalize(cycle) {
  const start = cycle.indexOf([...cycle].sort()[0]);
  return [...cycle.slice(start), ...cycle.slice(0, start)];
}

function findCycles(graph) {
  const cycles = new Map();
  const done = new Set();
  const onPath = new Set();
  const stack = [];

  function visit(node) {
    onPath.add(node);
    stack.push(node);
    for (const next of graph.get(node)) {
      if (onPath.has(next)) {
        const cycle = normalize(stack.slice(stack.indexOf(next)));
        cycles.set(cycle.join('\0'), cycle);
      } else if (!done.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    onPath.delete(node);
    done.add(node);
  }

  for (const node of graph.keys()) if (!done.has(node)) visit(node);
  return [...cycles.values()];
}

const files = tsFiles(SRC_DIR);
const cycles = findCycles(buildGraph(files));

if (cycles.length === 0) {
  console.log(`No import cycles — ${files.length} files in src/ checked.`);
  process.exit(0);
}

console.error(`\nIMPORT CYCLE${cycles.length > 1 ? 'S' : ''} FOUND — ${cycles.length} in ${files.length} files:\n`);
for (const cycle of cycles) {
  console.error(`  ${[...cycle, cycle[0]].map(rel).join(' -> ')}\n`);
}
console.error('Break the loop: move the shared code into its own module, or make one side a type-only import.\n');
process.exit(1);
