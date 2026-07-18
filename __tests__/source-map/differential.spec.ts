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
//   2. for every text node:
//      - the whole value has a mapping inside [0, md.length]
//      - per-code-unit ranges are monotonic (never move backwards)
//      - literal code units map 1:1 (a single value code unit whose source
//        slice is one code unit must equal that code unit)
//      - getRaw agrees with the whole-value range
//   3. getRaw(any owned node) stays within [0, md.length]

const FRAGMENTS: string[] = [
  'a', // plain literal
  'x', // plain literal (trailing anchor for escape+CRLF adjacency)
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

  // 2. Per text node invariants.
  for (const node of textNodes(ast)) {
    const value: string = node.value;

    const whole = sourceMap.getSourceRange(node, 0, value.length);
    expect(whole.start.offset).toBeGreaterThanOrEqual(0);
    expect(whole.end.offset).toBeGreaterThanOrEqual(whole.start.offset);
    expect(whole.end.offset).toBeLessThanOrEqual(md.length);

    const raw = sourceMap.getRaw(node);
    expect(md.slice(whole.start.offset, whole.end.offset)).toBe(raw);

    // Record every single-code-unit source range so we can assert adjacency
    // between consecutive literal code units. A literal input code unit must
    // map 1:1 to exactly one source code unit. If two adjacent value code units
    // are both literal (each width 1), the source ranges must be adjacent with
    // no gap and no overlap — this is what catches #57, where a CRLF placed
    // right after an escape inherits the escape kind and gets merged into a
    // single atomic segment (the '\r' would map to the whole '\r\n').
    type UnitRange = { start: number; end: number; literal: boolean };
    const units: UnitRange[] = [];
    for (let i = 0; i < value.length; i++) {
      const r = sourceMap.getSourceRange(node, i, i + 1);
      // Inside md and forward.
      expect(r.start.offset).toBeGreaterThanOrEqual(0);
      expect(r.end.offset).toBeGreaterThanOrEqual(r.start.offset);
      expect(r.end.offset).toBeLessThanOrEqual(md.length);

      const slice = md.slice(r.start.offset, r.end.offset);
      const literal = slice.length === 1 && slice === value[i];
      if (literal) {
        expect(r.end.offset - r.start.offset).toBe(1);
      }
      units.push({ start: r.start.offset, end: r.end.offset, literal });
    }

    for (let i = 1; i < units.length; i++) {
      // Monotonic (atomic segments may repeat the same source span across the
      // decoded value units, so >=, not >).
      expect(units[i].start).toBeGreaterThanOrEqual(units[i - 1].start);
      expect(units[i].end).toBeGreaterThanOrEqual(units[i - 1].end);
      // Two adjacent literal (1:1) code units must be exactly adjacent in
      // source with no gap. This is the detectable part of the #57 class: a
      // literal code unit ('\r' / '\n') that has been widened into an atomic
      // segment would break this adjacency.
      if (units[i - 1].literal && units[i].literal) {
        expect(units[i].start).toBe(units[i - 1].end);
      }
    }
  }

  // 3. getRaw for every owned node stays within md.
  for (const node of allNodes(ast)) {
    let raw: string;
    try {
      raw = sourceMap.getRaw(node);
    } catch {
      // Some nodes legitimately have no mapping/position; that path is covered
      // elsewhere. Here we only assert that when getRaw succeeds, it is sound.
      continue;
    }
    expect(md.includes(raw)).toBe(true);
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

describe('source-map fuzz: #57 regression anchors (escape/reference + CRLF)', () => {
  // These specific inputs reproduce #57: an escape or character reference
  // immediately followed by a CRLF. Without the fix the CRLF inherits the
  // preceding construct's kind and merges into one atomic segment, so '\\r'
  // and '\\n' both map to the whole '\\r\\n' (overlapping). The generic
  // invariants above cannot see segment kind, so we assert the CR/LF contract
  // directly here. Built from char codes to avoid shell control-char mangling.
  const CR = 13;
  const LF = 10;
  const BS = 92;
  const mk = (codes: number[]) => String.fromCharCode(...codes);

  const anchors: Array<[string, string]> = [
    ['escape then CRLF', mk([BS, 40, CR, LF, 'x'.charCodeAt(0)])],
    ['named reference then CRLF', mk([38, 97, 109, 112, 59, CR, LF, 'x'.charCodeAt(0)])],
    ['numeric reference then CRLF', mk([38, 35, 48, 59, CR, LF, 'x'.charCodeAt(0)])],
  ];

  test.each(anchors)('%s', (_label, md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    let text: any;
    (function w(n: any) {
      if (n.type === 'text') text = n;
      for (const c of n.children || []) w(c);
    })(ast);

    // Generic invariants still hold for these docs.
    checkDocument(md);

    const value: string = text.value;
    const cr = value.indexOf(String.fromCharCode(CR));
    expect(cr).toBeGreaterThanOrEqual(0);
    const lf = cr + 1;
    expect(value[lf]).toBe(String.fromCharCode(LF));

    const crRange = sourceMap.getSourceRange(text, cr, cr + 1);
    const lfRange = sourceMap.getSourceRange(text, lf, lf + 1);
    expect(md.slice(crRange.start.offset, crRange.end.offset)).toBe(String.fromCharCode(CR));
    expect(md.slice(lfRange.start.offset, lfRange.end.offset)).toBe(String.fromCharCode(LF));
    expect(crRange.end.offset).toBe(lfRange.start.offset);
  });
});
