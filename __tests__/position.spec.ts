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
  for (const child of current.children ?? []) {
    assertPositioned(child);
  }
};

describe('parseMd position contract', () => {
  test('every node in the parsed tree has start/end with offset (all plugins)', () => {
    const root = parseMd(`---
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
`);

    assertPositioned(root);
  });

  test('GFM autolink tokenizer path produces a link with position', () => {
    const root = parseMd('visit www.example.com');
    assertPositioned(root);
  });
});
