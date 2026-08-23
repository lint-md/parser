import { SourceMapConsistencyError, parseMdWithSourceMap } from '../helpers';

/** Collect matching nodes in document order. */
function nodesOfType(root: any, type: string): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('parseMdWithSourceMap: inlineCode.value → raw source', () => {
  test('maps a basic inline code value and keeps its full raw node source', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('before `value` after');
    const node = nodesOfType(ast, 'inlineCode')[0];
    expect(node.value).toBe('value');
    expect(sourceMap.getRaw(node)).toBe('`value`');
    expect(sourceMap.getSourceRange(node, 0, node.value.length)).toEqual({
      start: { line: 1, column: 9, offset: 8 },
      end: { line: 1, column: 14, offset: 13 },
    });
  });

  test('removes exactly one leading and trailing padding space', () => {
    const md = '`  a  `';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'inlineCode')[0];
    expect(node.value).toBe(' a ');
    expect(sourceMap.getRaw(node)).toBe(md);
    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(whole.start.offset).toBe(2);
    expect(whole.end.offset).toBe(5);
  });

  test.each(['\n', '\r', '\r\n'])(
    'removes one leading and trailing %p padding unit',
    (lineEnding) => {
      const md = '`' + lineEnding + 'a' + lineEnding + '`';
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = nodesOfType(ast, 'inlineCode')[0];
      expect(node.value).toBe('a');

      const range = sourceMap.getSourceRange(node, 0, 1);
      expect(md.slice(range.start.offset, range.end.offset)).toBe('a');
      expect(sourceMap.getSourceRange(node, 0, 0).start.offset).toBe(
        1 + lineEnding.length,
      );
      expect(sourceMap.getSourceRange(node, 1, 1).start.offset).toBe(
        2 + lineEnding.length,
      );
    },
  );

  test('maps a value containing backticks between multi-backtick delimiters', () => {
    const md = '`` `value` ``';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'inlineCode')[0];
    expect(node.value).toBe('`value`');
    expect(sourceMap.getRaw(node)).toBe(md);
    expect(sourceMap.getSourceRange(node, 0, node.value.length)).toEqual({
      start: { line: 1, column: 4, offset: 3 },
      end: { line: 1, column: 11, offset: 10 },
    });
  });

  test.each(['\n', '\r', '\r\n'])(
    'maps %p code units individually after padding normalization',
    (lineEnding) => {
      const md = '` a' + lineEnding + 'b `';
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = nodesOfType(ast, 'inlineCode')[0];
      expect(node.value).toBe('a' + lineEnding + 'b');

      const whole = sourceMap.getSourceRange(node, 0, node.value.length);
      expect(whole.start.offset).toBe(2);
      expect(whole.end.offset).toBe(2 + node.value.length);

      let previousStart = whole.start.offset;
      let previousEnd = whole.start.offset;
      for (let i = 0; i < node.value.length; i++) {
        const range = sourceMap.getSourceRange(node, i, i + 1);
        expect(range.start.offset).toBeGreaterThanOrEqual(0);
        expect(range.end.offset).toBeGreaterThanOrEqual(range.start.offset);
        expect(range.end.offset).toBeLessThanOrEqual(md.length);
        expect(range.start.offset).toBeGreaterThanOrEqual(whole.start.offset);
        expect(range.end.offset).toBeLessThanOrEqual(whole.end.offset);
        expect(range.start.offset).toBeGreaterThanOrEqual(previousStart);
        expect(range.end.offset).toBeGreaterThanOrEqual(previousEnd);
        expect(range.start.offset).toBe(2 + i);
        expect(range.end.offset).toBe(3 + i);
        previousStart = range.start.offset;
        previousEnd = range.end.offset;
      }
    }
  );

  test('rejects an inlineCode value modified after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('`value`');
    const node = nodesOfType(ast, 'inlineCode')[0];
    node.value = 'changed';
    expect(() => sourceMap.getSourceRange(node, 0, 1)).toThrow(
      SourceMapConsistencyError,
    );
    expect(() => sourceMap.getRaw(node)).toThrow(SourceMapConsistencyError);
  });
});
