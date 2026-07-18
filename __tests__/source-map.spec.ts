import {
  parseMdWithSourceMap,
  SourceMapError,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
} from './helpers';

/** Collect every `text` node in document order. */
function textNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === 'text') out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

/** Collect every `inlineCode` node in document order. */
function inlineCodeNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === 'inlineCode') out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

/** Collect every block `code` node in document order. */
function codeNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === 'code')
      out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

function nodesOfType(root: any, type: string): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('parseMdWithSourceMap: text.value → raw source', () => {
  test('backslash escape \\( maps to a 2-char source span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('\\(');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('(');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(2);
    expect(sourceMap.getRaw(t)).toBe('\\(');
  });

  test('backslash escape \\\\ maps to a 2-char source span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('\\\\');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('\\');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(2);
  });

  test('named character reference &amp;', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&amp;');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('&');
    // the whole '&amp;' (5 chars) decodes to one '&'.
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('decimal numeric reference &#40;', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#40;');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('(');
    // the whole '&#40;' (5 chars) decodes to one '('.
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('hex numeric reference &#x28;', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#x28;');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('(');
    // the whole '&#x28;' (6 chars) decodes to one '('.
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(6);
  });

  test('named reference decoding to two UTF-16 code units (&Afr;)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&Afr;');
    const t = textNodes(ast)[0];
    // 𝔄 is a surrogate pair: 2 UTF-16 code units.
    expect([...t.value]).toHaveLength(1);
    expect(t.value.length).toBe(2);
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('nameless/incomplete entity &copy is kept literal', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&copy');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('&copy');
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('over-length numeric reference &#00000049; stays literal', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#00000049;');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('&#00000049;');
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(11);
  });

  test('null numeric reference &#0; normalizes to replacement char', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#0;');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('�');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(4);
  });

  test('C1 control numeric reference &#128; normalizes to replacement char', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#128;');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('�');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(6);
  });

  test('noncharacter numeric reference &#xFDD0; normalizes to replacement char', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#xFDD0;');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('�');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(8);
  });

  test('autolink literal keeps &amp; literal (the core constraint)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap(
      '<https://example.com/?a&amp;b>',
    );
    const t = textNodes(ast)[0];
    expect(t.value).toBe('https://example.com/?a&amp;b');
    // The whole value is literal; no decoding happened.
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(1);
    expect(range.end.offset).toBe(29);
  });

  test('www. autolink literal keeps &amp; literal (same as explicit autolink)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('www.example.com/?a&amp;b');
    const t = textNodes(ast)[0];
    // GFM autolink-literal keeps the entity literal, exactly like
    // <https://...?a&amp;b>. This is the parser's real decision.
    expect(t.value).toBe('www.example.com/?a&amp;b');
    expect(t.value.length).toBe(24);
    // The '&' at value index 18 is the literal '&' of the kept '&amp;' span.
    const ampChar = sourceMap.getSourceRange(t, 18, 19);
    expect(ampChar.start.offset).toBe(18);
    expect(ampChar.end.offset).toBe(19);
    // The whole value maps back to the full raw source.
    const full = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(full.start.offset).toBe(0);
    expect(full.end.offset).toBe(24);
  });

  test('multiple escapes and references inline', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B&amp;C');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('A&B&C');
    expect(sourceMap.getSourceRange(t, 0, 5).start.offset).toBe(0);
    // "A&amp;B&amp;C" = 13 chars
    expect(sourceMap.getSourceRange(t, 0, 5).end.offset).toBe(13);
    // value "A&B&C": decoded '&' at value index 3 comes from the 2nd '&amp;'
    // spanning source 6..10
    expect(sourceMap.getSourceRange(t, 3, 4).start.offset).toBe(7);
    expect(sourceMap.getSourceRange(t, 3, 4).end.offset).toBe(12);
  });

  test('CRLF and multi-line text node maps each line ending', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('line1\r\nline2');
    const t = textNodes(ast)[0];
    // remark preserves the raw CRLF inside the text value.
    expect(t.value).toBe('line1\r\nline2');
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(12); // line1(5) + CRLF(2) + line2(5)
  });

  test('getRaw of a multi-segment text node returns its full source span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&lt;B');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('A<B');
    expect(sourceMap.getRaw(t)).toBe('A&lt;B');
    const full = sourceMap.getSourceRange(t, 0, t.value.length);
    // A(0..1) + decoded '<' from '&lt;'(1..5) + B(5..6)
    expect(full.start.offset).toBe(0);
    expect(full.end.offset).toBe(6);
  });
});

