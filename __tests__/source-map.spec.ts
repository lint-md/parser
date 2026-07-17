import { parseMdWithSourceMap } from './helpers';

/** Collect every `text` node in document order. */
function textNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === 'text') out.push(n);
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
    // unit must return the complete '&#x27;' source span, never a half-entity.
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

  test('illegal numeric reference maps atomically and keeps raw span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#0;');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(4);
    // getRaw reflects the AST node's own position (which the parser ends
    // before the ';' for a replacement character).
    expect(sourceMap.getRaw(t)).toBe('&#0');
  });

  test('zero-length range resolves to a point', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('ab');
    const t = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(t, 1, 1);
    expect(range.start.offset).toBe(range.end.offset);
    expect(range.start.offset).toBe(1);
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
