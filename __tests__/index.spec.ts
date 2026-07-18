import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { parseMd, revertMdAstNode, stringifyMdAst } from './helpers';

describe('test lint-md-parser', () => {
  const mdDemo = fs
    .readFileSync(path.resolve(__dirname, './common-demo.md'))
    .toString();

  test('expose method (parseMd) is bundled as function', () => {
    expect(typeof parseMd).toStrictEqual('function');
  });

  test.each<[string, string[], string]>([
    [
      'CJS parseMd',
      [
        '-e',
        "const parser = require('@lint-md/parser'); process.stdout.write(parser.parseMd('# test').type)",
      ],
      'root',
    ],
    [
      'ESM parseMd',
      [
        '--input-type=module',
        '-e',
        "import { parseMd } from '@lint-md/parser'; process.stdout.write(parseMd('# test').type)",
      ],
      'root',
    ],
    [
      'CJS parseMdWithSourceMap',
      [
        '-e',
        "const parser = require('@lint-md/parser'); process.stdout.write(parser.parseMdWithSourceMap('# test').ast.type)",
      ],
      'root',
    ],
    [
      'ESM parseMdWithSourceMap',
      [
        '--input-type=module',
        '-e',
        "import { parseMdWithSourceMap } from '@lint-md/parser'; process.stdout.write(parseMdWithSourceMap('# test').ast.type)",
      ],
      'root',
    ],
    [
      'CJS consistency error',
      [
        '-e',
        "const parser = require('@lint-md/parser'); process.stdout.write(String(new parser.SourceMapConsistencyError() instanceof RangeError))",
      ],
      'true',
    ],
    [
      'ESM consistency error',
      [
        '--input-type=module',
        '-e',
        "import { SourceMapConsistencyError } from '@lint-md/parser'; process.stdout.write(String(new SourceMapConsistencyError() instanceof RangeError))",
      ],
      'true',
    ],
  ])('loads %s', (_name, args, expected) => {
    const output = execFileSync(process.execPath, args as string[], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });

    expect(output).toBe(expected);
  });

  test('stringifyMdAst is same function as revertMdAstNode (CJS)', () => {
    expect(stringifyMdAst).toBe(revertMdAstNode);
  });

  test('stringifyMdAst is same function as revertMdAstNode (ESM)', () => {
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      "import { stringifyMdAst, revertMdAstNode } from '@lint-md/parser'; process.stdout.write(String(stringifyMdAst === revertMdAstNode))",
    ], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    expect(output).toBe('true');
  });

  test('invoke parseMd', () => {
    expect(parseMd(mdDemo)).toMatchSnapshot();
  });

  test('invoke revertMdAstNode', () => {
    const ast = parseMd(mdDemo);
    const res = revertMdAstNode(ast);
    expect(res).toMatchSnapshot();
  });

  test.each<[string, string[]]>([
    [
      'CJS: extension imported first, then parser used',
      [
        '-e',
        "const { gfmAutolinkLiteralFromMarkdown } = require('mdast-util-gfm-autolink-literal');"
          + 'const ref = gfmAutolinkLiteralFromMarkdown.transforms;'
          + 'const before = ref.length;'
          + "require('@lint-md/parser').parseMd('www.example.com');"
          + 'process.stdout.write(String(gfmAutolinkLiteralFromMarkdown.transforms === ref && gfmAutolinkLiteralFromMarkdown.transforms.length === before && before === 1))',
      ],
    ],
    [
      'CJS: parser used first, then extension inspected',
      [
        '-e',
        "require('@lint-md/parser').parseMd('www.example.com');"
          + "const { gfmAutolinkLiteralFromMarkdown } = require('mdast-util-gfm-autolink-literal');"
          + 'process.stdout.write(String(gfmAutolinkLiteralFromMarkdown.transforms.length === 1))',
      ],
    ],
    [
      'CJS: repeated parses keep the singleton transform content intact',
      [
        '-e',
        "const { gfmAutolinkLiteralFromMarkdown } = require('mdast-util-gfm-autolink-literal');"
          + 'const before = [...gfmAutolinkLiteralFromMarkdown.transforms];'
          + "const { parseMd, parseMdWithSourceMap } = require('@lint-md/parser');"
          + "parseMd('www.example.com'); parseMdWithSourceMap('\"www.google.com\"'); parseMd('<https://ex.com>');"
          + 'const after = gfmAutolinkLiteralFromMarkdown.transforms;'
          + 'process.stdout.write(String(after.length === before.length && after.every((t, i) => t === before[i]) && before.length === 1))',
      ],
    ],
    [
      'ESM: extension imported first, then parser used',
      [
        '--input-type=module',
        '-e',
        "import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';"
          + "import { parseMd } from '@lint-md/parser';"
          + 'const ref = gfmAutolinkLiteralFromMarkdown.transforms;'
          + 'const before = ref.length;'
          + "parseMd('www.example.com');"
          + 'process.stdout.write(String(gfmAutolinkLiteralFromMarkdown.transforms === ref && gfmAutolinkLiteralFromMarkdown.transforms.length === before && before === 1))',
      ],
    ],
  ])(
    'shared GFM autolink extension is unmodified regardless of import order — %s',
    (_name, args) => {
      const output = execFileSync(process.execPath, args as string[], {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8',
      });
      expect(output).toBe('true');
    },
  );

  test('quoted www URL is not auto-linked and has position', () => {
    const root = parseMd('搜索了 "www.google.com"。');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const textNode = paragraph.children[0];
      expect(textNode.type).not.toBe('link');
      expect(textNode.type).toBe('text');
      if (textNode.type === 'text') {
        expect(textNode.value).toContain('www.google.com');
        expect(textNode.position).toBeDefined();
      }
    }
  });
});
