const { parseMd } = require('../../dist/lint-md-parser.cjs');

describe('remark-directive plugin', () => {
  test('container directive :::note', () => {
    const root = parseMd(':::note\ncontent\n:::');
    expect(root.children).toHaveLength(1);
    const node = root.children[0];
    expect(node.type).toBe('containerDirective');
    if (node.type === 'containerDirective') {
      expect(node.name).toBe('note');
      expect(node.attributes).toBeDefined();
    }
  });

  test('leaf directive :::warning', () => {
    const root = parseMd(':::warning\n');
    const node = root.children[0];
    expect(node.type).toBe('containerDirective');
    if (node.type === 'containerDirective') {
      expect(node.name).toBe('warning');
    }
  });

  test('text directive :text', () => {
    const root = parseMd(':text');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const node = paragraph.children[0];
      expect(node.type).toBe('textDirective');
      if (node.type === 'textDirective') {
        expect(node.name).toBe('text');
      }
    }
  });

  test('directive with attributes :::tip{.highlight}', () => {
    const root = parseMd(':::tip{.highlight}\n:::');
    const node = root.children[0];
    expect(node.type).toBe('containerDirective');
    if (node.type === 'containerDirective') {
      expect(node.name).toBe('tip');
      expect(node.attributes).toEqual({ class: 'highlight' });
    }
  });

  test('nested directive', () => {
    const root = parseMd(':::outer\n:::inner\n:::\n:::');
    const node = root.children[0];
    expect(node.type).toBe('containerDirective');
    if (node.type === 'containerDirective') {
      expect(node.name).toBe('outer');
      expect(node.children).toHaveLength(1);
      const inner = node.children[0];
      expect(inner.type).toBe('containerDirective');
      if (inner.type === 'containerDirective') {
        expect(inner.name).toBe('inner');
      }
    }
  });
});
