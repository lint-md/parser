import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = mkdtempSync(join(tmpdir(), 'lint-md-parser-package-'));
const tarball = join(testRoot, 'lint-md-parser.tgz');
const consumerRoot = join(testRoot, 'consumer');

const run = (command, args, cwd = consumerRoot) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();

try {
  run('pnpm', ['pack', '--out', tarball], projectRoot);

  mkdirSync(consumerRoot);
  writeFileSync(
    join(consumerRoot, 'package.json'),
    JSON.stringify({ name: 'package-smoke-test', private: true }, null, 2),
  );

  run('pnpm', ['add', tarball]);

  const installedManifest = JSON.parse(
    readFileSync(
      join(consumerRoot, 'node_modules/@lint-md/parser/package.json'),
      'utf8',
    ),
  );
  assert.deepEqual(Object.keys(installedManifest.dependencies), [
    '@types/mdast',
  ]);

  const cjsResult = run('node', [
    '-e',
    "const parser = require('@lint-md/parser'); process.stdout.write(parser.parseMd('# CJS').type)",
  ]);
  assert.equal(cjsResult, 'root');

  const esmResult = run('node', [
    '--input-type=module',
    '-e',
    "import { parseMd } from '@lint-md/parser'; process.stdout.write(parseMd('# ESM').type)",
  ]);
  assert.equal(esmResult, 'root');

  writeFileSync(
    join(consumerRoot, 'consumer.mts'),
    [
      "import { parseMd, revertMdAstNode } from '@lint-md/parser';",
      "const markdown: string = revertMdAstNode(parseMd('# ESM'));",
      'void markdown;',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(consumerRoot, 'consumer.cts'),
    [
      "import parser = require('@lint-md/parser');",
      "const markdown: string = parser.revertMdAstNode(parser.parseMd('# CJS'));",
      'void markdown;',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: 'ES2020',
        },
        include: ['./consumer.cts', './consumer.mts'],
      },
      null,
      2,
    ),
  );

  run(join(projectRoot, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json']);
} finally {
  rmSync(testRoot, { force: true, recursive: true });
}