describe('parseMdWithSourceMap: inlineCode.value → raw source', () => {
  test('maps a basic inline code value and keeps its full raw node source', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('before `value` after');
    const node = inlineCodeNodes(ast)[0];
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
    const node = inlineCodeNodes(ast)[0];
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
      const node = inlineCodeNodes(ast)[0];
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
    const node = inlineCodeNodes(ast)[0];
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
      const node = inlineCodeNodes(ast)[0];
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
    const node = inlineCodeNodes(ast)[0];
    node.value = 'changed';
    expect(() => sourceMap.getSourceRange(node, 0, 1)).toThrow(
      SourceMapConsistencyError,
    );
    expect(() => sourceMap.getRaw(node)).toThrow(SourceMapConsistencyError);
  });
});
describe('parseMdWithSourceMap: code.value → raw source', () => {
  function expectPerCodeUnitRanges(
    md: string,
    node: any,
    sourceMap: any,
  ): void {
    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
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
      previousStart = range.start.offset;
      previousEnd = range.end.offset;
    }
  }

  test.each(['\n', '\r', '\r\n'])(
    'maps fenced code with %p line endings',
    (lineEnding) => {
      const md = `\`\`\`ts meta${lineEnding}a${lineEnding}b${lineEnding}\`\`\``;
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = codeNodes(ast)[0];
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
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('a\r\n\r\nb');
    expect(sourceMap.getRaw(node)).toBe('    a\r\n\r\n    b');
    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(whole.start.offset).toBe(md.indexOf('a'));
    expect(whole.end.offset).toBe(md.indexOf('b') + 1);
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test.each(['\t', ' \t', '  \t', '   \t', '\t\t'])(
    'maps a tab-indented code line with prefix %p',
    (indentation) => {
      const md = indentation + 'a\n';
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const node = codeNodes(ast)[0];
      const value = indentation === '\t\t' ? '\ta' : 'a';
      expect(node.value).toBe(value);
      const range = sourceMap.getSourceRange(node, 0, node.value.length);
      expect(md.slice(range.start.offset, range.end.offset)).toBe(value);
    },
  );

  test('maps tilde-fenced code', () => {
    const md = '~~~\r\nvalue\r\n~~~';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
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
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('const x = 1');
    const range = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(md.slice(range.start.offset, range.end.offset)).toContain('const x = 1');
  });

  test('maps indented code inside a blockquote', () => {
    const md = '>     indented\n>     code';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('indented\ncode');
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps fenced code nested in a list', () => {
    const md = '- item\n    ```\n    value\n    ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('value');
    const range = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('value');
  });

  test('maps multi-line indented code inside a list', () => {
    const md = '- Foo\n\n      bar\n      baz';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('bar\nbaz');
    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(whole.start.offset).toBe(md.indexOf('bar'));
    expect(whole.end.offset).toBe(md.indexOf('baz') + 3);
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps multi-line indented code inside a blockquote list', () => {
    const md = '> - Foo\n>\n>       bar\n>       baz';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('bar\nbaz');
    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(whole.start.offset).toBe(md.indexOf('bar'));
    expect(whole.end.offset).toBe(md.indexOf('baz') + 3);
    expectPerCodeUnitRanges(md, node, sourceMap);
  });

  test('maps empty fenced code inside a blockquote', () => {
    const md = '> ```\n> ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('');
    const point = sourceMap.getSourceRange(node, 0, 0);
    expect(point.start.offset).toBe(md.lastIndexOf('```'));
  });

  test('maps empty fenced code inside a list', () => {
    const md = '- item\n    ```\n    ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
    const point = sourceMap.getSourceRange(node, 0, 0);
    expect(point.start.offset).toBe(md.lastIndexOf('```'));
  });

  test('excludes fenced delimiters and their indentation from code ranges', () => {
    const md = '  ```\n  a\n  b\n  ```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('a\nb');
    expect(sourceMap.getRaw(node)).toBe('```\n  a\n  b\n  ```');
    expect(sourceMap.getSourceRange(node, 0, 1).start.offset).toBe(md.indexOf('a'));
    expect(sourceMap.getSourceRange(node, 2, 3).end.offset).toBe(md.indexOf('b') + 1);
  });

  test('maps an empty fenced code value to its content boundary', () => {
    const md = '```\n\n```';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = codeNodes(ast)[0];
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
    const node = codeNodes(ast)[0];
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
    const node = codeNodes(ast)[0];
    expect(node.value).toBe('');
    const point = sourceMap.getSourceRange(node, 0, 0);
    expect(point.start.offset).toBe(expectedOffset);
    expect(point.end.offset).toBe(expectedOffset);
  });

  test('rejects a code value modified after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('```\nvalue\n```');
    const node = codeNodes(ast)[0];
    node.value = 'changed';
    expect(() => sourceMap.getSourceRange(node, 0, 1)).toThrow(
      SourceMapConsistencyError,
    );
    expect(() => sourceMap.getRaw(node)).toThrow(SourceMapConsistencyError);
  });
});

