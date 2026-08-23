import { parseMdWithSourceMap } from '../helpers';

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
