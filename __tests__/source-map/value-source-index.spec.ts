import {
  parseMdWithSourceMap,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
} from '../helpers';

function nodesWithValue(root: any): any[] {
  const nodes: any[] = [];
  (function walk(node: any) {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code')
      nodes.push(node);
    for (const child of node.children || []) walk(child);
  })(root);
  return nodes;
}

function expectOffsetParity(markdown: string): void {
  const { ast, sourceMap } = parseMdWithSourceMap(markdown);
  for (const node of nodesWithValue(ast)) {
    const index = sourceMap.getValueSourceIndex(node);
    const boundaries = Array.from(
      { length: node.value.length + 1 },
      (_, valueIndex) => valueIndex,
    );
    for (const valueIndex of [...boundaries, ...boundaries.reverse()]) {
      let expected: number;
      try {
        expected = sourceMap.getSourceRange(
          node,
          valueIndex,
          valueIndex,
        ).start.offset;
      }
      catch (error) {
        expect(() => index.sourceOffsetAt(valueIndex)).toThrow(
          (error as Error).constructor as ErrorConstructor,
        );
        continue;
      }
      expect(index.sourceOffsetAt(valueIndex)).toBe(expected);
    }
  }
}

describe('MarkdownValueSourceIndex', () => {
  test.each([
    'plain\ntext',
    'one space \nnext',
    'a&amp;b',
    'a&NewLine;b',
    String.raw`a\(b`,
    '> first\n> second',
    '` padded code `',
    '```js\nconst value = 1\n```',
    '&Afr;',
    '&#0;',
    '```\n```',
  ])('matches empty range queries for %p', (markdown) => {
    expectOffsetParity(markdown);
  });

  test('maps a normalized newline after a removed trailing space', () => {
    const markdown = 'one space \nnext';
    const { ast, sourceMap } = parseMdWithSourceMap(markdown);
    const node = nodesWithValue(ast)[0];
    const valueIndex = node.value.indexOf('\n');

    expect(valueIndex).toBe(9);
    expect(sourceMap.getValueSourceIndex(node).sourceOffsetAt(valueIndex)).toBe(
      markdown.indexOf('\n'),
    );
  });

  test('rejects invalid and atomic boundaries', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&Afr;');
    const node = nodesWithValue(ast)[0];
    const index = sourceMap.getValueSourceIndex(node);

    expect(() => index.sourceOffsetAt(0.5)).toThrow(RangeError);
    expect(() => index.sourceOffsetAt(-1)).toThrow(RangeError);
    expect(() => index.sourceOffsetAt(node.value.length + 1)).toThrow(RangeError);
    expect(() => index.sourceOffsetAt(1)).toThrow(RangeError);
  });

  test('checks node ownership', () => {
    const first = parseMdWithSourceMap('first');
    const second = parseMdWithSourceMap('second');
    const foreign = nodesWithValue(second.ast)[0];

    expect(() => first.sourceMap.getValueSourceIndex(foreign)).toThrow(
      SourceMapUnavailableError,
    );
  });

  test('checks value mutations after index creation', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('text');
    const node = nodesWithValue(ast)[0];
    const index = sourceMap.getValueSourceIndex(node);
    node.value = 'changed';

    expect(() => index.sourceOffsetAt(0)).toThrow(SourceMapConsistencyError);
  });
});