describe('parseMdWithSourceMap: URL fields → raw source', () => {
  test('maps an inline link URL without its angle-bracket wrapper', () => {
    const md = '[label](<https://x.test/a>)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('https://x.test/a');
    expect(sourceMap.getRaw(node)).toBe(md);
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('https://x.test/a');
  });

  test.each([
    '<https://example.com>',
    'www.example.com',
  ])('does not yet map URL fields for autolinks: %p', (md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(() => sourceMap.getFieldSourceRange(node, 'url', 0, 1))
      .toThrow(SourceMapUnavailableError);
  });

  test('maps URL escapes and entities as atomic source ranges', () => {
    const md = '[label](a\\(b\\)&amp;c)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('a(b)&c');
    expect(md.slice(
      sourceMap.getFieldSourceRange(node, 'url', 1, 2).start.offset,
      sourceMap.getFieldSourceRange(node, 'url', 1, 2).end.offset,
    )).toBe('\\(');
    expect(md.slice(
      sourceMap.getFieldSourceRange(node, 'url', 4, 5).start.offset,
      sourceMap.getFieldSourceRange(node, 'url', 4, 5).end.offset,
    )).toBe('&amp;');
  });

  test('maps the longest parser-valid named URL character reference', () => {
    const entity = '&CounterClockwiseContourIntegral;';
    const md = '[label](' + entity + ')';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('∳');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, 1);
    expect(md.slice(range.start.offset, range.end.offset)).toBe(entity);
  });

  test('maps a definition URL without its title', () => {
    const md = '[id]: <a&amp;b> "title"';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'definition')[0];
    expect(node.url).toBe('a&b');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('a&amp;b');
  });

  test('maps destinations after inline-link whitespace and a line ending', () => {
    const md = '[link](   /uri\n  "title"  )';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('/uri');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('/uri');
  });

  test.each([
    '[foo]:\n/url',
    '[foo]:\n  <my-url>\n  "title"',
  ])('maps a definition destination after a line ending: %p', (md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'definition')[0];
    expect(node.url).toBe(md.includes('my-url') ? 'my-url' : '/url');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe(node.url);
  });

  test.each([
    ['[link]()', 7],
    ['[link](<>)', 8],
    ['[foo]: <>', 8],
  ])('maps an empty URL to its content boundary: %p', (md, offset) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, md.startsWith('[foo]') ? 'definition' : 'link')[0];
    expect(node.url).toBe('');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, 0);
    expect(range.start.offset).toBe(offset);
    expect(range.end.offset).toBe(offset);
  });

  test('maps a definition whose label contains a colon', () => {
    const md = '[a:b]: /url';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'definition')[0];
    expect(node.url).toBe('/url');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('/url');
  });

  test('does not confuse a resource-like sequence inside raw HTML', () => {
    const md = '[<span title="](same)">x</span>](same)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('same');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(range.start.offset).toBe(md.lastIndexOf('(same)') + 1);
  });

  test('does not confuse a nested image destination with the outer link', () => {
    const md = '[![x](<a](same)b>)](same)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('same');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(range.start.offset).toBe(md.lastIndexOf('(same)') + 1);
  });

  test.each([
    ['link', '> [x](\n> \\>\n> )'],
    ['definition', '> [x]:\n> \\>'],
  ])('excludes blockquote markers from a cross-line %s URL', (type, md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, type)[0];
    expect(node.url).toBe('>');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, 1);
    expect(range.start.offset).toBe(md.lastIndexOf('\\>'));
    expect(md.slice(range.start.offset, range.end.offset)).toBe('\\>');
  });

  test('rejects a link URL modified after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('[x](/old)');
    const node = nodesOfType(ast, 'link')[0];
    node.url = '/changed';
    expect(() => sourceMap.getFieldSourceRange(node, 'url', 0, 1))
      .toThrow(SourceMapConsistencyError);
    expect(() => sourceMap.getRaw(node)).toThrow(SourceMapConsistencyError);
  });
});

