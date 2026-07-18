import { parseMd, parseMdWithSourceMap } from '../helpers';

// Deterministic differential fuzz for the source map.
//
// Rather than hand-picking fixtures, we enumerate combinations of atomic
// Markdown fragments (Cartesian product of pairs and triples). Enumeration is
// deterministic (no RNG, no flake) and systematically exercises "adjacent
// constructs contaminating each other" cases — the class of bug that fixed
// fixtures miss (e.g. #57: an escape leaking its kind into a following CRLF).
//
// For every generated document we assert:
//   1. parseMdWithSourceMap(md).ast deep-equals parseMd(md)  (AST parity)
//   2. per text node: the whole value and every value code-unit range map
//      monotonically inside [0, md.length], and getRaw agrees with the whole
//      value range
//   3. every owned node's getRaw succeeds and equals the source slice of its
//      own position (no exceptions swallowed)
//
// The literal 1:1 contract is verified by a SEPARATE oracle-based check
// (`fragment + '\r\nx'`, below) that derives expected source positions from the
// known input suffix rather than from the map output — so it cannot pass by
// circularly re-deriving the assertion from the result.

const FRAGMENTS: string[] = [
  'a', // plain literal
  'x', // plain literal
  '中', // multi-byte literal
  '\\(', // backslash escape
  '\\\\', // escaped backslash
  '&amp;', // named character reference
  '&#40;', // decimal character reference
  '&#0;', // normalized (illegal) numeric reference
  '&Afr;', // multi-code-unit reference
  '\n', // LF
  '\r\n', // CRLF
  'www.example.com', // gfm www autolink
  '~~s~~', // strikethrough
  '`x`', // inline code
  '$x$', // inline math
];

function textNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === 'text') out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

function allNodes(root: any): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

function checkDocument(md: string): void {
  const parsed = parseMdWithSourceMap(md);
  const { ast, sourceMap } = parsed;

  // 1. AST parity with parseMd.
  expect(ast).toEqual(parseMd(md));

  // 2. Per text node: whole value and all code-unit ranges are monotonic,
  //    bounded by md, and agree with getRaw. This intentionally does not
  //    infer which segments are literal, so it remains independent from the
  //    source map's segment classification.
  for (const node of textNodes(ast)) {
    const value: string = node.value;

    const whole = sourceMap.getSourceRange(node, 0, value.length);
    expect(whole.start.offset).toBeGreaterThanOrEqual(0);
    expect(whole.end.offset).toBeGreaterThanOrEqual(whole.start.offset);
    expect(whole.end.offset).toBeLessThanOrEqual(md.length);

    let previousStart = whole.start.offset;
    let previousEnd = whole.start.offset;
    for (let i = 0; i < value.length; i++) {
      const range = sourceMap.getSourceRange(node, i, i + 1);

      expect(range.start.offset).toBeGreaterThanOrEqual(0);
      expect(range.end.offset).toBeGreaterThanOrEqual(range.start.offset);
      expect(range.end.offset).toBeLessThanOrEqual(md.length);

      expect(range.start.offset).toBeGreaterThanOrEqual(previousStart);
      expect(range.end.offset).toBeGreaterThanOrEqual(previousEnd);

      previousStart = range.start.offset;
      previousEnd = range.end.offset;
    }

    const raw = sourceMap.getRaw(node);
    expect(md.slice(whole.start.offset, whole.end.offset)).toBe(raw);
  }

  // 3. Every owned node (text or not) must have a getRaw that equals the source
  //    slice of its own position. The public contract guarantees every node
  //    returned by the parser carries a complete position, and
  //    parseMdWithSourceMap registers and snapshots the whole tree, so a
  //    successful call is expected everywhere — we do NOT swallow exceptions.
  for (const node of allNodes(ast)) {
    const raw = sourceMap.getRaw(node);
    expect(md.includes(raw)).toBe(true);
    if (node.type !== 'text') {
      expect(raw).toBe(md.slice(node.position.start.offset, node.position.end.offset));
    }
  }
}

