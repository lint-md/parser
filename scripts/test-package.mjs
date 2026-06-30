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
      "import type {",
      '  MarkdownContainerDirective,',
      '  MarkdownInlineMath,',
      '  MarkdownLeafDirective,',
      '  MarkdownMath,',
      '  MarkdownRoot,',
      '  MarkdownTextDirective,',
      "} from '@lint-md/parser';",
      "import { parseMd, revertMdAstNode } from '@lint-md/parser';",
      '',
      'const markdown: string = revertMdAstNode(parseMd("# ESM"));',
      'void markdown;',
      '',
      'function assertType<T>(_val: T): void {}',
      '',
      'const root = parseMd("# test");',
      '',
      'for (const child of root.children) {',
      '  if (child.type === "yaml") {',
      '    assertType<string>(child.value);',
      '  }',
      '',
      '  if (child.type === "table") {',
      '    for (const row of child.children) {',
      '      assertType<string>(row.type);',
      '    }',
      '  }',
      '',
      '  if (child.type === "delete") {',
      '    assertType<string>(child.children[0]!.type);',
      '  }',
      '',
      '  if (child.type === "footnoteDefinition") {',
      '    assertType<string>(child.identifier);',
      '  }',
      '',
      '  if (child.type === "math") {',
      '    assertType<MarkdownMath>(child);',
      '    assertType<string>(child.value);',
      '    if (child.meta) assertType<string>(child.meta);',
      '  }',
      '',
      '  if (child.type === "containerDirective") {',
      '    assertType<MarkdownContainerDirective>(child);',
      '    assertType<string>(child.name);',
      '    if (child.attributes) assertType<Record<string, string | null | undefined>>(child.attributes);',
      '  }',
      '',
      '  if (child.type === "leafDirective") {',
      '    assertType<MarkdownLeafDirective>(child);',
      '    assertType<string>(child.name);',
      '  }',
      '',
      '  if (child.type === "paragraph") {',
      '    for (const pc of child.children) {',
      '      if (pc.type === "inlineMath") {',
      '        assertType<MarkdownInlineMath>(pc);',
      '        assertType<string>(pc.value);',
      '      }',
      '',
      '      if (pc.type === "textDirective") {',
      '        assertType<MarkdownTextDirective>(pc);',
      '        assertType<string>(pc.name);',
      '      }',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(consumerRoot, 'consumer.cts'),
    [
      "import type {",
      '  MarkdownContainerDirective,',
      '  MarkdownInlineMath,',
      '  MarkdownLeafDirective,',
      '  MarkdownMath,',
      '  MarkdownRoot,',
      '  MarkdownTextDirective,',
      "} from '@lint-md/parser';",
      "import parser = require('@lint-md/parser');",
      '',
      'const markdown: string = parser.revertMdAstNode(parser.parseMd("# CJS"));',
      'void markdown;',
      '',
      'function assertType<T>(_val: T): void {}',
      '',
      'const root = parser.parseMd("# test");',
      '',
      'for (const child of root.children) {',
      '  if (child.type === "yaml") {',
      '    assertType<string>(child.value);',
      '  }',
      '',
      '  if (child.type === "table") {',
      '    for (const row of child.children) {',
      '      assertType<string>(row.type);',
      '    }',
      '  }',
      '',
      '  if (child.type === "delete") {',
      '    assertType<string>(child.children[0]!.type);',
      '  }',
      '',
      '  if (child.type === "footnoteDefinition") {',
      '    assertType<string>(child.identifier);',
      '  }',
      '',
      '  if (child.type === "math") {',
      '    assertType<MarkdownMath>(child);',
      '    assertType<string>(child.value);',
      '    if (child.meta) assertType<string>(child.meta);',
      '  }',
      '',
      '  if (child.type === "containerDirective") {',
      '    assertType<MarkdownContainerDirective>(child);',
      '    assertType<string>(child.name);',
      '    if (child.attributes) assertType<Record<string, string | null | undefined>>(child.attributes);',
      '  }',
      '',
      '  if (child.type === "leafDirective") {',
      '    assertType<MarkdownLeafDirective>(child);',
      '    assertType<string>(child.name);',
      '  }',
      '',
      '  if (child.type === "paragraph") {',
      '    for (const pc of child.children) {',
      '      if (pc.type === "inlineMath") {',
      '        assertType<MarkdownInlineMath>(pc);',
      '        assertType<string>(pc.value);',
      '      }',
      '',
      '      if (pc.type === "textDirective") {',
      '        assertType<MarkdownTextDirective>(pc);',
      '        assertType<string>(pc.name);',
      '      }',
      '    }',
      '  }',
      '}',
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
