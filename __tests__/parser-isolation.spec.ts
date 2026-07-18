import { parseMd, parseMdWithSourceMap } from './helpers';

// These tests exercise the built package purely through its public API.
// Internal-structure assertions (that each processor holds an independent,
// emptied autolink-extension clone and that the shared singleton is never
// mutated) live in index.spec.ts, which runs the bundled artifact against the
// real ESM `mdast-util-gfm-autolink-literal` in child processes — the only
// place those objects are reachable, since the ESM-only dependency and the
// internal `createParserProcessor` cannot be imported under ts-jest (CJS).

function allNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('parser isolation: default behavior compatibility', () => {
  test('angle-bracket URI autolink stays a link', () => {
    expect(parseMd('<https://example.com>').children[0].children[0].type).toBe(
      'link',
    );
  });

  test('www autolink (tokenizer) stays a link', () => {
    expect(parseMd('www.example.com').children[0].children[0].type).toBe('link');
  });

  test('bare url-like text stays text (position-unsafe transform disabled)', () => {
    const first = parseMd('"www.google.com"').children[0].children[0];
    expect(first.type).toBe('text');
    expect(first.value).toContain('www.google.com');
  });

  test('GFM tables, task lists, strikethrough, refs/escapes, frontmatter, directives, math parse', () => {
    const corpus = [
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '- [x] done\n- [ ] todo',
      '~~struck~~',
      'a &amp; b \\( c',
      '---\ntitle: x\n---\n',
      ':::note\nhello\n:::\n',
      'inline $a+b$ and $$\nx=1\n$$',
    ];
    for (const md of corpus) {
      expect(() => parseMd(md)).not.toThrow();
      expect(parseMd(md).type).toBe('root');
    }
  });
});

describe('parser isolation: contracts preserved', () => {
  const fixtures = [
    'www.example.com',
    '"www.google.com"',
    'a &amp; b \\( c',
    '| a | b |\n|---|---|\n| 1 | 2 |',
    '- [x] done',
    '~~s~~ and <https://ex.com>',
    '---\nt: 1\n---\n:::note\nhi\n:::\ninline $x$',
  ];

  test.each(fixtures)('every node has a complete numeric position: %s', (md) => {
    for (const node of allNodes(parseMd(md))) {
      const p = node.position;
      expect(p).toBeDefined();
      for (const point of [p.start, p.end]) {
        expect(typeof point.line).toBe('number');
        expect(typeof point.column).toBe('number');
        expect(typeof point.offset).toBe('number');
      }
    }
  });

  test.each(fixtures)(
    'parseMd and parseMdWithSourceMap.ast are deeply equal: %s',
    (md) => {
      expect(parseMdWithSourceMap(md).ast).toEqual(parseMd(md));
    },
  );

  test('interleaved parsing of unrelated documents does not leak state', () => {
    const a = 'www.example.com';
    const b = '"www.google.com"';
    const c = '<https://ex.com>';

    const a1 = parseMd(a);
    const b1 = parseMd(b);
    const a2 = parseMd(a);
    const c1 = parseMdWithSourceMap(c).ast;
    const b2 = parseMd(b);
    const c2 = parseMd(c);

    // Repeated parses of the same input are stable regardless of interleaving.
    expect(a2).toEqual(a1);
    expect(b2).toEqual(b1);
    expect(c2).toEqual(c1);

    // And the distinguishing behaviors still hold after interleaving.
    expect(a1.children[0].children[0].type).toBe('link');
    expect(b1.children[0].children[0].type).toBe('text');
    expect(c1.children[0].children[0].type).toBe('link');
  });
});
