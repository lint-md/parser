import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const { parseMd, revertMdAstNode } = require('../dist/lint-md-parser.cjs');

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
  ])('loads the %s package export', (_name, args) => {
    const output = execFileSync(process.execPath, args as string[], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });

    expect(output).toBe('root');
  });

  test('invoke parseMd', () => {
    expect(parseMd(mdDemo)).toMatchSnapshot();
  });

  test('invoke revertMdAstNode', () => {
    const ast = parseMd(mdDemo);
    const res = revertMdAstNode(ast);
    expect(res).toMatchSnapshot();
  });
});
