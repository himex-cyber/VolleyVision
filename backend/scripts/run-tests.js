#!/usr/bin/env node
// Runs every src/lib/*.test.ts sequentially via ts-node and fails on the
// first error. Used by `npm test` — plain Node so it works on any platform.
const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

// A cycle hands one module a half-initialised copy of the other, so the
// failure surfaces later and somewhere else. Cheap to check, so check first.
const cycleCheck = spawnSync(
  process.execPath,
  [path.join(__dirname, 'check-import-cycles.js')],
  { stdio: 'inherit', cwd: path.join(__dirname, '..') },
);
if (cycleCheck.status !== 0) process.exit(cycleCheck.status ?? 1);

const libDir = path.join(__dirname, '..', 'src', 'lib');
const testFiles = readdirSync(libDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

if (testFiles.length === 0) {
  console.error('No test files found in src/lib.');
  process.exit(1);
}

const tsNodeBin = require.resolve('ts-node/dist/bin.js', {
  paths: [path.join(__dirname, '..')],
});

for (const file of testFiles) {
  const fullPath = path.join(libDir, file);
  console.log(`\n── ${file} ──`);
  const result = spawnSync(
    process.execPath,
    [tsNodeBin, '--transpile-only', fullPath],
    { stdio: 'inherit', cwd: path.join(__dirname, '..') },
  );
  if (result.status !== 0) {
    console.error(`\nFAILED: ${file}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${testFiles.length} test files passed.`);
