import {
  parseMd,
  parseMdx,
  parseMdxWithSourceMap,
  MdxSourceMapUnavailableError,
} from './helpers';

const source = [
  "import Card from './Card'",
  "export const label = 'Keep  spaces'",
  '',
  '# Fix  heading',
  '',
  '<Card title="Keep  spaces" count={1 + 2}>Fix  body</Card>',
  '',
  'Fix  prose {label} here.',
].join('\n');

function visit(node: any, callback: (node: any) => void): void {
  callback(node);
  for (const child of node.children || []) visit(child, callback);
}

describe('MDX parsing', () => {
  test('keeps MDX syntax distinct from Markdown text', () => {
    const ast = parseMdx(source);
    const types: string[] = [];
    visit(ast, node => types.push(node.type));
    expect(types).toEqual(expect.arrayContaining([
      'mdxjsEsm',
      'mdxJsxTextElement',
      'mdxTextExpression',
      'heading',
      'text',
    ]));

    const jsx = ast.children.find((node: any) => node.type === 'paragraph') as any;
    const element = jsx.children[0];
    expect(element.attributes[0].value).toBe('Keep  spaces');
    expect(element.attributes[1].value.value).toBe('1 + 2');
    expect(element.children[0].value).toBe('Fix  body');
    expect(parseMd('# Plain  Markdown').children[0].type).toBe('heading');
  });

  test('maps Markdown text while preserving code and JSX attributes', () => {
    const { ast, sourceMap } = parseMdxWithSourceMap(source);
    expect(JSON.parse(JSON.stringify(ast))).toEqual(
      JSON.parse(JSON.stringify(parseMdx(source))),
    );

    const edits: Array<{ start: number; end: number; replacement: string }> = [];
    visit(ast, node => {
      if (node.type !== 'text') return;
      const index = node.value.indexOf('  ');
      if (index < 0) return;
      const range = sourceMap.getSourceRange(node, index, index + 2);
      expect(source.slice(range.start.offset, range.end.offset)).toBe('  ');
      edits.push({ start: range.start.offset, end: range.end.offset, replacement: ' ' });
    });

    expect(edits).toHaveLength(3);
    let fixed = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      fixed = fixed.slice(0, edit.start) + edit.replacement + fixed.slice(edit.end);
    }
    expect(fixed).toContain("export const label = 'Keep  spaces'");
    expect(fixed).toContain('<Card title="Keep  spaces" count={1 + 2}>Fix body</Card>');
    expect(fixed).toContain('# Fix heading');
    expect(fixed).toContain('Fix prose {label} here.');
  });

  test('uses source spans for MDX nodes and rejects unsupported attributes', () => {
    const { ast, sourceMap } = parseMdxWithSourceMap(source);
    const esm = ast.children[0] as any;
    expect(sourceMap.getRaw(esm)).toBe(
      "import Card from './Card'\nexport const label = 'Keep  spaces'",
    );
    const jsx = (ast.children.find((node: any) => node.type === 'paragraph') as any).children[0];
    expect(sourceMap.getRaw(jsx)).toBe(
      '<Card title="Keep  spaces" count={1 + 2}>Fix  body</Card>',
    );
    expect(() => sourceMap.getRaw(jsx.attributes[0])).toThrow(MdxSourceMapUnavailableError);
  });

  test('keeps flow JSX and flow expressions outside Markdown text maps', () => {
    const input = [
      'export const value = "A  B"',
      '',
      '<Card title="A  B" {...props}>',
      'Fix  body',
      '</Card>',
      '',
      '{value + 1}',
    ].join('\n');
    const { ast, sourceMap } = parseMdxWithSourceMap(input);
    const flow = ast.children.find((node: any) => node.type === 'mdxJsxFlowElement') as any;
    const expression = ast.children.find((node: any) => node.type === 'mdxFlowExpression') as any;
    expect(flow).toBeDefined();
    expect(expression).toBeDefined();
    expect(sourceMap.getRaw(flow)).toBe('<Card title="A  B" {...props}>\nFix  body\n</Card>');
    expect(sourceMap.getRaw(expression)).toBe('{value + 1}');

    const textNodes: any[] = [];
    visit(ast, node => { if (node.type === 'text') textNodes.push(node); });
    expect(textNodes.map(node => node.value)).toEqual(['Fix  body']);
    expect(sourceMap.getRaw(textNodes[0])).toBe('Fix  body');
    expect(() => sourceMap.getValueSourceIndex(expression)).toThrow(MdxSourceMapUnavailableError);
  });
});
