import { parseMd } from './helpers';

type PositionedNode = {
  position?: {
    start?: { line?: unknown; column?: unknown; offset?: unknown };
    end?: { line?: unknown; column?: unknown; offset?: unknown };
  };
  children?: unknown[];
};

const assertPositioned = (node: unknown): void => {
  const current = node as PositionedNode;
  expect(current.position).toBeDefined();
  expect(typeof current.position?.start?.line).toBe('number');
  expect(typeof current.position?.start?.column).toBe('number');
  expect(typeof current.position?.start?.offset).toBe('number');
  expect(typeof current.position?.end?.line).toBe('number');
  expect(typeof current.position?.end?.column).toBe('number');
  expect(typeof current.position?.end?.offset).toBe('number');
  expect(current.position!.start!.offset as number)
    .toBeLessThanOrEqual(current.position!.end!.offset as number);
  for (const child of current.children ?? []) {
    assertPositioned(child);
  }
};

describe('parseMd position contract', () => {
  test.each([
    ['frontmatter',         '---\ntitle: t\n---\n\nbody'],
    ['heading',             '# h1\n\n## h2'],
    ['paragraph',           'plain text with *emphasis* and **strong**'],
    ['thematicBreak',       '---\n\n***\n\n___'],
    ['blockquote',          '> a\n> > b'],
    ['ordered list',        '1. a\n2. b'],
    ['unordered list',      '- a\n- b'],
    ['task list',           '- [x] done\n- [ ] todo'],
    ['table',               '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['strikethrough',       '~~strike~~'],
    ['inline code',         '`code`'],
    ['code block',          '```ts\nconst a = 1;\n```'],
    ['hard break',          'line one  \nline two'],
    ['autolink',            'visit www.example.com'],
    ['explicit link',       '[text](https://example.com)'],
    ['image',               '![alt](https://example.com/x.png "title")'],
    ['reference link',      '[foo][bar]\n\n[bar]: https://example.com'],
    ['definition',          '[ref]: https://example.com "title"'],
    ['html block',          '<div>raw</div>'],
    ['inline html',         'text <span>raw</span> text'],
    ['inline math',         'inline $x^2$ math'],
    ['block math',          '$$\nx^2\n$$'],
    ['container directive', ':::note\nbody\n:::'],
    ['leaf directive',      '::warning[content]'],
    ['text directive',      ':smile[emoji]'],
  ])('"%s" yields a fully positioned tree', (_label, input) => {
    assertPositioned(parseMd(input));
  });

  test('composite fixture (all plugins combined) is fully positioned', () => {
    assertPositioned(parseMd(`---
title: t
---

# heading

text with **strong** and [link](https://example.com).

www.example.com

- a
- b

| a | b |
|---|---|
| 1 | 2 |

- [x] done
- [ ] todo

~~strike~~

\`\`\`ts
const x = 1;
\`\`\`

$x^2$

:::note
directive body
:::
`));
  });
});
