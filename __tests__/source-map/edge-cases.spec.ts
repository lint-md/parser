import { parseMdWithSourceMap } from '../helpers';

/** Return the first text node in document order. */
function textNode(root: any): any {
  let found: any = null;
  (function walk(n: any) {
    if (!found && n.type === 'text') found = n;
    for (const c of n.children || []) walk(c);
  })(root);
  return found;
}

const REPLACEMENT = '\uFFFD';

describe('source-map edge cases', () => {
  // Expected values follow the parser's ACTUAL output rather than CommonMark
  // theory (e.g. this stack decodes '&#X41;' but keeps '&#x0000028;' literal).
  test.each<[string, string, string]>([
    ['backslash before non-punctuation', '\\a', '\\a'],
    ['backslash before CJK', '\\中', '\\中'],
    ['unknown named reference', '&unknown;', '&unknown;'],
    ['unknown long named reference', '&notARealEntity;', '&notARealEntity;'],
    ['uppercase-X numeric (decoded by this parser)', '&#X41;', 'A'],
    ['overlong padded hex (kept literal)', '&#x0000028;', '&#x0000028;'],
    ['control codepoint normalizes to U+FFFD', '&#11;', REPLACEMENT],
    ['DEL normalizes to U+FFFD', '&#127;', REPLACEMENT],
    ['noncharacter normalizes to U+FFFD', '&#xFFFF;', REPLACEMENT],
  ])('edge case: %s', (_label, md, expectedValue) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = textNode(ast);
    expect(node.value).toBe(expectedValue);

    // Each fixture produces a single text node covering the whole input, so
    // assert the exact source span independently of getRaw(). This catches
    // mappings that drop a leading/trailing character symmetrically (e.g.
    // '&unknown;' -> 'unknown;'), which getRaw()/slice agreement alone would
    // not detect since both derive from the same internal mapping.
    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
    expect([whole.start.offset, whole.end.offset]).toEqual([0, md.length]);
    expect(sourceMap.getRaw(node)).toBe(md);
    expect(md.slice(whole.start.offset, whole.end.offset)).toBe(md);

    // Per-index ranges are non-decreasing.
    let prevStart = whole.start.offset;
    let prevEnd = whole.start.offset;
    for (let i = 0; i < node.value.length; i++) {
      const r = sourceMap.getSourceRange(node, i, i + 1);
      expect(r.start.offset).toBeGreaterThanOrEqual(prevStart);
      expect(r.end.offset).toBeGreaterThanOrEqual(prevEnd);
      prevStart = r.start.offset;
      prevEnd = r.end.offset;
    }
  });

  test('mixed transformation fixture maps each atomic token to its full source', () => {
    const md = '中文\\(A&amp;&#40;B\\)中文';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = textNode(ast);
    expect(node.value).toBe('中文(A&(B)中文');

    // Whole value covers the entire input and agrees with getRaw().
    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
    expect([whole.start.offset, whole.end.offset]).toEqual([0, md.length]);
    expect(sourceMap.getRaw(node)).toBe(md);

    // Every atomic token (escape / reference) maps to its exact raw source,
    // while literal runs map 1:1. Assert the sliced raw string, not just the
    // range length.
    const atomicTokens: Array<[number, string]> = [
      [2, '\\('], // value[2] '(' from the '\(' escape
      [4, '&amp;'], // value[4] '&' from the '&amp;' named reference
      [5, '&#40;'], // value[5] '(' from the '&#40;' decimal reference
      [7, '\\)'], // value[7] ')' from the '\)' escape
    ];
    for (const [index, expectedRaw] of atomicTokens) {
      const range = sourceMap.getSourceRange(node, index, index + 1);
      expect(md.slice(range.start.offset, range.end.offset)).toBe(expectedRaw);
    }
  });
});

describe('CRLF after an escape / reference maps per code unit (#57)', () => {
  // A CRLF immediately after an escape or character reference must not inherit
  // the preceding construct's kind. If it did, the '\r' and '\n' would be
  // treated as one atomic segment: both code units would map to the whole
  // '\r\n' (overlapping), and the empty range at the CR/LF boundary would throw.
  test.each<[string, string]>([
    ['escape then CRLF', '\\(\r\nx'],
    ['named reference then CRLF', '&amp;\r\nx'],
    ['normalized numeric reference then CRLF', '&#0;\r\nx'],
  ])('%s', (_label, md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = textNode(ast);
    const value: string = node.value;

    // Locate the CR and LF within the decoded value.
    const cr = value.indexOf('\r');
    expect(cr).toBeGreaterThanOrEqual(0);
    const lf = cr + 1;
    expect(value[lf]).toBe('\n');

    // '\r' and '\n' are literal, 1:1 code units: each maps to exactly one
    // source code unit, and the two ranges are adjacent (not overlapping).
    const crRange = sourceMap.getSourceRange(node, cr, cr + 1);
    const lfRange = sourceMap.getSourceRange(node, lf, lf + 1);
    expect(md.slice(crRange.start.offset, crRange.end.offset)).toBe('\r');
    expect(md.slice(lfRange.start.offset, lfRange.end.offset)).toBe('\n');
    expect(crRange.end.offset).toBe(lfRange.start.offset);
    expect(lfRange.start.offset - crRange.start.offset).toBe(1);

    // The empty range at the CR/LF boundary resolves to the exact point between
    // them instead of throwing (it is not inside a multi-unit atomic segment).
    const between = sourceMap.getSourceRange(node, lf, lf);
    expect(between.start.offset).toBe(crRange.end.offset);
    expect(between.end.offset).toBe(crRange.end.offset);
  });
});
