import fc from 'fast-check';
import {
  SourceMapConsistencyError,
  SourceMapUnavailableError,
  parseMd,
  parseMdWithSourceMap,
} from '../helpers';

const ATOMS = [
  'a',
  '中',
  '🎉',
  ' ',
  '\t',
  '\n',
  '\r',
  '\r\n',
  '*',
  '**',
  '_',
  '`',
  '```',
  '\\(',
  '\\\\',
  '&amp;',
  '&#40;',
  '&#0;',
  '&Afr;',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '- ',
  '1. ',
  '> ',
] as const;

const CONSTRUCTS = [
  '`x`',
  '`` a ``',
  '```\ncode\n```',
  '    code\n',
  '\tcode\n',
  '> \tcode\n',
  '- Foo\n\n\t  bar\n\t  baz',
  '[x](a\\(b\\)&amp;c)',
  '[x](<a&amp;b>)',
  '[x]()',
  '[x](<>)',
  '[x]: a&amp;b\n',
  '<https://example.com>',
  'www.example.com',
] as const;

const atomSequence = (maxLength: number) => fc
  .array(fc.constantFrom(...ATOMS), { minLength: 0, maxLength })
  .map(parts => parts.join(''));

const markdownArbitrary = fc.oneof(
  atomSequence(48),
  fc.tuple(
    atomSequence(12),
    fc.constantFrom(...CONSTRUCTS),
    atomSequence(12),
  ).map(parts => parts.join('')),
);

// Use the reported seed and path to replay a failed generated case.
const FUZZ_SEED = process.env.FAST_CHECK_SEED
  ? Number.parseInt(process.env.FAST_CHECK_SEED, 10)
  : 0x135138;

function allNodes(root: any): any[] {
  const nodes: any[] = [];
  (function walk(node: any) {
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  })(root);
  return nodes;
}

function isMappedValueNode(node: any): boolean {
  return (
    node.type === 'text'
    || node.type === 'inlineCode'
    || node.type === 'code'
  ) && typeof node.value === 'string';
}

function expectBoundedRange(range: any, sourceLength: number): void {
  expect(range.start.offset).toBeGreaterThanOrEqual(0);
  expect(range.end.offset).toBeGreaterThanOrEqual(range.start.offset);
  expect(range.end.offset).toBeLessThanOrEqual(sourceLength);
}

function checkValueMapping(
  sourceMap: any,
  node: any,
  md: string,
): void {
  const ranges: any[] = [];
  let previousStart = 0;
  let previousEnd = 0;

  for (let index = 0; index < node.value.length; index++) {
    const range = sourceMap.getSourceRange(node, index, index + 1);
    expectBoundedRange(range, md.length);
    expect(range.start.offset).toBeGreaterThanOrEqual(previousStart);
    expect(range.end.offset).toBeGreaterThanOrEqual(previousEnd);
    previousStart = range.start.offset;
    previousEnd = range.end.offset;
    ranges.push(range);
  }

  if (ranges.length > 0) {
    try {
      const whole = sourceMap.getSourceRange(node, 0, node.value.length);
      expectBoundedRange(whole, md.length);
      expect(whole.start.offset).toBe(ranges[0].start.offset);
      expect(whole.end.offset).toBe(ranges[ranges.length - 1].end.offset);
      if (node.type === 'text') {
        expect(md.slice(whole.start.offset, whole.end.offset))
          .toBe(sourceMap.getRaw(node));
      }
    }
    catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect((error as Error).message).toContain('non-contiguous source segments');
    }
  }

  const original = node.value;
  node.value = `${original}x`;
  expect(() => sourceMap.getSourceRange(node, 0, 1))
    .toThrow(SourceMapConsistencyError);
  node.value = original;
}

function checkUrlMapping(
  sourceMap: any,
  node: any,
  md: string,
  raw: string,
): void {
  const hasDestination = node.type === 'definition'
    || (node.type === 'link' && raw.startsWith('['));
  if (!hasDestination) {
    expect(() => sourceMap.getFieldSourceRange(node, 'url', 0, 0))
      .toThrow(SourceMapUnavailableError);
    return;
  }

  const whole = sourceMap.getFieldSourceRange(
    node,
    'url',
    0,
    node.url.length,
  );
  expectBoundedRange(whole, md.length);

  let previousStart = whole.start.offset;
  let previousEnd = whole.start.offset;
  for (let index = 0; index < node.url.length; index++) {
    const range = sourceMap.getFieldSourceRange(node, 'url', index, index + 1);
    expectBoundedRange(range, md.length);
    expect(range.start.offset).toBeGreaterThanOrEqual(previousStart);
    expect(range.end.offset).toBeGreaterThanOrEqual(previousEnd);
    previousStart = range.start.offset;
    previousEnd = range.end.offset;
  }

  const original = node.url;
  node.url = `${original}x`;
  expect(() => sourceMap.getFieldSourceRange(node, 'url', 0, 0))
    .toThrow(SourceMapConsistencyError);
  node.url = original;
}

function checkDocument(md: string): void {
  const baseline = parseMd(md);
  const { ast, sourceMap } = parseMdWithSourceMap(md);
  expect(ast).toEqual(baseline);

  const nodes = allNodes(ast);
  for (const node of nodes) {
    expect(node.position).toBeDefined();
    expect(node.position.start.offset).toBeGreaterThanOrEqual(0);
    expect(node.position.end.offset)
      .toBeGreaterThanOrEqual(node.position.start.offset);
    expect(node.position.end.offset).toBeLessThanOrEqual(md.length);

    const raw = sourceMap.getRaw(node);
    if (node.type !== 'text') {
      expect(raw).toBe(md.slice(
        node.position.start.offset,
        node.position.end.offset,
      ));
    }

    if (isMappedValueNode(node))
      checkValueMapping(sourceMap, node, md);

    if (
      (node.type === 'link' || node.type === 'definition')
      && typeof node.url === 'string'
    ) {
      checkUrlMapping(sourceMap, node, md, raw);
    }
  }
}

describe('parser and source-map property fuzz', () => {
  test('generated Markdown preserves parser and mapping invariants', () => {
    fc.assert(
      fc.property(markdownArbitrary, checkDocument),
      {
        seed: FUZZ_SEED,
        path: process.env.FAST_CHECK_PATH,
        numRuns: 1000,
      },
    );
  }, 20_000);
});
