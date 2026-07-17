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
 *    通过清除 transforms 禁用，因为其生成的 link 子节点缺少 position。
 *
 * 行为示例：
 * - www.example.com      → link 节点（tokenizer 捕获 www. 前缀）
 * - <https://ex.com>     → link 节点（tokenizer 捕获尖括号语法）
 * - "www.google.com"     → text 节点（tokenizer 未捕获，transform 已禁用）
 */
gfmAutolinkLiteralFromMarkdown.transforms = [];

/**
 * The single source of truth for the remark plugin stack. Both {@link parseMd}
 * and {@link parseMdWithSourceMap} must use exactly this configuration so
 * their tokenizer / mdast-extension decisions (and therefore their ASTs)
 * never drift apart.
 */
export const createParserProcessor = (): ReturnType<typeof remark> =>
  remark()
    .use(frontmatter)
    .use(remarkGfm)
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
