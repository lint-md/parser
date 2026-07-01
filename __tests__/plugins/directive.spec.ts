import { parseMd } from '../helpers';

describe('remark-directive plugin', () => {
  test('container directive :::note', () => {
    const root = parseMd(':::note\ncontent\n:::');
    expect(root.children).toHaveLength(1);
    const node = root.children[0];
    expect(node.type).toBe('containerDirective');
    if (node.type === 'containerDirective') {
      expect(node.name).toBe('note');
      expect(node.attributes).toBeDefined();
      expect(node.children).toHaveLength(1);
      const paragraph = node.children[0];
      expect(paragraph.type).toBe('paragraph');
    }
  });

  test('leaf directive ::warning[content]', () => {
    const root = parseMd('::warning[content]');
    const node = root.children[0];
    expect(node.type).toBe('leafDirective');
    if (node.type === 'leafDirective') {
      expect(node.name).toBe('warning');
      expect(node.children).toHaveLength(1);
      const child = node.children[0];
      expect(child.type).toBe('text');
      if (child.type === 'text') {
        expect(child.value).toBe('content');
      }
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
