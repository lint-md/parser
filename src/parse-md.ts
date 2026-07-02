import frontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { remark } from 'remark';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import type { MarkdownRoot, PositionedMarkdownRoot } from './types';

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

const depsLink = remark()
  .use(frontmatter)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMath);

/**
 * 将 Markdown 解析成 ast
 *
 * @param md - Markdown 文本
 * @returns 解析后的 AST 根节点，递归带 position（含 start/end.offset）
 *
 * @public
 */
export const parseMd = (md: string): PositionedMarkdownRoot => {
  return depsLink.parse(md) as PositionedMarkdownRoot;
};

/**
 * 将 ast 解析成 markdown
 *
 * @param node - ast 结构
 * @returns md Markdown 文本
 *
 * @public
 */
export const revertMdAstNode = (node: MarkdownRoot): string => {
  return depsLink.stringify(node);
};
