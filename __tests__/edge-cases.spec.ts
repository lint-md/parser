import { parseMd } from './helpers';

describe('edge cases', () => {
  test('empty input', () => {
    const root = parseMd('');
    expect(root.type).toBe('root');
    expect(root.children).toHaveLength(0);
  });

  test('pure whitespace', () => {
    const root = parseMd('\n\n\n');
    expect(root.type).toBe('root');
    expect(root.children).toHaveLength(0);
  });

  test('pure punctuation', () => {
    const root = parseMd('!!!???');
    expect(root.children).toHaveLength(1);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const text = paragraph.children[0];
      expect(text.type).toBe('text');
      if (text.type === 'text') {
        expect(text.value).toBe('!!!???');
      }
    }
  });

  test('long line (100000 chars)', () => {
    const input = 'a'.repeat(100000);
    const root = parseMd(input);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const text = paragraph.children[0];
      expect(text.type).toBe('text');
      if (text.type === 'text') {
        expect(text.value).toHaveLength(100000);
        expect(text.position).toBeDefined();
      }
    }
  });

  test('deep blockquote', () => {
    const root = parseMd('> > > > deep');
    expect(root.children).toHaveLength(1);
    const bq4 = root.children[0];
    expect(bq4.type).toBe('blockquote');
    if (bq4.type === 'blockquote') {
      const bq3 = bq4.children[0];
      expect(bq3.type).toBe('blockquote');
      if (bq3.type === 'blockquote') {
        const bq2 = bq3.children[0];
        expect(bq2.type).toBe('blockquote');
        if (bq2.type === 'blockquote') {
          const bq1 = bq2.children[0];
          expect(bq1.type).toBe('blockquote');
          if (bq1.type === 'blockquote') {
            const paragraph = bq1.children[0];
            expect(paragraph.type).toBe('paragraph');
          }
        }
      }
    }
  });

  test('nested list (5 levels)', () => {
    const input = '- level1\n  - level2\n    - level3\n      - level4\n        - level5';
    const root = parseMd(input);
    expect(root.children).toHaveLength(1);
    const list = root.children[0];
    expect(list.type).toBe('list');

    // Verify 5 levels of nesting
    const item1 = list.children[0];
    expect(item1.type).toBe('listItem');
    const nestedList1 = item1.children[1];
    expect(nestedList1.type).toBe('list');

    const item2 = nestedList1.children[0];
    expect(item2.type).toBe('listItem');
    const nestedList2 = item2.children[1];
    expect(nestedList2.type).toBe('list');

    const item3 = nestedList2.children[0];
    expect(item3.type).toBe('listItem');
    const nestedList3 = item3.children[1];
    expect(nestedList3.type).toBe('list');

    const item4 = nestedList3.children[0];
    expect(item4.type).toBe('listItem');
    const nestedList4 = item4.children[1];
    expect(nestedList4.type).toBe('list');

    const item5 = nestedList4.children[0];
    expect(item5.type).toBe('listItem');
    const paragraph = item5.children[0];
    expect(paragraph.type).toBe('paragraph');
  });

  test('emoji', () => {
    const root = parseMd('🎉🚀✨');
    expect(root.children).toHaveLength(1);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const text = paragraph.children[0];
      expect(text.type).toBe('text');
      if (text.type === 'text') {
        expect(text.value).toBe('🎉🚀✨');
        expect(text.position).toBeDefined();
      }
    }
  });

  test('zero-width characters', () => {
    const root = parseMd('\u200B\u200C\u200D');
    expect(root.children).toHaveLength(1);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const text = paragraph.children[0];
      expect(text.type).toBe('text');
      if (text.type === 'text') {
        expect(text.value).toBe('\u200B\u200C\u200D');
      }
    }
  });

  test('CJK mixed text', () => {
    const root = parseMd('你好world你好');
    expect(root.children).toHaveLength(1);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const text = paragraph.children[0];
      expect(text.type).toBe('text');
      if (text.type === 'text') {
        expect(text.value).toBe('你好world你好');
      }
    }
  });

  test('image with alt, url, and title', () => {
    const root = parseMd('![alt](url "title")');
    expect(root.children).toHaveLength(1);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const image = paragraph.children[0];
      expect(image.type).toBe('image');
      if (image.type === 'image') {
        expect(image.url).toBe('url');
        expect(image.alt).toBe('alt');
        expect(image.title).toBe('title');
      }
    }
  });

  test('inline HTML', () => {
    const root = parseMd('<em>text</em>');
    expect(root.children).toHaveLength(1);
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(3);
      expect(paragraph.children[0].type).toBe('html');
      expect(paragraph.children[1].type).toBe('text');
      expect(paragraph.children[2].type).toBe('html');
    }
  });
});
