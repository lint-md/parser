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

describe('parseMdWithSourceMap: code.value → raw source', () => {
  function expectPerCodeUnitRanges(
    md: string,
    node: any,
    sourceMap: any,
  ): void {
    let previousStart = node.position.start.offset;
    let previousEnd = node.position.start.offset;
    for (let i = 0; i < node.value.length; i++) {
      const range = sourceMap.getSourceRange(node, i, i + 1);
      expect(range.start.offset).toBeGreaterThanOrEqual(0);
      expect(range.end.offset).toBeGreaterThanOrEqual(range.start.offset);
      expect(range.end.offset).toBeLessThanOrEqual(md.length);
      expect(range.start.offset).toBeGreaterThanOrEqual(node.position.start.offset);
      expect(range.end.offset).toBeLessThanOrEqual(node.position.end.offset);
      expect(range.start.offset).toBeGreaterThanOrEqual(previousStart);
      expect(range.end.offset).toBeGreaterThanOrEqual(previousEnd);
      previousStart = range.start.offset;
      previousEnd = range.end.offset;
    }
  }

  test.each(['\n', '\r', '\r\n'])(
    'maps fenced code with %p line endings',
    (lineEnding) => {
      const md = `\`\`\`ts meta${lineEnding}a${lineEnding}b${lineEnding}\`\`\``;
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = nodesOfType(ast, 'code')[0];
      expect(node.value).toBe(`a${lineEnding}b`);
      expect(sourceMap.getRaw(node)).toBe(md);
      const whole = sourceMap.getSourceRange(node, 0, node.value.length);
      expect(whole.start.offset).toBe(
        md.indexOf('a', md.indexOf(lineEnding) + lineEnding.length),
      );
      expect(whole.end.offset).toBe(md.indexOf('b') + 1);
      expectPerCodeUnitRanges(md, node, sourceMap);
    },
  );

  test('maps indented code line by line, including a blank line', () => {
    const md = '    a\r\n\r\n    b\r\n';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('a\r\n\r\nb');
    expect(sourceMap.getRaw(node)).toBe('    a\r\n\r\n    b');
    expect(() => sourceMap.getSourceRange(node, 0, node.value.length)).toThrow(
      'getSourceRange: value range crosses non-contiguous source segments',
    );
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test.each(['\t', ' \t', '  \t', '   \t', '\t\t'])(
    'maps a tab-indented code line with prefix %p',
    (indentation) => {
      const md = indentation + 'a\n';
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = nodesOfType(ast, 'code')[0];
      const value = indentation === '\t\t' ? '\ta' : 'a';
      expect(node.value).toBe(value);
      const range = sourceMap.getSourceRange(node, 0, node.value.length);
      expect(md.slice(range.start.offset, range.end.offset)).toBe(value);
    },
  );

  test('maps tilde-fenced code', () => {
    const md = '~~~\r\nvalue\r\n~~~';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('value');
    expect(sourceMap.getRaw(node)).toBe(md);
    expect(sourceMap.getSourceRange(node, 0, node.value.length)).toEqual({
      start: { line: 2, column: 1, offset: 5 },
      end: { line: 2, column: 6, offset: 10 },
    });
  });

  test('maps fenced code inside a blockquote', () => {
    const md = '> ```js\n> const x = 1\n> ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('const x = 1');
    const range = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(md.slice(range.start.offset, range.end.offset)).toContain('const x = 1');
  });

  test.each(['```', '~~~'])(
    'maps a fenced code block after a blockquote tab prefix: %p',
    (fence) => {
      const md = '> \t' + fence + '\n> \tcode\n> \t' + fence;
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = nodesOfType(ast, 'code')[0];
      expect(node.value).toBe('code');
      const range = sourceMap.getSourceRange(node, 0, node.value.length);
      expect(md.slice(range.start.offset, range.end.offset)).toBe('code');
    },
  );

  test('maps a fenced code block with equivalent tab and space indentation', () => {
    const md = '> \t```\n> \tcode\n>  ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('code');
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps indented code inside a blockquote', () => {
    const md = '>     indented\n>     code';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('indented\ncode');
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps fenced code nested in a list', () => {
    const md = '- item\n    ```\n    value\n    ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('value');
    const range = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('value');
  });

  test('maps fenced code in a list with equivalent tab and space indentation', () => {
    const md = '- item\n\t```\n    code\n\t```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('code');
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps multi-line indented code inside a list', () => {
    const md = '- Foo\n\n      bar\n      baz';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('bar\nbaz');
    expect(() => sourceMap.getSourceRange(node, 0, node.value.length)).toThrow(
      'getSourceRange: value range crosses non-contiguous source segments',
    );
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test.each(['\n', '\r', '\r\n'])(
    'maps multi-line indented code after a tab list continuation prefix with %p',
    (lineEnding) => {
      const md = '- Foo' + lineEnding + lineEnding
        + '\t  bar' + lineEnding + '\t  baz';
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = nodesOfType(ast, 'code')[0];
      expect(node.value).toBe('bar' + lineEnding + 'baz');
      expectPerCodeUnitRanges(md, node, sourceMap);
    },
  );

  test('maps multi-line indented code inside a blockquote list', () => {
    const md = '> - Foo\n>\n>       bar\n>       baz';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('bar\nbaz');
    expect(() => sourceMap.getSourceRange(node, 0, node.value.length)).toThrow(
      'getSourceRange: value range crosses non-contiguous source segments',
    );
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps multi-line indented code with a tab inside a blockquote list', () => {
    const md = '> - Foo\n>\n>     \tbar\n>     \tbaz';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('bar\nbaz');
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps empty fenced code inside a blockquote', () => {
    const md = '> ```\n> ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('');
    const point = sourceMap.getSourceRange(node, 0, 0);
    expect(point.start.offset).toBe(md.lastIndexOf('```'));
  });

  test('maps empty fenced code inside a list', () => {
    const md = '- item\n    ```\n    ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    const point = sourceMap.getSourceRange(node, 0, 0);
    expect(point.start.offset).toBe(md.lastIndexOf('```'));
  });

  test('excludes fenced delimiters and their indentation from code ranges', () => {
    const md = '  ```\n  a\n  b\n  ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('a\nb');
    expect(sourceMap.getRaw(node)).toBe('```\n  a\n  b\n  ```');
    expect(sourceMap.getSourceRange(node, 0, 1).start.offset).toBe(md.indexOf('a'));
    expect(sourceMap.getSourceRange(node, 2, 3).end.offset).toBe(md.indexOf('b') + 1);
  });

  test('maps an empty fenced code value to its content boundary', () => {
    const md = '```\n\n```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('');
    expect(sourceMap.getRaw(node)).toBe(md);
    expect(sourceMap.getSourceRange(node, 0, 0).start.offset).toBe(4);
  });

  test.each([
    ['```', 3],
    ['~~~', 3],
    ['```   ', 6],
    ['```\n', 4],
    ['```\r', 4],
    ['```\r\n', 5],
  ])('maps an unclosed empty fence to EOF: %p', (md, expectedOffset) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('');
    const point = sourceMap.getSourceRange(node, 0, 0);
    expect(point.start.offset).toBe(expectedOffset);
    expect(point.end.offset).toBe(expectedOffset);
  });

  test.each([
    ['> ```', 5],
    ['> ```\n', 6],
    ['> ```\r', 6],
    ['> ```\r\n', 7],
  ])('maps an unclosed empty fence inside a blockquote to EOF: %p', (md, expectedOffset) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'code')[0];
    expect(node.value).toBe('');
    const point = sourceMap.getSourceRange(node, 0, 0);
    expect(point.start.offset).toBe(expectedOffset);
    expect(point.end.offset).toBe(expectedOffset);
  });

  test('rejects a code value modified after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('```\nvalue\n```');
    const node = nodesOfType(ast, 'code')[0];
    node.value = 'changed';
    expect(() => sourceMap.getSourceRange(node, 0, 1)).toThrow(
      SourceMapConsistencyError,
    );
    expect(() => sourceMap.getRaw(node)).toThrow(SourceMapConsistencyError);
  });
});
