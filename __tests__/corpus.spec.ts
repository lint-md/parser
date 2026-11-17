import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  parseMd,
  parseMdWithSourceMap,
  parseMdx,
  parseMdxWithSourceMap,
} from './helpers';

interface Fixture {
  path: string
  kind: 'syntax' | 'real-world'
  origin: string
  source: string
  license: string
  tags: string[]
  expectedNodes: string[]
}

interface Node {
  type: string
  value?: string
  url?: string
  position: {
    start: { offset: number; line: number; column: number }
    end: { offset: number; line: number; column: number }
  }
  children?: Node[]
}

const corpusRoot = join(__dirname, 'corpus');
const manifest = JSON.parse(
  readFileSync(join(__dirname, 'corpus-manifest.json'), 'utf8'),
) as { version: number; fixtures: Fixture[] };

function listDocuments(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listDocuments(join(directory, entry.name), name);
    return [name];
  }).sort();
}

function allNodes(root: Node): Node[] {
  const nodes: Node[] = [];
  function visit(node: Node): void {
    nodes.push(node);
    for (const child of node.children || []) visit(child);
  }
  visit(root);
  return nodes;
}

function sourcePositions(source: string): (range: Node['position']) => void {
  const starts = [0];
  const endings = /\r\n|\r|\n/g;
  for (let match = endings.exec(source); match; match = endings.exec(source)) {
    starts.push(match.index + match[0].length);
  }

  function expectedPoint(offset: number): { line: number; column: number; offset: number } {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - starts[low] + 1, offset };
  }

  return range => {
    expect(range.start.offset).toBeGreaterThanOrEqual(0);
    expect(range.end.offset).toBeGreaterThanOrEqual(range.start.offset);
    expect(range.end.offset).toBeLessThanOrEqual(source.length);
    expect(range.start).toEqual(expectedPoint(range.start.offset));
    expect(range.end).toEqual(expectedPoint(range.end.offset));
  };
}

describe('source position oracle', () => {
  test('counts LF, CRLF, CR, and UTF-16 code units', () => {
    const source = 'A😀\nB\r\n中\rZ';
    const check = sourcePositions(source);
    check({
      start: { line: 1, column: 2, offset: 1 },
      end: { line: 1, column: 4, offset: 3 },
    });
    check({
      start: { line: 2, column: 1, offset: 4 },
      end: { line: 3, column: 1, offset: 7 },
    });
    check({
      start: { line: 3, column: 1, offset: 7 },
      end: { line: 4, column: 1, offset: 9 },
    });
  });
});

