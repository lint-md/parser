import {
  SourceMapConsistencyError,
  SourceMapUnavailableError,
  parseMdWithSourceMap,
} from '../helpers';

/** Collect matching nodes in document order. */
function nodesOfType(root: any, type: string): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('parseMdWithSourceMap: URL fields → raw source', () => {
  test('maps an inline link URL without its angle-bracket wrapper', () => {
    const md = '[label](<https://x.test/a>)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('https://x.test/a');
    expect(sourceMap.getRaw(node)).toBe(md);
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('https://x.test/a');
  });

  test.each([
    '<https://example.com>',
    'www.example.com',
  ])('does not yet map URL fields for autolinks: %p', (md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(() => sourceMap.getFieldSourceRange(node, 'url', 0, 1))
      .toThrow(SourceMapUnavailableError);
  });

  test('maps URL escapes and entities as atomic source ranges', () => {
    const md = '[label](a\\(b\\)&amp;c)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('a(b)&c');
    expect(md.slice(
      sourceMap.getFieldSourceRange(node, 'url', 1, 2).start.offset,
      sourceMap.getFieldSourceRange(node, 'url', 1, 2).end.offset,
    )).toBe('\\(');
    expect(md.slice(
      sourceMap.getFieldSourceRange(node, 'url', 4, 5).start.offset,
      sourceMap.getFieldSourceRange(node, 'url', 4, 5).end.offset,
    )).toBe('&amp;');
  });

  test('maps the longest parser-valid named URL character reference', () => {
    const entity = '&CounterClockwiseContourIntegral;';
    const md = '[label](' + entity + ')';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('∳');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, 1);
    expect(md.slice(range.start.offset, range.end.offset)).toBe(entity);
  });

  test('maps a definition URL without its title', () => {
    const md = '[id]: <a&amp;b> "title"';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'definition')[0];
    expect(node.url).toBe('a&b');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('a&amp;b');
  });

  test('maps destinations after inline-link whitespace and a line ending', () => {
    const md = '[link](   /uri\n  "title"  )';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('/uri');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('/uri');
  });

  test.each([
    '[foo]:\n/url',
    '[foo]:\n  <my-url>\n  "title"',
  ])('maps a definition destination after a line ending: %p', (md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'definition')[0];
    expect(node.url).toBe(md.includes('my-url') ? 'my-url' : '/url');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe(node.url);
  });

  test.each([
    ['[link]()', 7],
    ['[link](<>)', 8],
    ['[foo]: <>', 8],
  ])('maps an empty URL to its content boundary: %p', (md, offset) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, md.startsWith('[foo]') ? 'definition' : 'link')[0];
    expect(node.url).toBe('');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, 0);
    expect(range.start.offset).toBe(offset);
    expect(range.end.offset).toBe(offset);
  });

  test('maps a definition whose label contains a colon', () => {
    const md = '[a:b]: /url';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'definition')[0];
    expect(node.url).toBe('/url');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(md.slice(range.start.offset, range.end.offset)).toBe('/url');
  });

  test('does not confuse a resource-like sequence inside raw HTML', () => {
    const md = '[<span title="](same)">x</span>](same)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('same');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(range.start.offset).toBe(md.lastIndexOf('(same)') + 1);
  });

  test('does not confuse a nested image destination with the outer link', () => {
    const md = '[![x](<a](same)b>)](same)';
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, 'link')[0];
    expect(node.url).toBe('same');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
    expect(range.start.offset).toBe(md.lastIndexOf('(same)') + 1);
  });

  test.each([
    ['link', '> [x](\n> \\>\n> )'],
    ['definition', '> [x]:\n> \\>'],
  ])('excludes blockquote markers from a cross-line %s URL', (type, md) => {
    const { ast, sourceMap } = parseMdWithSourceMap(md);
    const node = nodesOfType(ast, type)[0];
    expect(node.url).toBe('>');
    const range = sourceMap.getFieldSourceRange(node, 'url', 0, 1);
    expect(range.start.offset).toBe(md.lastIndexOf('\\>'));
    expect(md.slice(range.start.offset, range.end.offset)).toBe('\\>');
  });

  test('rejects a link URL modified after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('[x](/old)');
    const node = nodesOfType(ast, 'link')[0];
    node.url = '/changed';
    expect(() => sourceMap.getFieldSourceRange(node, 'url', 0, 1))
      .toThrow(SourceMapConsistencyError);
    expect(() => sourceMap.getRaw(node)).toThrow(SourceMapConsistencyError);
  });
});
