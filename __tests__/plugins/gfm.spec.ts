import type { PhrasingContent } from 'mdast';
import { parseMd } from '../helpers';

describe('remark-gfm plugin', () => {
  test('table with alignment', () => {
    const root = parseMd('| a | b |\n|:---|---:|\n| 1 | 2 |');
    expect(root.children).toHaveLength(1);
    const node = root.children[0];
    expect(node.type).toBe('table');
    if (node.type === 'table') {
      expect(node.align).toEqual(['left', 'right']);
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

  test('footnote reference', () => {
    const root = parseMd('text [^1]\n\n[^1]: note');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      const ref = paragraph.children.find(
        (child: PhrasingContent) => child.type === 'footnoteReference',
      );
      expect(ref).toBeDefined();
      if (ref?.type === 'footnoteReference') {
        expect(ref.identifier).toBe('1');
      }
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

  test('autolink www-prefixed URL', () => {
    const root = parseMd('www.example.com');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const link = paragraph.children[0];
      expect(link.type).toBe('link');
      if (link.type === 'link') {
        expect(link.url).toContain('www.example.com');
        expect(link.position.start.offset).toBe(0);
        expect(link.position.end.offset).toBe('www.example.com'.length);
      }
    }
  });

  test('quoted www URL remains positioned text', () => {
    const source = '"www.google.com"';
    const root = parseMd(source);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const text = paragraph.children[0];
      expect(text.type).toBe('text');
      if (text.type === 'text') {
        expect(text.value).toBe(source);
        expect(text.position.start.offset).toBe(0);
        expect(text.position.end.offset).toBe(source.length);
      }
    }
  });
});
