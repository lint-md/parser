import { createRequire } from 'node:module';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { toHast } from 'mdast-util-to-hast';
import { parseMd } from '../../src/parse-md';

interface Example {
  markdown: string
  html: string
  number: number
  section: string
}

const require = createRequire(import.meta.url);
const examples = (require('commonmark-spec') as { tests: Example[] }).tests;
const knownDifferences: Record<number, { reason: string; currentHtml: string }> = {
  96: {
    reason: 'frontmatter treats the opening dashes as YAML',
    currentHtml: '<h2>Bar</h2>\n<p>Baz</p>',
  },
  98: {
    reason: 'frontmatter treats both thematic breaks as YAML',
    currentHtml: '',
  },
  354: {
    reason: 'the parser accepts Unicode punctuation near emphasis',
    currentHtml: '<p>*$*alpha.</p>\n<p><em>£</em>bravo.</p>\n<p><em>€</em>charlie.</p>',
  },
  602: {
    reason: 'GFM links a URL inside invalid angle brackets',
    currentHtml: '<p>&#x3C;<a href="https://foo.bar/baz">https://foo.bar/baz</a> bim></p>',
  },
  608: {
    reason: 'GFM links a URL inside invalid angle brackets',
    currentHtml: '<p>&#x3C; <a href="https://foo.bar">https://foo.bar</a> ></p>',
  },
  609: {
    reason: 'directive parses the colon inside invalid angle brackets',
    currentHtml: '<p>&#x3C;m<div></div>></p>',
  },
  611: {
    reason: 'GFM links a bare URL',
    currentHtml: '<p><a href="https://example.com">https://example.com</a></p>',
  },
  612: {
    reason: 'GFM links a bare email address',
    currentHtml: '<p><a href="mailto:foo@bar.example.com">foo@bar.example.com</a></p>',
  },
};

const blockElements = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'section', 'table', 'tbody',
  'td', 'th', 'thead', 'tr', 'ul',
]);

function isBlockElement(node: any): boolean {
  return node?.type === 'element' && blockElements.has(node.tagName);
}

function canonicalHtml(html: string): unknown {
  const tree = fromHtml(html.replace(/\n$/, ''), { fragment: true });

  function visit(node: any): unknown {
    if (node.type === 'text' || node.type === 'comment') {
      return { type: node.type, value: node.value };
    }

    const children = (node.children || [])
      .filter((child: any, index: number, siblings: any[]) => !(
        child.type === 'text'
        && /^\s*$/.test(child.value)
        && isBlockElement(siblings[index - 1])
        && isBlockElement(siblings[index + 1])
      ))
      .map(visit);

    return {
      type: node.type,
      tagName: node.tagName,
      properties: node.properties || {},
      children,
    };
  }

  return visit(tree);
}

function output(example: Example): unknown {
  const markdown = example.markdown.replace(/→/g, '\t');
  const ast = parseMd(markdown);
  const html = toHtml(toHast(ast as unknown as Parameters<typeof toHast>[0], {
    allowDangerousHtml: true,
  }), {
    allowDangerousHtml: true,
  });
  return canonicalHtml(html);
}

function expected(example: Example): unknown {
  return canonicalHtml(example.html.replace(/→/g, '\t'));
}

describe('CommonMark 0.31.2 specification', () => {
  test('HTML comparison keeps text and structure differences', () => {
    expect(canonicalHtml('<p>A</p>')).not.toEqual(canonicalHtml('<p>B</p>'));
    expect(canonicalHtml('<p>A</p>')).not.toEqual(canonicalHtml('<h1>A</h1>'));
    expect(canonicalHtml('<pre><code>A\n</code></pre>'))
      .not.toEqual(canonicalHtml('<pre><code>A</code></pre>'));
    expect(canonicalHtml('<li><em>a</em> <em>b</em></li>'))
      .not.toEqual(canonicalHtml('<li><em>a</em><em>b</em></li>'));
    expect(canonicalHtml('<blockquote><em>a</em> <em>b</em></blockquote>'))
      .not.toEqual(canonicalHtml('<blockquote><em>a</em><em>b</em></blockquote>'));
    expect(canonicalHtml('<li><p>a</p>\n<p>b</p></li>'))
      .toEqual(canonicalHtml('<li><p>a</p><p>b</p></li>'));
  });

  test('loads the pinned official examples', () => {
    expect(examples).toHaveLength(652);
    expect(examples.map(example => example.number))
      .toEqual(Array.from({ length: 652 }, (_, index) => index + 1));
    for (const number of Object.keys(knownDifferences).map(Number)) {
      expect(examples[number - 1].number).toBe(number);
      expect(knownDifferences[number].reason.length).toBeGreaterThan(0);
    }
  });

  test.each(examples.filter(example => !(example.number in knownDifferences)))(
    'example $number: $section',
    example => {
      expect(output(example)).toEqual(expected(example));
    },
  );

  test.each(examples.filter(example => example.number in knownDifferences))(
    'known difference $number: $section',
    example => {
      const current = canonicalHtml(knownDifferences[example.number].currentHtml);
      expect(output(example)).toEqual(current);
      expect(current).not.toEqual(expected(example));
    },
  );
});
