import { parseMd, parseMdWithSourceMap } from '../helpers';

describe('parseMd vs parseMdWithSourceMap: AST parity corpus', () => {
  // A varied corpus exercising tokenizers / mdast decisions that the recording
  // extension must not disturb: entities, escapes, autolinks, GFM (tables,
  // strikethrough, task lists), directives, math, frontmatter, and mixed
  // line endings / astral Unicode.
  const corpus = [
    'A&amp;B',
    '&amp;&copy;',
    'A &amp; B with *em* and [link](https://x.com?a&amp;b).',
    String.raw`\*not emphasis\* and \`code\``,
    'www.example.com and <https://x.com> and <a@b.com>',
    '| a | b |\n| :- | -: |\n| 1 | 2 |',
    '~~struck~~ and a ~~b',
    '- [ ] todo\n- [x] done',
    '::name\ncontent\n::',
    'a\nb\r\nc\r\nd',
    'a\u{1F389}b\u{1D11E}c',
    '$$x^2$$ and `inline code`',
    '---\ntitle: x\n---\n# Heading',
    '> quote with &amp; entity\n> second line',
    '1. one &amp; two\n2. three',
    '`code with &lt; tag` and > quote',
    'text [a](<b &amp; c>) end',
    'pre\n```js\nconst x = 1 &amp; 2;\n```\npost',
    '~~~\r\na\r\n~~~',
    '    a\n\n    b\n',
    '&#0;&#128;&#xFDD0; and &amp;amp;',
    'A&#x1F600;B',
  ];

  test('AST is deeply identical to parseMd', () => {
    const md = 'A &amp; B with *em* and [link](https://x.com?a&amp;b).';
    const { ast } = parseMdWithSourceMap(md);
    const baseline = parseMd(md);
    expect(JSON.parse(JSON.stringify(ast))).toEqual(
      JSON.parse(JSON.stringify(baseline)),
    );
  });

  test('AST is deeply identical to parseMd for CR / CRLF / astral input', () => {
    for (const md of ['a\rb', 'a\r\nb', 'a🎉b', 'A&lt;B\nC&#128;D']) {
      const { ast } = parseMdWithSourceMap(md);
      const baseline = parseMd(md);
      expect(JSON.parse(JSON.stringify(ast))).toEqual(
        JSON.parse(JSON.stringify(baseline)),
      );
    }
  });

  test.each(corpus)('parity for: %p', (md) => {
    const { ast } = parseMdWithSourceMap(md);
    const baseline = parseMd(md);
    expect(JSON.parse(JSON.stringify(ast))).toEqual(
      JSON.parse(JSON.stringify(baseline)),
    );
  });

  test('every mapped literal text node is contained in the source', () => {
    for (const md of corpus) {
      const { ast, sourceMap } = parseMdWithSourceMap(md);
      const collect = (node: any, out: string[]) => {
        if (node.type === 'text' && !/[&\\]/.test(node.value)) {
          out.push(sourceMap.getRaw(node));
        }
        for (const c of node.children || []) collect(c, out);
      };
      const raws: string[] = [];
      collect(ast, raws);
      for (const raw of raws) {
        expect(md).toContain(raw);
      }
      expect(() => parseMd(md)).not.toThrow();
    }
  });
});
