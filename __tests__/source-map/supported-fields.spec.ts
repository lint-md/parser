import { parseMdWithSourceMap } from '../helpers';

/** Collect matching nodes in document order. */
function nodesOfType(root: any, type: string): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('parseMdWithSourceMap: documented supported fields are available', () => {
  test.each([
    ['inlineCode.value', '`npm install`', 'inlineCode', 'value', 'npm install'],
    ['code.value', '```sh\necho ready\n```', 'code', 'value', 'echo ready'],
    ['inline link url', '[docs](https://example.com/guide)', 'link', 'url', 'https://example.com/guide'],
    ['definition url', '[docs]: https://example.com/guide', 'definition', 'url', 'https://example.com/guide'],
  ])(
    '%s maps common valid Markdown without becoming unavailable',
    (_label, markdown, nodeType, field, expectedRaw) => {
      const { ast, sourceMap } = parseMdWithSourceMap(markdown);
      const node = nodesOfType(ast, nodeType)[0];
      const value = node[field];

      const range = field === 'url'
        ? sourceMap.getFieldSourceRange(node, 'url', 0, value.length)
        : sourceMap.getSourceRange(node, 0, value.length);

      expect(markdown.slice(range.start.offset, range.end.offset)).toBe(expectedRaw);
    },
  );
});