describe('parseMdWithSourceMap: contract', () => {
  test('getSourceRange start..end covers the whole text node value', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a &amp; b');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    // source is "a &amp; b" = 9 chars
    expect(range.end.offset).toBe(9);
  });

  test('segments are gap-free and monotonic over the value', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('x&amp;y\\(z');
    const t = textNodes(ast)[0];
    const full = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(full.end.offset).toBeGreaterThanOrEqual(full.start.offset);
  });

  test('getSourceRange throws RangeError for out-of-bounds range', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('hello');
    const t = textNodes(ast)[0];
    expect(() => sourceMap.getSourceRange(t, 0, 99)).toThrow(RangeError);
  });

  test('getRaw works for any positioned node (root, paragraph)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('# Title\n\nBody text.');
    // root covers the whole document
    expect(sourceMap.getRaw(ast)).toBe('# Title\n\nBody text.');
    // paragraph covers its own span
    const para = ast.children[1];
    expect(sourceMap.getRaw(para)).toBe('Body text.');
  });

  test('getRaw throws RangeError for a node without a source position', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('hello');
    const orphan = { type: 'text', value: 'x' } as any;
    expect(() => sourceMap.getRaw(orphan)).toThrow(RangeError);
  });

  test('getSourceRange throws RangeError for a foreign node', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('hello');
    const foreign = { type: 'text', value: 'x', position: {} };
    expect(() => sourceMap.getSourceRange(foreign as any, 0, 1)).toThrow(
      RangeError,
    );
  });

  test('atomic entity is not split: any intersecting value range maps to full source span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&Afr;');
    const t = textNodes(ast)[0];
    // '&Afr;' decodes to a surrogate pair (2 UTF-16 units); requesting either
    // unit must return the complete '&Afr;' source span, never a half-entity.
    expect(sourceMap.getSourceRange(t, 0, 1)).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 6, offset: 5 },
    });
    expect(sourceMap.getSourceRange(t, 1, 2)).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 6, offset: 5 },
    });
  });

  test('escape is atomic: requesting the single decoded char returns full escape span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('\\(');
    const t = textNodes(ast)[0];
    expect(sourceMap.getSourceRange(t, 0, 1)).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 3, offset: 2 },
    });
  });

  test('literal segments still support per-code-unit boundaries', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('ab');
    const t = textNodes(ast)[0];
    expect(sourceMap.getSourceRange(t, 0, 1).end.offset).toBe(1);
    expect(sourceMap.getSourceRange(t, 1, 2).start.offset).toBe(1);
  });

  test('CR-only line ending produces correct line/column', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a\rb');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    // matches the parser's own text node end position.
    expect(range.end).toEqual({ line: 2, column: 2, offset: 3 });
  });

  test('CRLF line ending produces correct line/column', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a\r\nb');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start).toEqual({ line: 1, column: 1, offset: 0 });
    expect(range.end).toEqual({ line: 2, column: 2, offset: 4 });
  });

  test('astral Unicode advances column by UTF-16 code units', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a🎉b');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    // parser reports end { line: 1, column: 5, offset: 4 }.
    expect(range.end).toEqual({ line: 1, column: 5, offset: 4 });
    // a half-surrogate query inside a LITERAL astral run maps 1:1 (literal
    // segments are not atomic), which matches the parser's own positions.
    const half = sourceMap.getSourceRange(t, 1, 2);
    expect(half.start.offset).toBe(1);
    expect(half.end.offset).toBe(2);
  });

  test('half-surrogate range inside a literal astral run stays contiguous', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('🎉');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 0, 2);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(2);
  });

  test('illegal numeric reference maps atomically and keeps full raw span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#0;');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(4);
    // getRaw on a text node uses the recorded outer-token span, so it returns
    // the complete raw source including the trailing ';'.
    expect(sourceMap.getRaw(t)).toBe('&#0;');
  });

  test('zero-length range resolves to an accurate source point', () => {
    // 'ab' literal -> [0,0) point at offset 0, [2,2) point at offset 2.
    const ab = parseMdWithSourceMap('ab');
    const tAb = textNodes(ab.ast)[0];
    expect(ab.sourceMap.getSourceRange(tAb, 0, 0).start.offset).toBe(0);
    expect(ab.sourceMap.getSourceRange(tAb, 2, 2).start.offset).toBe(2);

    // '&amp;' -> value '&'; [0,0) is the entity's start = source offset 0.
    const amp = parseMdWithSourceMap('&amp;');
    const tAmp = textNodes(amp.ast)[0];
    expect(amp.sourceMap.getSourceRange(tAmp, 0, 0).start.offset).toBe(0);

    // '&amp;&copy;' -> value '&©'; [1,1) sits between the two entities at
    // source offset 5 (an accurate boundary, not inside an atomic construct).
    const adj = parseMdWithSourceMap('&amp;&copy;');
    const tAdj = textNodes(adj.ast)[0];
    expect(adj.sourceMap.getSourceRange(tAdj, 1, 1).start.offset).toBe(5);
  });

  test('zero-length range inside a multi-code-unit atomic construct throws', () => {
    // '&Afr;' decodes to a surrogate pair (value length 2); [1,1) lands inside
    // the atomic entity, where no accurate source boundary exists.
    const { ast, sourceMap } = parseMdWithSourceMap('&Afr;');
    const t = textNodes(ast)[0];
    expect(() => sourceMap.getSourceRange(t, 1, 1)).toThrow(RangeError);
  });

  test('valueEnd does not swallow the following entity/escape (P1)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = textNodes(ast)[0];
    // 'A&amp;B' decodes to 'A&B'; the range [0, 1) is only the literal 'A'.
    const r = sourceMap.getSourceRange(t, 0, 1);
    expect(r.start.offset).toBe(0);
    expect(r.end.offset).toBe(1);
    // [1, 2) is the whole '&amp;' atomic construct.
    const r2 = sourceMap.getSourceRange(t, 1, 2);
    expect(r2.start.offset).toBe(1);
    expect(r2.end.offset).toBe(6);
  });

  test('adjacent entities: first range does not include the second (P1)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&amp;&copy;');
    const t = textNodes(ast)[0];
    const r = sourceMap.getSourceRange(t, 0, 1);
    expect(r.start.offset).toBe(0);
    expect(r.end.offset).toBe(5);
  });

  test('getRaw rejects a foreign node from another document (P2)', () => {
    const first = parseMdWithSourceMap('AAAA');
    const second = parseMdWithSourceMap('BBBB');
    expect(() => first.sourceMap.getRaw(second.ast.children[0])).toThrow(
      RangeError,
    );
    expect(() =>
      first.sourceMap.getSourceRange(
        second.ast.children[0].children[0],
        0,
        1,
      ),
    ).toThrow(RangeError);
  });

  test('getSourceRange rejects non-integer indices (P4)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('ab');
    const t = textNodes(ast)[0];
    expect(() => sourceMap.getSourceRange(t, 0.5, 1)).toThrow(RangeError);
    expect(() => sourceMap.getSourceRange(t, 0, Infinity)).toThrow(RangeError);
  });

  test('AST is deeply identical to parseMd', () => {
    const { parseMd } = require('./helpers');
    const md = 'A &amp; B with *em* and [link](https://x.com?a&amp;b).';
    const { ast } = parseMdWithSourceMap(md);
    const baseline = parseMd(md);
    expect(JSON.parse(JSON.stringify(ast))).toEqual(
      JSON.parse(JSON.stringify(baseline)),
    );
  });

  test('AST is deeply identical to parseMd for CR / CRLF / astral input', () => {
    const { parseMd } = require('./helpers');
    for (const md of ['a\rb', 'a\r\nb', 'a🎉b', 'A&lt;B\nC&#128;D']) {
      const { ast } = parseMdWithSourceMap(md);
      const baseline = parseMd(md);
      expect(JSON.parse(JSON.stringify(ast))).toEqual(
        JSON.parse(JSON.stringify(baseline)),
      );
    }
  });
});

