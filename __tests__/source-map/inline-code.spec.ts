import { SourceMapConsistencyError, parseMd, parseMdWithSourceMap } from '../helpers';

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
  test('keeps GFM table behavior for two and three backslashes before a pipe', () => {
    const two = '`a' + '\\'.repeat(2) + '|b`';
    const three = '`a' + '\\'.repeat(3) + '|b`';
    const md = `| value |\n| --- |\n| ${two} |\n| ${three} |\n`;
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    expect(ast).toEqual(parseMd(md));

    const table = ast.children[0] as any;
    const splitRow = table.children[1];
    expect(splitRow.children).toHaveLength(2);
    const splitText = splitRow.children[0].children[0];
    expect(splitText.value).toBe('`a\\');
    expect(splitRow.children[1].children[0].value).toBe('b`');
    expect(sourceMap.getRaw(splitText)).toBe(two.slice(0, 4));
    const splitSlash = sourceMap.getSourceRange(splitText, 2, 3);
    expect(md.slice(splitSlash.start.offset, splitSlash.end.offset)).toBe('\\'.repeat(2));

    const code = table.children[2].children[0].children[0];
    expect(code.type).toBe('inlineCode');
    expect(code.value).toBe('a' + '\\'.repeat(2) + '|b');
    expect(sourceMap.getRaw(code)).toBe(three);
    const rawCharacters = Array.from({ length: code.value.length }, (_, index) => {
      const range = sourceMap.getSourceRange(code, index, index + 1);
      return md.slice(range.start.offset, range.end.offset);
    });
    expect(rawCharacters).toEqual(['a', '\\', '\\', '\\|', 'b']);
    const pipe = sourceMap.getSourceRange(code, 3, 4);
    expect(pipe.start.offset).toBe(md.indexOf(three) + 4);
    expect(pipe.end.offset).toBe(md.indexOf(three) + 6);
  });

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

  test('maps whitespace-only content from parser events', () => {
    const md = '`  `';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'inlineCode')[0];
    expect(node.value).toBe('  ');
    expect(sourceMap.getSourceRange(node, 0, node.value.length)).toEqual({
      start: { line: 1, column: 2, offset: 1 },
      end: { line: 1, column: 4, offset: 3 },
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
