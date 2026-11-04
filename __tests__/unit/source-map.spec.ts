import {
  parseMd,
  parseMdWithSourceMap,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
} from '../../src/index';
import {
  parseMdx,
  parseMdxWithSourceMap,
} from '../../src/mdx';

function firstNode(root: any, type: string): any {
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node.type === type) return node;
    queue.push(...(node.children || []));
  }
  throw new Error(`No ${type} node found`);
}

function rawRange(source: string, range: any): string {
  return source.slice(range.start.offset, range.end.offset);
}

describe('TypeScript source entry points', () => {
  test('parses Markdown', () => {
    const ast = parseMd('# Heading');
    expect(ast.type).toBe('root');
    expect(ast.children[0].type).toBe('heading');
  });

  test('maps a plain text value', () => {
    const source = 'Hello world';
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const text = firstNode(ast, 'text');
    expect(text.value).toBe(source);
    expect(sourceMap.getRaw(text)).toBe(source);
    expect(rawRange(source, sourceMap.getSourceRange(text, 6, 11)))
      .toBe('world');
  });

  test('maps a character reference to its full source range', () => {
    const source = 'A &amp; B';
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const text = firstNode(ast, 'text');
    expect(text.value).toBe('A & B');
    expect(sourceMap.getRaw(text)).toBe(source);
    expect(rawRange(source, sourceMap.getSourceRange(text, 2, 3)))
      .toBe('&amp;');
  });

  test('maps a link URL field', () => {
    const source = '[link](a&amp;b)';
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const link = firstNode(ast, 'link');
    expect(link.url).toBe('a&b');
    expect(rawRange(source, sourceMap.getFieldSourceRange(link, 'url', 1, 2)))
      .toBe('&amp;');
  });

  test('maps an inline code value', () => {
    const source = '` a  b `';
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const code = firstNode(ast, 'inlineCode');
    expect(code.value).toBe('a  b');
    expect(rawRange(source, sourceMap.getSourceRange(code, 0, code.value.length)))
      .toBe('a  b');
  });

  test('reports a fenced code opening and insert point', () => {
    const source = '```\ncode\n```';
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const code = firstNode(ast, 'code');
    const info = sourceMap.getCodeSourceInfo(code);
    expect(info.kind).toBe('fenced');
    if (info.kind !== 'fenced') throw new Error('Expected fenced code');
    expect(rawRange(source, info.openingFence)).toBe('```');
    expect(info.infoInsertPoint.offset).toBe(3);
  });

  test('reports an indented code block', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('    code\n');
    const code = firstNode(ast, 'code');
    expect(sourceMap.getCodeSourceInfo(code)).toEqual({ kind: 'indented' });
  });

  test('rejects a text node modified after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('original');
    const text = firstNode(ast, 'text');
    text.value = 'changed';
    expect(() => sourceMap.getSourceRange(text, 0, 1))
      .toThrow(SourceMapConsistencyError);
  });

  test('rejects a node from another document', () => {
    const first = parseMdWithSourceMap('first');
    const second = parseMdWithSourceMap('second');
    const foreignText = firstNode(second.ast, 'text');
    expect(() => first.sourceMap.getRaw(foreignText))
      .toThrow(SourceMapUnavailableError);
  });

  test('parses MDX and maps Markdown text within it', () => {
    const source = '<Card />\n\nA &amp; B';
    const ast = parseMdx(source);
    expect(firstNode(ast, 'mdxJsxFlowElement').name).toBe('Card');

    const mapped = parseMdxWithSourceMap(source);
    const text = firstNode(mapped.ast, 'text');
    expect(text.value).toBe('A & B');
    expect(mapped.sourceMap.getRaw(text)).toBe('A &amp; B');
    expect(rawRange(source, mapped.sourceMap.getSourceRange(text, 2, 3)))
      .toBe('&amp;');
  });
});