describe('parseMdWithSourceMap: split and unmapped nodes', () => {
  test('text nodes split around a www autolink each map to their own raw span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap(
      'see www.example.com/?a&amp;b now',
    );
    // The GFM autolink-literal tokenizer splits what would be a single text
    // run into sibling text nodes around the synthesized link.
    const [before, link, after] = (ast.children[0] as any).children;
    expect(before.type).toBe('text');
    expect(link.type).toBe('link');
    expect(after.type).toBe('text');
    expect(before.value).toBe('see ');
    expect(link.children[0].value).toBe('www.example.com/?a&amp;b');
    expect(after.value).toBe(' now');

    // Each split sibling maps back to its own raw span, including the
    // '&amp;' the autolink context keeps literal.
    expect(sourceMap.getRaw(before)).toBe('see ');
    expect(sourceMap.getRaw(link.children[0])).toBe(
      'www.example.com/?a&amp;b',
    );
    expect(sourceMap.getRaw(after)).toBe(' now');

    // Ranges resolve accurately on both sides of the split.
    expect(sourceMap.getSourceRange(before, 0, 4)).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 5, offset: 4 },
    });
    expect(sourceMap.getSourceRange(after, 0, 4)).toEqual({
      start: { line: 1, column: 29, offset: 28 },
      end: { line: 1, column: 33, offset: 32 },
    });

    // Full-range coverage of every split sibling matches its node position.
    for (const t of [before, link.children[0], after]) {
      const full = sourceMap.getSourceRange(t, 0, t.value.length);
      expect(full.start.offset).toBe(t.position.start.offset);
      expect(full.end.offset).toBe(t.position.end.offset);
    }
  });

  test('text nodes split around an email autolink each map to their own raw span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('mail a@b.com now');
    const [before, link, after] = (ast.children[0] as any).children;
    expect(before.value).toBe('mail ');
    expect(link.children[0].value).toBe('a@b.com');
    expect(after.value).toBe(' now');
    expect(sourceMap.getRaw(link.children[0])).toBe('a@b.com');
    expect(sourceMap.getSourceRange(after, 0, 4).start.offset).toBe(12);
    expect(sourceMap.getSourceRange(after, 0, 4).end.offset).toBe(16);
  });

  test('getSourceRange rejects an owned non-text node', () => {
    // Nodes owned by this document but not supported by getSourceRange()
    // (anything that is not a mapped text node) are rejected with a
    // RangeError instead of a fabricated range.
    const { ast, sourceMap } = parseMdWithSourceMap('hello');
    const paragraph = ast.children[0];
    expect(() => sourceMap.getSourceRange(paragraph as any, 0, 1)).toThrow(
      RangeError,
    );
  });
});

