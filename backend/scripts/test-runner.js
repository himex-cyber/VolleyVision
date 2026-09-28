// The loop both test runners share (run-tests.js, run-integration-tests.js):
// every *.test.ts directly inside `dirs`, sorted, each in its own ts-node
// process with `env`, stopping at the first failure. Plain Node so it works
// on any platform.
const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..');
const srcDir = path.join(backendDir, 'src');

function runTestFiles({ dirs, env, label = 'test' }) {
  const testFiles = dirs
    .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(dir, f)))
    .sort();

  if (testFiles.length === 0) {
    console.error(`No ${label} files found in ${dirs.map((d) => path.relative(backendDir, d)).join(' or ')}.`);
    process.exit(1);
  }

  const tsNodeBin = require.resolve('ts-node/dist/bin.js', { paths: [backendDir] });

  for (const fullPath of testFiles) {
    const file = path.relative(srcDir, fullPath);
    console.log(`\n── ${file} ──`);
    const result = spawnSync(process.execPath, [tsNodeBin, '--transpile-only', fullPath], { stdio: 'inherit', cwd: backendDir, env });
    if (result.status !== 0) {
      console.error(`\nFAILED: ${file}`);
      process.exit(result.status ?? 1);
    }
  }

  console.log(`\nAll ${testFiles.length} ${label} files passed.`);
}

module.exports = { runTestFiles, srcDir };
