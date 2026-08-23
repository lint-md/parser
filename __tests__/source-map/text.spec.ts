import { parseMdWithSourceMap } from '../helpers';

/** Collect matching nodes in document order. */
function nodesOfType(root: any, type: string): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('parseMdWithSourceMap: non-contiguous source ranges', () => {
  test.each([
    ['blockquote continuation', '> hello\n>  world'],
    ['list continuation', '- hello\n  world'],
  ])('%s rejects a range that would include container syntax', (_label, md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'text')[0];

    expect(node.value).toBe('hello\nworld');
    expect(() => sourceMap.getSourceRange(node, 0, node.value.length)).toThrow(
      'getSourceRange: value range crosses non-contiguous source segments',
    );
  });

  test('a blockquote range contained in one source segment remains available', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('> hello\n>  world');
    const node = nodesOfType(ast, 'text')[0];
    const range = sourceMap.getSourceRange(node, 0, 5);

    expect('> hello\n>  world'.slice(range.start.offset, range.end.offset)).toBe(
      'hello',
    );
  });

  test('a partial range crossing a source gap is rejected', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('> hello\n>  world');
    const node = nodesOfType(ast, 'text')[0];

    expect(() => sourceMap.getSourceRange(node, 3, 8)).toThrow(
      'getSourceRange: value range crosses non-contiguous source segments',
    );
  });
});

describe('parseMdWithSourceMap: text.value → raw source', () => {
  test('backslash escape \\( maps to a 2-char source span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('\\(');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('(');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(2);
    expect(sourceMap.getRaw(t)).toBe('\\(');
  });

  test('backslash escape \\\\ maps to a 2-char source span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('\\\\');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('\\');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(2);
  });

  test('named character reference &amp;', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&amp;');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('&');
    // the whole '&amp;' (5 chars) decodes to one '&'.
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('decimal numeric reference &#40;', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#40;');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('(');
    // the whole '&#40;' (5 chars) decodes to one '('.
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('hex numeric reference &#x28;', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#x28;');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('(');
    // the whole '&#x28;' (6 chars) decodes to one '('.
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(6);
  });

  test('named reference decoding to two UTF-16 code units (&Afr;)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&Afr;');
    const t = nodesOfType(ast, 'text')[0];
    // 𝔄 is a surrogate pair: 2 UTF-16 code units.
    expect([...t.value]).toHaveLength(1);
    expect(t.value.length).toBe(2);
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('nameless/incomplete entity &copy is kept literal', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&copy');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('&copy');
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(5);
  });

  test('over-length numeric reference &#00000049; stays literal', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#00000049;');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('&#00000049;');
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(11);
  });

  test('null numeric reference &#0; normalizes to replacement char', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#0;');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('�');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(4);
  });

  test('C1 control numeric reference &#128; normalizes to replacement char', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#128;');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('�');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(6);
  });

  test('noncharacter numeric reference &#xFDD0; normalizes to replacement char', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#xFDD0;');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('�');
    const range = sourceMap.getSourceRange(t, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(8);
  });

  test('autolink literal keeps &amp; literal (the core constraint)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap(
      '<https://example.com/?a&amp;b>',
    );
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('https://example.com/?a&amp;b');
    // The whole value is literal; no decoding happened.
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(1);
    expect(range.end.offset).toBe(29);
  });

  test('www. autolink literal keeps &amp; literal (same as explicit autolink)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('www.example.com/?a&amp;b');
    const t = nodesOfType(ast, 'text')[0];
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
    const t = nodesOfType(ast, 'text')[0];
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
    const t = nodesOfType(ast, 'text')[0];
    // remark preserves the raw CRLF inside the text value.
    expect(t.value).toBe('line1\r\nline2');
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(12); // line1(5) + CRLF(2) + line2(5)
  });

  test('getRaw of a multi-segment text node returns its full source span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&lt;B');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('A<B');
    expect(sourceMap.getRaw(t)).toBe('A&lt;B');
    const full = sourceMap.getSourceRange(t, 0, t.value.length);
    // A(0..1) + decoded '<' from '&lt;'(1..5) + B(5..6)
    expect(full.start.offset).toBe(0);
    expect(full.end.offset).toBe(6);
  });
});
