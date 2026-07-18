import { parseMdWithSourceMap, SourceMapUnavailableError } from '../helpers';

/** Collect every text node in document order. */
function textNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === 'text') out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('source-map invariants (public API)', () => {
  // A varied corpus exercising escapes, references, autolinks, CRLF, and
  // mixed transformations. Each fixture is checked purely through the
  // public getRaw() / getSourceRange() API.
  const corpus: Array<[string, string]> = [
    ['backslash escape', '\\('],
    ['escaped backslash', '\\\\'],
    ['non-escapable ascii', '\\a'],
    ['non-escapable cjk', '\\中'],
    ['named reference', '&amp;'],
    ['decimal reference', '&#40;'],
    ['hex reference', '&#x28;'],
    ['multi-unit reference', '&Afr;'],
    ['incomplete entity', '&copy'],
    ['overlong numeric', '&#00000049;'],
    ['null codepoint', '&#0;'],
    ['c1 codepoint', '&#128;'],
    ['noncharacter', '&#xFDD0;'],
    ['autolink literal', '<https://example.com/?a&amp;b>'],
    ['www autolink', 'www.example.com/?a&amp;b'],
    ['crlf multiline', 'line1\r\nline2'],
    ['mixed transformation', '中文\\(A&amp;&#40;B\\)中文'],
    ['paragraph with several text runs', 'a &amp; b *c* d&#40;e&#41;f'],
  ];

  test.each(corpus)('invariants hold for: %s', (_label, md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);

    for (const node of textNodes(ast)) {
      const value: string = node.value;
      const whole = sourceMap.getSourceRange(node, 0, value.length);

      // 1. Whole value maps to a valid, forward source range inside md.
      expect(whole.start.offset).toBeGreaterThanOrEqual(0);
      expect(whole.end.offset).toBeGreaterThanOrEqual(whole.start.offset);
      expect(whole.end.offset).toBeLessThanOrEqual(md.length);

      // 2. Whole range agrees with getRaw(), and the slice equals it.
      const raw = sourceMap.getRaw(node);
      expect(md.slice(whole.start.offset, whole.end.offset)).toBe(raw);

      // 3. Repeated lookups are deterministic.
      const again = sourceMap.getSourceRange(node, 0, value.length);
      expect(again).toEqual(whole);

      // 4. Per-code-unit ranges never move backwards (non-decreasing start
      //    and end). Atomic segments may overlap (e.g. &Afr;), so adjacent
      //    ranges may be equal rather than strictly increasing.
      let prevStart = whole.start.offset;
      let prevEnd = whole.start.offset;
      for (let i = 0; i < value.length; i++) {
        const r = sourceMap.getSourceRange(node, i, i + 1);
        expect(r.start.offset).toBeGreaterThanOrEqual(0);
        expect(r.end.offset).toBeGreaterThanOrEqual(r.start.offset);
        expect(r.end.offset).toBeLessThanOrEqual(md.length);
        expect(r.start.offset).toBeGreaterThanOrEqual(prevStart);
        expect(r.end.offset).toBeGreaterThanOrEqual(prevEnd);
        prevStart = r.start.offset;
        prevEnd = r.end.offset;
      }
    }
  });

  test('a decoded reference range may extend past the text node position', () => {
    // &#0; normalizes to U+FFFD but the source token includes the trailing
    // ';', which lies outside the mdast text node's own position. The map
    // must represent the complete parser token, not truncate to node.position.
    const md = '&#0;';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = textNodes(ast)[0];
    const range = sourceMap.getSourceRange(node, 0, 1);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(4); // full '&#0;', incl. ';'
    expect(range.end.offset).toBeLessThanOrEqual(md.length);
  });

  test('cloned nodes are rejected with SourceMapUnavailableError', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const node = textNodes(ast)[0];
    const cloned = structuredClone(node);

    expect(cloned.value).toBe(node.value);
    expect(cloned).not.toBe(node); // different object identity

    expect(() => sourceMap.getRaw(cloned)).toThrow(SourceMapUnavailableError);
    expect(() => sourceMap.getSourceRange(cloned, 0, 1)).toThrow(
      SourceMapUnavailableError,
    );
  });
});
