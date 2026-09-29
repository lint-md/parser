import {
  SourceMapUnavailableError,
  parseMdWithSourceMap,
} from '../helpers';

/** Collect matching nodes in document order. */
function nodesOfType(root: any, type: string): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

function parse(md: string): { ast: any; sourceMap: any; node: any } {
  const { ast, sourceMap } = parseMdWithSourceMap(md);
  return { ast, sourceMap, node: nodesOfType(ast, 'code')[0] };
}

function insertAt(md: string, offset: number, text: string): string {
  return md.slice(0, offset) + text + md.slice(offset);
}

/** Reparse `md` and return the first code node's lang and value. */
function reparseCode(md: string): { lang: string | null; value: string } {
  const { ast } = parseMdWithSourceMap(md);
  const node = nodesOfType(ast, 'code')[0];
  return { lang: node.lang ?? null, value: node.value };
}

/**
 * Apply the `no-empty-code-lang` style fix through the public query. Insert
 * `plain` only when the node has no lang and the block is fenced.
 */
function fixEmptyCodeLang(md: string): string {
  const { sourceMap, node } = parse(md);
  const info = sourceMap.getCodeSourceInfo(node);
  if (node.lang || info.kind !== 'fenced')
    return md;
  return insertAt(md, info.infoInsertPoint.offset, 'plain');
}

