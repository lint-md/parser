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

    const whole = sourceMap.getSourceRange(node, 0, node.value.length);
    expect(whole.start.offset).toBeGreaterThanOrEqual(0);
    expect(whole.end.offset).toBeGreaterThanOrEqual(whole.start.offset);
    expect(whole.end.offset).toBeLessThanOrEqual(md.length);
    expect(md.slice(whole.start.offset, whole.end.offset)).toBe(
      sourceMap.getRaw(node),
    );

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

    // value[2] = '(' from the '\(' escape -> 2-char source token.
    const escapeRange = sourceMap.getSourceRange(node, 2, 3);
    expect(escapeRange.end.offset - escapeRange.start.offset).toBe(2);

    // value[5] = '(' from the '&#40;' reference -> 5-char source token.
    const refRange = sourceMap.getSourceRange(node, 5, 6);
    expect(refRange.end.offset - refRange.start.offset).toBe(5);
  });
});