describe('Markdown corpus manifest', () => {
  test('registers every file with a source and license', () => {
    expect(manifest.version).toBe(1);
    const paths = manifest.fixtures.map(fixture => fixture.path);
    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(listDocuments(corpusRoot));
    for (const fixture of manifest.fixtures) {
      expect(fixture.path).toMatch(/^(commonmark|gfm|extensions|real-world|mdx|malformed)\/[\w.-]+\.(md|mdx)$/);
      expect(resolve(corpusRoot, fixture.path).startsWith(`${corpusRoot}/`)).toBe(true);
      expect(fixture.source).toMatch(/^https:\/\//);
      expect(fixture.origin.length).toBeGreaterThan(0);
      expect(fixture.license).toBe('MIT');
      expect(fixture.tags.length).toBeGreaterThan(0);
      expect(fixture.expectedNodes.length).toBeGreaterThan(0);
      expect(readFileSync(join(corpusRoot, fixture.path)).length).toBeGreaterThan(0);
    }
  });
});

describe('Markdown corpus regression', () => {
  test.each(manifest.fixtures)('$path', fixture => {
    const source = readFileSync(join(corpusRoot, fixture.path), 'utf8');
    const expectRange = sourcePositions(source);
    const mdx = fixture.path.endsWith('.mdx');
    const baseline = mdx ? parseMdx(source) : parseMd(source);
    const { ast, sourceMap } = mdx
      ? parseMdxWithSourceMap(source)
      : parseMdWithSourceMap(source);

    expect(ast).toEqual(baseline);
    const nodes = allNodes(ast as Node);
    const types = new Set(nodes.map(node => node.type));
    for (const type of fixture.expectedNodes) expect(types.has(type)).toBe(true);

    for (const node of nodes) {
      expect(node.position).toBeDefined();
      expectRange(node.position);
      const raw = sourceMap.getRaw(node);
      if (node.type !== 'text') {
        expect(raw).toBe(source.slice(
          node.position.start.offset,
          node.position.end.offset,
        ));
      }
      else {
        expect(raw.length).toBeGreaterThan(0);
        expect(source.includes(raw)).toBe(true);
      }

      if (
        (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code')
        && typeof node.value === 'string'
      ) {
        let previousStart = 0;
        let previousEnd = 0;
        for (let index = 0; index < node.value.length; index++) {
          const range = sourceMap.getSourceRange(node, index, index + 1);
          expectRange(range);
          expect(range.start.offset).toBeGreaterThanOrEqual(previousStart);
          expect(range.end.offset).toBeGreaterThanOrEqual(previousEnd);
          previousStart = range.start.offset;
          previousEnd = range.end.offset;
        }
      }

      if (
        (node.type === 'definition' || (node.type === 'link' && raw.includes('](')))
        && typeof node.url === 'string'
        && node.url.length > 0
      ) {
        const range = sourceMap.getFieldSourceRange(node, 'url', 0, node.url.length);
        expectRange(range);
        expect(range.start.offset).toBeGreaterThanOrEqual(node.position.start.offset);
        expect(range.end.offset).toBeLessThanOrEqual(node.position.end.offset);
      }
    }
  });
});

describe('corpus source offsets and repair', () => {
  test('maps entities, escapes, emoji, and CRLF in UTF-16 offsets', () => {
    const source = readFileSync(join(corpusRoot, 'commonmark/crlf-unicode.md'), 'utf8');
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const nodes = allNodes(ast as Node);
    const text = nodes.find(node => node.type === 'text' && node.value?.includes('(test)'))!;
    const open = text.value!.indexOf('(');
    const close = text.value!.indexOf(')');
    const escaped = text.value!.lastIndexOf('(');
    expect(sourceMap.getRaw(text)).toBe('中文 &#40;test&#41; and \\(escaped\\).');

    const rawAt = (start: number, end: number): string => {
      const range = sourceMap.getSourceRange(text, start, end);
      return source.slice(range.start.offset, range.end.offset);
    };
    expect(rawAt(open, open + 1)).toBe('&#40;');
    expect(rawAt(close, close + 1)).toBe('&#41;');
    expect(rawAt(escaped, escaped + 1)).toBe('\\(');

    const heading = nodes.find(node => node.type === 'text' && node.value?.includes('😀'))!;
    const emoji = heading.value!.indexOf('😀');
    const emojiRange = sourceMap.getSourceRange(heading, emoji, emoji + 2);
    expect(source.slice(emojiRange.start.offset, emojiRange.end.offset)).toBe('😀');
    expect(emojiRange.end.offset - emojiRange.start.offset).toBe(2);
    expect(source.includes('\r\n')).toBe(true);
  });

  test('maps decoded link URL and code content to their source', () => {
    const source = readFileSync(join(corpusRoot, 'commonmark/inline-source.md'), 'utf8');
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const nodes = allNodes(ast as Node);
    const link = nodes.find(node => node.type === 'link' && node.url?.includes('a&b'))!;
    const ampersand = link.url!.indexOf('&');
    const urlRange = sourceMap.getFieldSourceRange(link, 'url', ampersand, ampersand + 1);
    expect(source.slice(urlRange.start.offset, urlRange.end.offset)).toBe('&amp;');

    const containerSource = readFileSync(join(corpusRoot, 'commonmark/containers.md'), 'utf8');
    const container = parseMdWithSourceMap(containerSource);
    const code = allNodes(container.ast as Node).find(node => node.type === 'inlineCode')!;
    const codeRange = container.sourceMap.getSourceRange(code, 0, code.value!.length);
    expect(containerSource.slice(codeRange.start.offset, codeRange.end.offset)).toBe('inline code');

    const referenceSource = readFileSync(join(corpusRoot, 'commonmark/reference-and-html.md'), 'utf8');
    const reference = parseMdWithSourceMap(referenceSource);
    const definition = allNodes(reference.ast as Node).find(node => node.type === 'definition')!;
    const definitionRange = reference.sourceMap.getFieldSourceRange(
      definition,
      'url',
      0,
      definition.url!.length,
    );
    expect(referenceSource.slice(definitionRange.start.offset, definitionRange.end.offset))
      .toBe('https://example.org/a%20b');
  });

  test('maps exact text spans in a real README', () => {
    const source = readFileSync(join(corpusRoot, 'real-world/README.md'), 'utf8');
    const { ast, sourceMap } = parseMdWithSourceMap(source);
    const nodes = allNodes(ast as Node);
    const prose = nodes.find(node => node.type === 'text' && node.value?.startsWith('lint-md 的解析器'))!;
    expect(sourceMap.getRaw(prose)).toBe('lint-md 的解析器，基于 remark 生态，将 Markdown 字符串转换成 AST。');

    function exactText(node: Node, value: string): number {
      const index = node.value!.indexOf(value);
      expect(index).toBeGreaterThanOrEqual(0);
      const range = sourceMap.getSourceRange(node, index, index + value.length);
      expect(source.slice(range.start.offset, range.end.offset)).toBe(value);
      return range.start.offset;
    }

    expect(exactText(prose, 'lint-md')).toBe(source.indexOf('lint-md 的解析器'));
    expect(exactText(prose, '解析器')).toBe(source.indexOf('解析器'));

    const listText = nodes.find(node => node.type === 'text' && node.value?.startsWith('合法的 autolink'))!;
    const listOffset = exactText(listText, '合法的 autolink');
    expect(listOffset).toBe(source.indexOf('- 合法的 autolink') + 2);
    expect(source.slice(source.lastIndexOf('\n', listOffset) + 1, listOffset)).toBe('- ');

    const quoteText = nodes.find(node => node.type === 'text' && node.value === '注意')!;
    const quoteOffset = exactText(quoteText, '注意');
    expect(quoteOffset).toBe(source.indexOf('> **注意') + 4);
    expect(source.slice(source.lastIndexOf('\n', quoteOffset) + 1, quoteOffset)).toBe('> **');
  });

  test('repairs MDX prose and keeps JSX attributes and structure', () => {
    const source = readFileSync(join(corpusRoot, 'mdx/component.mdx'), 'utf8');
    const { ast, sourceMap } = parseMdxWithSourceMap(source);
    const nodes = allNodes(ast as Node);
    const prose = nodes.find(node => node.type === 'text' && node.value?.includes('Read  '))!;
    const index = prose.value!.indexOf('  ');
    const range = sourceMap.getSourceRange(prose, index, index + 2);
    expect(source.slice(range.start.offset, range.end.offset)).toBe('  ');

    const fixed = source.slice(0, range.start.offset) + ' ' + source.slice(range.end.offset);
    expect(fixed).toContain('<Note title="Keep  this" count={2}>');
    expect(fixed).toContain('Read **the guide**');
    expect(allNodes(parseMdx(fixed) as Node).map(node => node.type))
      .toEqual(nodes.map(node => node.type));
    expect(parseMdxWithSourceMap(fixed).ast).toEqual(parseMdx(fixed));
  });
});
