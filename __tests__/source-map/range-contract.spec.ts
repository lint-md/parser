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

describe('parseMdWithSourceMap: contract', () => {
  test('getSourceRange start..end covers the whole text node value', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a &amp; b');
    const t = nodesOfType(ast, 'text')[0];
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start.offset).toBe(0);
    // source is "a &amp; b" = 9 chars
    expect(range.end.offset).toBe(9);
  });

  test('segments are gap-free and monotonic over the value', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('x&amp;y\\(z');
    const t = nodesOfType(ast, 'text')[0];
    const full = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(full.end.offset).toBeGreaterThanOrEqual(full.start.offset);
  });

  test('getSourceRange throws RangeError for out-of-bounds range', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('hello');
    const t = nodesOfType(ast, 'text')[0];
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
    const t = nodesOfType(ast, 'text')[0];
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
    const t = nodesOfType(ast, 'text')[0];
    expect(sourceMap.getSourceRange(t, 0, 1)).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 3, offset: 2 },
    });
  });

  test('literal segments still support per-code-unit boundaries', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('ab');
    const t = nodesOfType(ast, 'text')[0];
    expect(sourceMap.getSourceRange(t, 0, 1).end.offset).toBe(1);
    expect(sourceMap.getSourceRange(t, 1, 2).start.offset).toBe(1);
  });

  test('CR-only line ending produces correct line/column', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a\rb');
    const t = nodesOfType(ast, 'text')[0];
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    // matches the parser's own text node end position.
    expect(range.end).toEqual({ line: 2, column: 2, offset: 3 });
  });

  test('CRLF line ending produces correct line/column', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a\r\nb');
    const t = nodesOfType(ast, 'text')[0];
    const range = sourceMap.getSourceRange(t, 0, t.value.length);
    expect(range.start).toEqual({ line: 1, column: 1, offset: 0 });
    expect(range.end).toEqual({ line: 2, column: 2, offset: 4 });
  });

  test('astral Unicode advances column by UTF-16 code units', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('a🎉b');
    const t = nodesOfType(ast, 'text')[0];
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
    const t = nodesOfType(ast, 'text')[0];
    const range = sourceMap.getSourceRange(t, 0, 2);
    expect(range.start.offset).toBe(0);
    expect(range.end.offset).toBe(2);
  });

  test('illegal numeric reference maps atomically and keeps full raw span', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('&#0;');
    const t = nodesOfType(ast, 'text')[0];
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
    const tAb = nodesOfType(ab.ast, 'text')[0];
    expect(ab.sourceMap.getSourceRange(tAb, 0, 0).start.offset).toBe(0);
    expect(ab.sourceMap.getSourceRange(tAb, 2, 2).start.offset).toBe(2);

    // '&amp;' -> value '&'; [0,0) is the entity's start = source offset 0.
    const amp = parseMdWithSourceMap('&amp;');
    const tAmp = nodesOfType(amp.ast, 'text')[0];
    expect(amp.sourceMap.getSourceRange(tAmp, 0, 0).start.offset).toBe(0);

    // '&amp;&copy;' -> value '&©'; [1,1) sits between the two entities at
    // source offset 5 (an accurate boundary, not inside an atomic construct).
    const adj = parseMdWithSourceMap('&amp;&copy;');
    const tAdj = nodesOfType(adj.ast, 'text')[0];
    expect(adj.sourceMap.getSourceRange(tAdj, 1, 1).start.offset).toBe(5);
  });

  test('zero-length range inside a multi-code-unit atomic construct throws', () => {
    // '&Afr;' decodes to a surrogate pair (value length 2); [1,1) lands inside
    // the atomic entity, where no accurate source boundary exists.
    const { ast, sourceMap } = parseMdWithSourceMap('&Afr;');
    const t = nodesOfType(ast, 'text')[0];
    expect(() => sourceMap.getSourceRange(t, 1, 1)).toThrow(RangeError);
  });

  test('valueEnd does not swallow the following entity/escape (P1)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = nodesOfType(ast, 'text')[0];
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
    const t = nodesOfType(ast, 'text')[0];
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
    const t = nodesOfType(ast, 'text')[0];
    expect(() => sourceMap.getSourceRange(t, 0.5, 1)).toThrow(RangeError);
    expect(() => sourceMap.getSourceRange(t, 0, Infinity)).toThrow(RangeError);
  });
});
