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