describe('source-map differential fuzz (deterministic enumeration)', () => {
  const pairs: string[] = [];
  for (const a of FRAGMENTS) {
    for (const b of FRAGMENTS) pairs.push(a + b);
  }

  test.each(pairs)('pair: %j', (md) => {
    checkDocument(md);
  });

  // A bounded set of triples: fix the middle fragment to the tricky ones
  // (escapes / references / line endings) to keep the matrix reasonable while
  // still exercising three-way adjacency.
  const middles = ['\\(', '&amp;', '&#0;', '\r\n', '\n'];
  const triples: string[] = [];
  for (const a of FRAGMENTS) {
    for (const m of middles) {
      for (const b of FRAGMENTS) triples.push(a + m + b);
    }
  }

  test.each(triples)('triple: %j', (md) => {
    checkDocument(md);
  });

  // Exercise the escape / reference at the start of a line (after a block
  // construct), where the CRLF becomes a line ending of a text run that begins
  // with a construct -- the exact adjacency that produced #57.
  const lineStarts = ['> ', '- ', '1. ', '    '];
  const prefixTriples: string[] = [];
  for (const pre of lineStarts) {
    for (const m of middles) {
      for (const b of FRAGMENTS) prefixTriples.push(pre + m + b);
    }
  }

  test.each(prefixTriples)('line-start: %j', (md) => {
    checkDocument(md);
  });
});

describe('source-map fuzz: literal 1:1 after any preceding construct (#57)', () => {
  // Oracle-based check. For every fragment we build `${fragment}\r\nx` from char
  // codes (to avoid shell control-char mangling) and assert the trailing
  // '\r\nx' maps, 1:1, to the KNOWN suffix positions derived from the input
  // length — not from the map output. This catches the #57 class directly:
  // when a preceding construct leaks its 'escape'/'atomic' kind into the
  // following CRLF, '\r' and '\n' get merged into one segment and the suffix
  // positions drift. The oracle is the generated input, so the assertion cannot
  // pass by circularly re-deriving expectations from the result under test.
  const CR = 13;
  const LF = 10;
  const BS = 92;
  const mk = (codes: number[]) => String.fromCharCode(...codes);
  const X = 'x'.charCodeAt(0);

  // fragment -> char codes (escape fragment needs the backslash char code).
  // Skip line-ending fragments: a '\n' / '\r\n' fragment becomes a hard line
  // break, so the trailing '\r\nx' is not a single literal text run at the
  // suffix. Those cases are already exercised by the generic fuzz + line-start
  // triples. The oracle targets "preceding construct contaminating a following
  // literal", which needs a non-line-ending fragment.
  const lineEndingFragments = new Set(['\n', '\r\n']);
  const fragmentCodes: Array<[string, number[]]> = FRAGMENTS
    .filter((f) => !lineEndingFragments.has(f))
    .map((f) => [
      f,
      f === '\\(' ? [BS, 40] : f === '\\\\' ? [BS, BS] : [...f].map((c) => c.charCodeAt(0)),
    ]);

  test.each(fragmentCodes)('fragment %j then CRLF+x', (_label, codes) => {
    const md = mk([...codes, CR, LF, X]);
    const { ast, sourceMap } = parseMdWithSourceMap(md);

    // Generic invariants hold too.
    checkDocument(md);

    // Locate the trailing literal run inside the text value.
    let text: any;
    (function w(n: any) {
      if (n.type === 'text') text = n;
      for (const c of n.children || []) w(c);
    })(ast);
    const value: string = text.value;
    const cr = value.indexOf(String.fromCharCode(CR));
    expect(cr).toBeGreaterThanOrEqual(0);
    const lf = cr + 1;
    const x = lf + 1;
    expect(value[lf]).toBe(String.fromCharCode(LF));
    expect(value[x]).toBe('x');

    // Oracle: the suffix '\r\nx' occupies the last three code units of md.
    const crAt = md.length - 3;
    const lfAt = md.length - 2;
    const xAt = md.length - 1;

    const crRange = sourceMap.getSourceRange(text, cr, cr + 1);
    const lfRange = sourceMap.getSourceRange(text, lf, lf + 1);
    const xRange = sourceMap.getSourceRange(text, x, x + 1);

    // Each maps to exactly one source code unit at the known suffix position.
    expect(crRange.start.offset).toBe(crAt);
    expect(crRange.end.offset).toBe(crAt + 1);
    expect(lfRange.start.offset).toBe(lfAt);
    expect(lfRange.end.offset).toBe(lfAt + 1);
    expect(xRange.start.offset).toBe(xAt);
    expect(xRange.end.offset).toBe(xAt + 1);
  });
});