describe('parseMdWithSourceMap: error lifecycle', () => {
  /** Run `fn`, returning the error it threw. */
  function thrown(fn: () => unknown): any {
    try {
      fn();
    } catch (err) {
      return err;
    }
    throw new Error('expected the call to throw');
  }

  test('querying a modified text node throws SourceMapConsistencyError', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = textNodes(ast)[0];
    expect(t.value).toBe('A&B');
    t.value = 'changed';
    const err = thrown(() => sourceMap.getSourceRange(t, 0, 1));
    expect(err).toBeInstanceOf(SourceMapConsistencyError);
    expect(err).toBeInstanceOf(SourceMapError);
    // Still a RangeError: existing catch (RangeError) handling keeps working.
    expect(err).toBeInstanceOf(RangeError);
    // The stable code survives minification and cross-instance checks.
    expect(err.name).toBe('SourceMapConsistencyError');
    expect(err.code).toBe('ERR_SOURCE_MAP_CONSISTENCY');
  });

  test('getRaw on a modified text node throws SourceMapConsistencyError', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = textNodes(ast)[0];
    t.value = 'changed';
    const err = thrown(() => sourceMap.getRaw(t));
    expect(err).toBeInstanceOf(SourceMapConsistencyError);
    expect(err.code).toBe('ERR_SOURCE_MAP_CONSISTENCY');
  });

  test('reassigning the identical value keeps the mapping valid', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = textNodes(ast)[0];
    t.value = 'A&B'; // same content as parsed
    expect(sourceMap.getSourceRange(t, 1, 2).start.offset).toBe(1);
    expect(sourceMap.getRaw(t)).toBe('A&amp;B');
  });

  test('unavailable nodes throw SourceMapUnavailableError with a stable code', () => {
    const first = parseMdWithSourceMap('AAAA');
    const second = parseMdWithSourceMap('BBBB');
    const cases: Array<() => unknown> = [
      // foreign node from another document
      () => first.sourceMap.getRaw(second.ast.children[0]),
      () =>
        first.sourceMap.getSourceRange(
          second.ast.children[0].children[0],
          0,
          1,
        ),
      // owned but not a supported text node
      () => first.sourceMap.getSourceRange(first.ast.children[0] as any, 0, 1),
    ];
    for (const fn of cases) {
      const err = thrown(fn);
      expect(err).toBeInstanceOf(SourceMapUnavailableError);
      expect(err).toBeInstanceOf(SourceMapError);
      expect(err).toBeInstanceOf(RangeError);
      expect(err.code).toBe('ERR_SOURCE_MAP_UNAVAILABLE');
    }
  });

  test('rejects a text node added after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('hello');
    const paragraph = ast.children[0] as any;

    // A node pushed into the tree after parsing is not in the source map,
    // even when it carries a position that looks legitimate. The map must
    // not accept it just because a plausible position exists.
    const generated = {
      type: 'text',
      value: 'generated',
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 6, offset: 5 },
      },
    };
    paragraph.children.push(generated);

    const rangeError = thrown(() =>
      sourceMap.getSourceRange(generated, 0, generated.value.length),
    );
    expect(rangeError).toBeInstanceOf(SourceMapUnavailableError);
    expect(rangeError.code).toBe('ERR_SOURCE_MAP_UNAVAILABLE');

    const rawError = thrown(() => sourceMap.getRaw(generated));
    expect(rawError).toBeInstanceOf(SourceMapUnavailableError);
    expect(rawError.code).toBe('ERR_SOURCE_MAP_UNAVAILABLE');
  });

  test('caller argument errors stay plain RangeError (not SourceMapError)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('ab');
    const t = textNodes(ast)[0];
    const cases: Array<() => unknown> = [
      () => sourceMap.getSourceRange(t, 0, 99), // out of bounds
      () => sourceMap.getSourceRange(t, 0.5, 1), // non-integer
      () => sourceMap.getSourceRange(t, 2, 1), // reversed
    ];
    for (const fn of cases) {
      const err = thrown(fn);
      expect(err).toBeInstanceOf(RangeError);
      expect(err).not.toBeInstanceOf(SourceMapError);
    }
    // An empty range inside a multi-code-unit atomic construct is also a
    // caller-facing range error, not a mapping availability problem.
    const afr = parseMdWithSourceMap('&Afr;');
    const tAfr = textNodes(afr.ast)[0];
    const err = thrown(() => afr.sourceMap.getSourceRange(tAfr, 1, 1));
    expect(err).toBeInstanceOf(RangeError);
    expect(err).not.toBeInstanceOf(SourceMapError);
  });

  test('maps from two parses stay isolated and each serves its own nodes', () => {
    const a = parseMdWithSourceMap('A&amp;B');
    const b = parseMdWithSourceMap('C&amp;D');
    const tA = textNodes(a.ast)[0];
    const tB = textNodes(b.ast)[0];
    expect(a.sourceMap.getRaw(tA)).toBe('A&amp;B');
    expect(b.sourceMap.getRaw(tB)).toBe('C&amp;D');
    expect(a.sourceMap.getSourceRange(tA, 0, 3).end.offset).toBe(7);
    expect(b.sourceMap.getSourceRange(tB, 0, 3).end.offset).toBe(7);
  });
});

