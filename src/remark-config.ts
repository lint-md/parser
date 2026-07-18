import frontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { remark } from 'remark';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';

/**
 * Workaround for https://github.com/remarkjs/remark-gfm/issues/16
 *
 * GFM autolink 有两条路径：
 * 1. 解析器 tokenizer（尖括号语法如 <https://…>、<email@…>、www. 前缀）
 *    仍在运行，生成带 url/title 的 link 节点。
 * 2. 后处理 transform（findAndReplace 正则扫描文本中裸 URL）
 *    被禁用，因为其生成的 link 子节点缺少 position。
 *
 * 行为示例：
 * - www.example.com      → link 节点（tokenizer 捕获 www. 前缀）
 * - <https://ex.com>     → link 节点（tokenizer 捕获尖括号语法）
 * - "www.google.com"     → text 节点（tokenizer 未捕获，transform 已禁用）
 *
 * `remark-gfm` registers the shared, module-level
 * `gfmAutolinkLiteralFromMarkdown` singleton (by reference) into this
 * processor's `fromMarkdownExtensions`. Rather than mutating that shared
 * object process-wide (which leaks into every other consumer of the same
 * dependency instance), {@link positionSafeGfm} replaces the singleton in the
 * *current processor's own data* with a shallow clone whose `transforms` is
 * emptied. The clone is per-processor; the imported singleton is never
 * touched.
 */
const positionSafeGfm = function positionSafeGfm(this: {
  data(): { fromMarkdownExtensions?: unknown[] }
}): void {
  const data = this.data();

  let replaced = 0;

  // Rebuild the extension tree preserving its original nested shape:
  // `remark-gfm` intentionally registers `gfmFromMarkdown()`'s array as a
  // single entry, so we recurse instead of flattening it back.
  const replace = (value: unknown): unknown => {
    if (value === gfmAutolinkLiteralFromMarkdown) {
      replaced += 1;
      // Shallow clone: `enter` / `exit` are shared read-only handlers; only
      // the top-level object and its `transforms` array become per-processor.
      // A structured/deep clone would fail on the function members anyway.
      return {
        ...gfmAutolinkLiteralFromMarkdown,
        transforms: [],
      };
    }
    if (Array.isArray(value)) {
      return value.map(replace);
    }
    return value;
  };

  data.fromMarkdownExtensions = data.fromMarkdownExtensions?.map(replace);

  // Fail loudly if the workaround silently stops matching — e.g. an upstream
  // restructure of `remark-gfm`, or a duplicate
  // `mdast-util-gfm-autolink-literal` install where the imported singleton is
  // no longer the same reference the plugin registered. Without this, the
  // position-unsafe transform would be re-enabled while the code still
  // compiled and ran.
  if (replaced !== 1) {
    throw new Error(
      'positionSafeGfm: expected exactly one GFM autolink-literal '
        + `from-markdown extension to disable, but replaced ${replaced}. `
        + 'A remark-gfm upgrade or duplicate dependency may have broken this '
        + 'workaround (see https://github.com/remarkjs/remark-gfm/issues/16).',
    );
  }
};

/**
 * The single source of truth for the remark plugin stack. Both {@link parseMd}
 * and {@link parseMdWithSourceMap} must use exactly this configuration so
 * their tokenizer / mdast-extension decisions (and therefore their ASTs)
 * never drift apart.
 *
 * `positionSafeGfm` must be registered *after* `remarkGfm`: the latter's
 * attacher is what adds the autolink extension to the processor data, so the
 * local override only sees (and can replace) it if it runs later.
 *
 * Each call returns an independent processor whose own data holds a fresh
 * clone of the autolink extension — no shared mutable state between calls.
 */
export const createParserProcessor = (): ReturnType<typeof remark> =>
  remark()
    .use(frontmatter)
    .use(remarkGfm)
    .use(positionSafeGfm)
    .use(remarkDirective)
    .use(remarkMath);

export interface ParserExtensions {
  micromarkExtensions: unknown[]
  fromMarkdownExtensions: unknown[]
}

/**
 * Freeze a copy of the parser processor and read the micromark + from-markdown
 * extensions the plugins registered. These describe the real parser's
 * decisions (including whether an `&amp;` inside an autolink is decoded or
 * kept literal). Reusing this frozen data is what keeps
 * `parseMdWithSourceMap`'s AST identical to `parseMd`'s.
 */
export const getParserExtensions = (): ParserExtensions => {
  const frozen = createParserProcessor();
  frozen.freeze();
  const data = frozen.data();
  return {
    micromarkExtensions: (data.micromarkExtensions as unknown[]) || [],
    fromMarkdownExtensions: (data.fromMarkdownExtensions as unknown[]) || [],
  };
};