describe('sourceMap.getCodeSourceInfo', () => {
  describe('fenced code', () => {
    test.each([
      ['```\ncode\n```', 3, '```'],
      ['~~~\ncode\n~~~', 3, '~~~'],
      ['````\ncode\n````', 4, '````'],
      ['~~~~\ncode\n~~~~', 4, '~~~~'],
      ['`````\ncode\n`````', 5, '`````'],
    ])(
      'reports the opening fence and info insert point for %p',
      (md, fenceLength, fence) => {
        const { sourceMap, node } = parse(md);
        const info = sourceMap.getCodeSourceInfo(node);

        expect(info.kind).toBe('fenced');
        expect(info.openingFence.start.offset).toBe(node.position.start.offset);
        expect(info.openingFence.end.offset).toBe(fenceLength);
        expect(
          md.slice(info.openingFence.start.offset, info.openingFence.end.offset),
        ).toBe(fence);
        expect(info.infoInsertPoint.offset).toBe(fenceLength);
      },
    );

    test('places infoInsertPoint at the end of the line, not after the fence', () => {
      const md = '```js\ncode\n```';
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(info.kind).toBe('fenced');
      expect(info.openingFence.start.offset).toBe(0);
      expect(info.openingFence.end.offset).toBe(3);
      // The line is "```js", so the insert point is after "js".
      expect(info.infoInsertPoint).toEqual({ line: 1, column: 6, offset: 5 });
    });

    test('keeps infoInsertPoint before trailing whitespace line ending', () => {
      const md = '```   \ncode\n```';
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(info.kind).toBe('fenced');
      expect(info.infoInsertPoint).toEqual({ line: 1, column: 7, offset: 6 });
    });

    test.each([
      ['```\ncode\n```', 3],
      ['```\r\ncode\r\n```', 3],
      ['```\rcode\r```', 3],
      ['```   \ncode\n```', 6],
      ['```   \r\ncode\r\n```', 6],
      ['```   \rcode\r```', 6],
    ])(
      'positions infoInsertPoint before the line ending for %p',
      (md, insertOffset) => {
        const { sourceMap, node } = parse(md);
        const info = sourceMap.getCodeSourceInfo(node);

        expect(info.kind).toBe('fenced');
        expect(info.infoInsertPoint.offset).toBe(insertOffset);
        // Never inside a CRLF pair: the point is a line ending or end of input.
        const at = md[insertOffset];
        expect(at === undefined || at === '\n' || at === '\r').toBe(true);
      },
    );

    test('handles a fenced block in a blockquote', () => {
      const md = '> ```\n> code\n> ```';
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(info.kind).toBe('fenced');
      expect(md.slice(info.openingFence.start.offset, info.openingFence.end.offset))
        .toBe('```');
      expect(info.infoInsertPoint.offset).toBe(md.indexOf('```') + 3);

      const fixed = fixEmptyCodeLang(md);
      expect(reparseCode(fixed)).toEqual({ lang: 'plain', value: 'code' });
    });

    test('handles a fenced block in a blockquote with a tab prefix', () => {
      const md = '> \t```\n> \tcode\n> \t```';
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(info.kind).toBe('fenced');
      expect(info.infoInsertPoint.offset).toBe(md.indexOf('```') + 3);
      const fixed = fixEmptyCodeLang(md);
      expect(reparseCode(fixed)).toEqual({ lang: 'plain', value: 'code' });
    });

    test('handles a fenced block nested in a list', () => {
      const md = '- item\n    ```\n    value\n    ```';
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(info.kind).toBe('fenced');
      expect(md.slice(info.openingFence.start.offset, info.openingFence.end.offset))
        .toBe('```');
      expect(info.infoInsertPoint.offset).toBe(md.indexOf('```') + 3);

      const fixed = fixEmptyCodeLang(md);
      expect(reparseCode(fixed)).toEqual({ lang: 'plain', value: 'value' });
    });

    test('handles a fenced block in a list with tab indentation', () => {
      const md = '- item\n\t```\n    code\n\t```';
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(info.kind).toBe('fenced');
      expect(info.infoInsertPoint.offset).toBe(md.indexOf('```') + 3);
      const fixed = fixEmptyCodeLang(md);
      expect(reparseCode(fixed)).toEqual({ lang: 'plain', value: 'code' });
    });

    test.each([
      ['```\n```', 3],
      ['```\n\n```', 3],
      ['```\r\n```', 3],
    ])('handles an empty fenced block: %p', (md, insertOffset) => {
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(node.value).toBe('');
      expect(info.kind).toBe('fenced');
      expect(info.infoInsertPoint.offset).toBe(insertOffset);

      const fixed = fixEmptyCodeLang(md);
      expect(reparseCode(fixed)).toEqual({ lang: 'plain', value: '' });
    });

    test.each([
      ['```\ncode', 3],
      ['```', 3],
      ['```   ', 6],
      ['```\r\ncode', 3],
      ['> ```', 5],
      ['> ```\n', 5],
      ['> ```\r', 5],
      ['> ```\r\n', 5],
    ])('handles an unclosed fenced block: %p', (md, insertOffset) => {
      const { sourceMap, node } = parse(md);
      const info = sourceMap.getCodeSourceInfo(node);

      expect(info.kind).toBe('fenced');
      expect(info.infoInsertPoint.offset).toBe(insertOffset);
      if (insertOffset >= md.length)
        expect(md[insertOffset]).toBeUndefined();
      else
        expect(['\n', '\r']).toContain(md[insertOffset]);

      const fixed = fixEmptyCodeLang(md);
      expect(reparseCode(fixed).lang).toBe('plain');
    });

    test('is stable when applied repeatedly (fixer convergence)', () => {
      const md = '````\ncode\n````';
      let current = md;
      for (let i = 0; i < 5; i++)
        current = fixEmptyCodeLang(current);

      expect(reparseCode(current)).toEqual({ lang: 'plain', value: 'code' });
      expect(current).toBe('````plain\ncode\n````');
    });
  });

  describe('indented code', () => {
    test.each([
      '    code\n',
      '\tcode\n',
      '    a\n\n    b\n',
      '>     indented\n>     code',
      '- Foo\n\n      bar\n      baz',
    ])('reports indented structure for %p', (md) => {
      const { sourceMap, node } = parse(md);
      expect(sourceMap.getCodeSourceInfo(node)).toEqual({ kind: 'indented' });
    });

    test('does not apply an info-string fix to indented code', () => {
      const md = '    const a = 1;\n';
      expect(fixEmptyCodeLang(md)).toBe(md);
    });
  });

  describe('errors', () => {
    test('rejects a node from another document', () => {
      const a = parse('```\ncode\n```');
      const b = parse('```\ncode\n```');
      expect(() => a.sourceMap.getCodeSourceInfo(b.node)).toThrow(
        SourceMapUnavailableError,
      );
    });

    test('rejects a node that was added after parsing', () => {
      const { ast, sourceMap } = parseMdWithSourceMap('```\ncode\n```');
      const generated = { type: 'code', lang: null, meta: null, value: '' };
      ast.children.push(generated);
      expect(() => sourceMap.getCodeSourceInfo(generated as any)).toThrow(
        SourceMapUnavailableError,
      );
    });

    test('rejects a non-code node', () => {
      const { ast, sourceMap } = parse('```\ncode\n```');
      const paragraph = { type: 'paragraph', children: [] };
      ast.children.push(paragraph);
      expect(() => sourceMap.getCodeSourceInfo(paragraph as any)).toThrow(
        SourceMapUnavailableError,
      );
    });
  });
});
