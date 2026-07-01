const { parseMd } = require('../../dist/lint-md-parser.cjs');

describe('remark-math plugin', () => {
  test('block math with $$ on separate lines', () => {
    const root = parseMd('$$\nx^2\n$$');
    expect(root.children).toHaveLength(1);
    const node = root.children[0];
    expect(node.type).toBe('math');
    if (node.type === 'math') {
      expect(node.value).toBe('x^2');
    }
  });

  test('inline math $x^2$', () => {
    const root = parseMd('$x^2$');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      expect(paragraph.children).toHaveLength(1);
      const node = paragraph.children[0];
      expect(node.type).toBe('inlineMath');
      if (node.type === 'inlineMath') {
        expect(node.value).toBe('x^2');
      }
    }
  });

  test('inline math $$x^2$$ (without line breaks)', () => {
    const root = parseMd('$$x^2$$');
    const paragraph = root.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type === 'paragraph') {
      const node = paragraph.children[0];
      expect(node.type).toBe('inlineMath');
      if (node.type === 'inlineMath') {
        expect(node.value).toBe('x^2');
      }
    }
  });

  test('empty block math does not crash', () => {
    const root = parseMd('$$\n$$');
    expect(root.children).toHaveLength(1);
    const node = root.children[0];
    expect(node.type).toBe('math');
    if (node.type === 'math') {
      expect(node.value).toBe('');
    }
  });

  test('block math with LaTeX integral', () => {
    const input = '$$\n\\int_0^\\infty e^{-x} dx\n$$';
    const root = parseMd(input);
    const node = root.children[0];
    expect(node.type).toBe('math');
    if (node.type === 'math') {
      expect(node.value).toBe('\\int_0^\\infty e^{-x} dx');
    }
  });
});
