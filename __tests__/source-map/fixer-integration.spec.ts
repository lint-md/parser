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

/** Apply [start,end) replacements to markdown, right-to-left so that earlier
 *  offsets are not invalidated by later edits. */
function applyReplacements(
  markdown: string,
  replacements: Array<{ start: number; end: number; text: string }>,
): string {
  let result = markdown;
  for (const { start, end, text } of [...replacements].sort(
    (a, b) => b.start - a.start,
  )) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return result;
}

describe('source-map fixer integration', () => {
  test('backslash escapes are replaced completely (including the backslash)', () => {
    const md = '中文\\(test\\)中文';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = textNode(ast);
    const value: string = node.value; // 中文(test)中文

    const openParen = value.indexOf('(');
    const closeParen = value.indexOf(')');
    const openRange = sourceMap.getSourceRange(node, openParen, openParen + 1);
    const closeRange = sourceMap.getSourceRange(node, closeParen, closeParen + 1);

    // The complete escape sequence (backslash + paren) is mapped, not just
    // the decoded '('.
    expect(openRange.end.offset - openRange.start.offset).toBe(2);
    expect(closeRange.end.offset - closeRange.start.offset).toBe(2);

    const result = applyReplacements(md, [
      { start: openRange.start.offset, end: openRange.end.offset, text: '（' },
      { start: closeRange.start.offset, end: closeRange.end.offset, text: '）' },
    ]);
    expect(result).toBe('中文（test）中文');
  });

  test('character references are replaced completely (including the semicolon)', () => {
    const md = '中文&#40;test&#41;中文';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = textNode(ast);
    const value: string = node.value; // 中文(test)中文

    const openParen = value.indexOf('(');
    const closeParen = value.indexOf(')');
    const openRange = sourceMap.getSourceRange(node, openParen, openParen + 1);
    const closeRange = sourceMap.getSourceRange(node, closeParen, closeParen + 1);

    // The complete reference (e.g. '&#40;', 5 chars) is mapped, not the first
    // source character.
    expect(openRange.end.offset - openRange.start.offset).toBe(5);
    expect(closeRange.end.offset - closeRange.start.offset).toBe(5);

    const result = applyReplacements(md, [
      { start: openRange.start.offset, end: openRange.end.offset, text: '（' },
      { start: closeRange.start.offset, end: closeRange.end.offset, text: '）' },
    ]);
    expect(result).toBe('中文（test）中文');
  });
});
