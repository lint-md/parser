import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'bench-markdown-versions.mjs');
const child = spawnSync(process.execPath, [
  script,
  '--baseline', root,
  '--current', root,
  '--runs', '1',
  '--bytes', '1024',
], { encoding: 'utf8' });

assert.equal(child.status, 0, child.stderr);
const result = JSON.parse(child.stdout);
assert.equal(result.runs, 1);
assert.equal(result.bytes, 1024);
for (const version of ['baseline', 'current']) {
  assert.ok(result.summary[version].cjsBytes > 0);
  assert.ok(result.summary[version].esmBytes > 0);
  for (const format of ['cjs', 'esm']) {
    for (const name of ['parseMd', 'parseMdWithSourceMap']) {
      const sample = result.summary[version][`${format}/${name}`];
      assert.ok(sample.coldTotalMs > 0);
      assert.ok(sample.rssBytes > 0);
      assert.ok(sample.loadHeapBytes > 0);
    }
  }
}
console.log('Markdown comparison smoke test passed.');
