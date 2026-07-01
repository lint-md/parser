import { parseMd, revertMdAstNode } from './helpers';

function stripPosition(node: any): any {
  if (node === null || node === undefined) {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(stripPosition);
  }
  if (typeof node === 'object') {
    const result: any = {};
    for (const key of Object.keys(node)) {
      if (key === 'position') {
        continue;
      }
      result[key] = stripPosition(node[key]);
    }
    return result;
  }
  return node;
}

function assertRoundtrip(input: string) {
  const ast1 = parseMd(input);
  const md = revertMdAstNode(ast1);
  const ast2 = parseMd(md);
  expect(stripPosition(ast1)).toEqual(stripPosition(ast2));
}

describe('roundtrip consistency (parse → stringify → parse)', () => {
  test('basic markdown (heading, paragraph, list)', () => {
    assertRoundtrip('# Hello\n\nParagraph text.\n\n- item1\n- item2');
  });

  test('GFM table', () => {
    assertRoundtrip('| a | b |\n|---|---|\n| 1 | 2 |');
  });

  test('GFM task list', () => {
    assertRoundtrip('- [x] done\n- [ ] todo');
  });

  test('GFM strikethrough', () => {
    assertRoundtrip('~deleted text~');
  });

  test('frontmatter', () => {
    assertRoundtrip('---\ntitle: test\n---\n\nContent');
  });

  test('block math', () => {
    assertRoundtrip('$$\nx^2\n$$');
  });

  test('inline math', () => {
    assertRoundtrip('Text $x^2$ here');
  });

  test('container directive', () => {
    assertRoundtrip(':::note\ncontent\n:::');
  });

  test('leaf directive', () => {
    assertRoundtrip('::warning[content]');
  });

  test('mixed content', () => {
    assertRoundtrip('# Title\n\nText with $math$ and ~~strike~~.\n\n| col1 | col2 |\n|------|------|\n| a    | b    |\n\n:::note\nDirective content\n:::');
  });
});
