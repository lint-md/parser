import { parseMd } from '../helpers';

describe('remark-gfm plugin', () => {
  test('table', () => {
    const root = parseMd('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(root.children).toHaveLength(1);
    const node = root.children[0];
    expect(node.type).toBe('table');
    if (node.type === 'table') {
      expect(node.align).toEqual([null, null]);
      expect(node.children).toHaveLength(2);
    }
  });

  test('task list with checked and unchecked items', () => {
    const root = parseMd('- [x] done\n- [ ] todo');
    expect(root.children).toHaveLength(1);
    const list = root.children[0];
    expect(list.type).toBe('list');
    if (list.type === 'list') {
      expect(list.children).toHaveLength(2);
      expect(list.children[0].type).toBe('listItem');
      expect(list.children[0].checked).toBe(true);
      expect(list.children[1].type).toBe('listItem');
      expect(list.children[1].checked).toBe(false);
    }
  });

  test('footnote definition', () => {
    const root = parseMd('[^1]: note');
    expect(root.children).toHaveLength(1);
    const node = root.children[0];
    expect(node.type).toBe('footnoteDefinition');
    if (node.type === 'footnoteDefinition') {
      expect(node.identifier).toBe('1');
    }
  });

  test('autolink email', () => {
    const root = parseMd('<contact@example.com>');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const link = paragraph.children[0];
      expect(link.type).toBe('link');
      if (link.type === 'link') {
        expect(link.url).toBe('mailto:contact@example.com');
      }
    }
  });

  test('bare URL in line', () => {
    const root = parseMd('visit https://example.com');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(2);
      const link = paragraph.children[1];
      expect(link.type).toBe('link');
      if (link.type === 'link') {
        expect(link.url).toBe('https://example.com');
      }
    }
  });
});
