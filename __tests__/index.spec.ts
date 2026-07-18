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

  test.each([
    [
      'CommonJS',
      [
        '-e',
        "const parser = require('@lint-md/parser'); process.stdout.write(parser.parseMd('# test').type)",
      ],
    ],
    [
      'ESM',
      [
        '--input-type=module',
        '-e',
        "import { parseMd } from '@lint-md/parser'; process.stdout.write(parseMd('# test').type)",
      ],
    ],
    [
      'CommonJS',
      [
        '-e',
        "const parser = require('@lint-md/parser'); process.stdout.write(parser.parseMdWithSourceMap('# test').ast.type)",
      ],
    ],
    [
      'ESM',
      [
        '--input-type=module',
        '-e',
        "import { parseMdWithSourceMap } from '@lint-md/parser'; process.stdout.write(parseMdWithSourceMap('# test').ast.type)",
      ],
    ],
    [
      'CommonJS',
      [
        '-e',
        "const parser = require('@lint-md/parser'); process.stdout.write(String(new parser.SourceMapConsistencyError() instanceof RangeError))",
      ],
    ],
    [
      'ESM',
      [
        '--input-type=module',
        '-e',
        "import { SourceMapConsistencyError } from '@lint-md/parser'; process.stdout.write(String(new SourceMapConsistencyError() instanceof RangeError))",
      ],
    ],
  ])('loads the %s package export', (_name, args) => {
    const output = execFileSync(process.execPath, args as string[], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });

    expect(['root', 'true']).toContain(output);
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