describe('parseMd vs parseMdWithSourceMap: AST parity corpus', () => {
  const { parseMd } = require('./helpers');

  // A varied corpus exercising tokenizers / mdast decisions that the recording
  // extension must not disturb: entities, escapes, autolinks, GFM (tables,
  // strikethrough, task lists), directives, math, frontmatter, and mixed
  // line endings / astral Unicode.
  const corpus = [
    'A&amp;B',
    '&amp;&copy;',
    'A &amp; B with *em* and [link](https://x.com?a&amp;b).',
    String.raw`\*not emphasis\* and \`code\``,
    'www.example.com and <https://x.com> and <a@b.com>',
    '| a | b |\n| :- | -: |\n| 1 | 2 |',
    '~~struck~~ and a ~~b',
    '- [ ] todo\n- [x] done',
    '::name\ncontent\n::',
    'a\nb\r\nc\r\nd',
    'a\u{1F389}b\u{1D11E}c',
    '$$x^2$$ and `inline code`',
    '---\ntitle: x\n---\n# Heading',
    '> quote with &amp; entity\n> second line',
    '1. one &amp; two\n2. three',
    '`code with &lt; tag` and > quote',
    'text [a](<b &amp; c>) end',
    'pre\n```js\nconst x = 1 &amp; 2;\n```\npost',
    '~~~\r\na\r\n~~~',
    '    a\n\n    b\n',
    '&#0;&#128;&#xFDD0; and &amp;amp;',
    'A&#x1F600;B',
  ];

  test.each(corpus)('parity for: %p', (md) => {
    const { ast } = parseMdWithSourceMap(md);
    const baseline = parseMd(md);
    expect(JSON.parse(JSON.stringify(ast))).toEqual(
      JSON.parse(JSON.stringify(baseline)),
    );
  });

  test('every mapped literal text node is contained in the source', () => {
    const { parseMd } = require('./helpers');
    for (const md of corpus) {
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const collect = (node: any, out: string[]) => {
        if (node.type === 'text' && !/[&\\]/.test(node.value)) {
          out.push(sourceMap.getRaw(node));
        }
        for (const c of node.children || []) collect(c, out);
      };
      const raws: string[] = [];
      collect(ast, raws);
      for (const raw of raws) {
        expect(md).toContain(raw);
      }
      expect(() => parseMd(md)).not.toThrow();
    }
  });
});
