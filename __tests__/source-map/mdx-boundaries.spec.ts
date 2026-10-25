import {
  parseMdx,
  parseMdxWithSourceMap,
  MdxSourceMapUnavailableError,
} from '../helpers';

const nested = [
  '<Panel title="Keep  value">',
  '**粗体** 与 [中文链接](https://example.com/a?x=1&amp;y=2) 🎉',
  '</Panel>',
].join('\r\n');

const mixed = [
  'export const user = "keep  code"',
  '',
  '<Card',
  '  label="keep  attribute"',
  '  value={',
  '    user + 1',
  '  }',
  '>',
  '正文  \\*星号 &amp; 🎉',
  '</Card>',
  '',
  '当前编号：{user}',
].join('\r\n');

function at<T = any>(nodes: any[], type: string): T {
  const node = nodes.find(item => item.type === type);
  expect(node).toBeDefined();
  return node;
}

describe('MDX source-map boundaries', () => {
  test('maps nested Markdown and link destinations inside JSX', () => {
    const { ast, sourceMap } = parseMdxWithSourceMap(nested);
    expect(ast).toEqual(parseMdx(nested));

    const jsx: any = at(ast.children, 'mdxJsxFlowElement');
    const paragraph = at<any>(jsx.children, 'paragraph');
    const strong = at<any>(paragraph.children, 'strong');
    const link = at<any>(paragraph.children, 'link');
    expect(sourceMap.getRaw(jsx)).toBe(nested);
    expect(sourceMap.getRaw(strong)).toBe('**粗体**');
    expect(sourceMap.getRaw(strong.children[0])).toBe('粗体');
    expect(sourceMap.getRaw(link.children[0])).toBe('中文链接');

    const ampersand = link.url.indexOf('&');
    const urlRange = sourceMap.getFieldSourceRange(
      link, 'url', ampersand, ampersand + 1,
    );
    expect(nested.slice(urlRange.start.offset, urlRange.end.offset)).toBe('&amp;');
    expect(urlRange.start.line).toBe(2);
    expect(sourceMap.getRaw(paragraph.children.at(-1))).toBe(' 🎉');
  });

  test('maps CRLF text, escapes, entities, and emoji to source spans', () => {
    const { ast, sourceMap } = parseMdxWithSourceMap(mixed);
    expect(ast).toEqual(parseMdx(mixed));

    const jsx: any = at(ast.children, 'mdxJsxFlowElement');
    const paragraph = at<any>(jsx.children, 'paragraph');
    const text = at<any>(paragraph.children, 'text');
    expect(text.value).toBe('正文  *星号 & 🎉');
    expect(sourceMap.getRaw(text)).toBe('正文  \\*星号 &amp; 🎉');

    const escaped = sourceMap.getSourceRange(text, 4, 5);
    const entity = sourceMap.getSourceRange(text, 8, 9);
    const emoji = sourceMap.getSourceRange(text, 10, 12);
    expect(mixed.slice(escaped.start.offset, escaped.end.offset)).toBe('\\*');
    expect(mixed.slice(entity.start.offset, entity.end.offset)).toBe('&amp;');
    expect(mixed.slice(emoji.start.offset, emoji.end.offset)).toBe('🎉');
    expect([escaped.start.line, entity.start.line, emoji.start.line]).toEqual([9, 9, 9]);
    expect(mixed.slice(text.position.start.offset, text.position.end.offset))
      .toBe('正文  \\*星号 &amp; 🎉');
  });

  test('rejects unsupported values and preserves syntax after a text edit', () => {
    const { ast, sourceMap } = parseMdxWithSourceMap(mixed);
    const esm: any = at(ast.children, 'mdxjsEsm');
    const jsx: any = at(ast.children, 'mdxJsxFlowElement');
    const expressionAttribute = jsx.attributes[1].value;
    const text = at<any>(at<any>(jsx.children, 'paragraph').children, 'text');
    const trailing = ast.children[ast.children.length - 1] as any;
    const expression = at<any>(trailing.children, 'mdxTextExpression');

    for (const unsupported of [jsx.attributes[0], jsx.attributes[1], expressionAttribute]) {
      expect(() => sourceMap.getRaw(unsupported)).toThrow(MdxSourceMapUnavailableError);
      expect(() => sourceMap.getValueSourceIndex(unsupported))
        .toThrow(MdxSourceMapUnavailableError);
    }
    expect(() => sourceMap.getValueSourceIndex(expression))
      .toThrow(MdxSourceMapUnavailableError);
    expect(() => sourceMap.getSourceRange(expression, 0, 1))
      .toThrow(MdxSourceMapUnavailableError);

    const spaces = sourceMap.getSourceRange(text, 2, 4);
    expect(mixed.slice(spaces.start.offset, spaces.end.offset)).toBe('  ');
    const fixed = mixed.slice(0, spaces.start.offset)
      + ' ' + mixed.slice(spaces.end.offset);
    const expected = mixed.replace('正文  \\*星号', '正文 \\*星号');
    expect(Buffer.from(fixed)).toEqual(Buffer.from(expected));

    const reparsed = parseMdxWithSourceMap(fixed);
    expect(reparsed.ast).toEqual(parseMdx(fixed));
    const fixedEsm: any = at(reparsed.ast.children, 'mdxjsEsm');
    const fixedJsx: any = at(reparsed.ast.children, 'mdxJsxFlowElement');
    const fixedTrailing = reparsed.ast.children[reparsed.ast.children.length - 1] as any;
    const fixedExpression = at<any>(fixedTrailing.children, 'mdxTextExpression');
    expect(Buffer.from(reparsed.sourceMap.getRaw(fixedEsm)))
      .toEqual(Buffer.from(sourceMap.getRaw(esm)));
    expect(Buffer.from(reparsed.sourceMap.getRaw(fixedExpression)))
      .toEqual(Buffer.from(sourceMap.getRaw(expression)));
    expect(fixedJsx.attributes).toEqual(jsx.attributes);
    expect(reparsed.sourceMap.getRaw(fixedJsx)).toBe(
      sourceMap.getRaw(jsx).replace('正文  \\*星号', '正文 \\*星号'),
    );
  });
});
