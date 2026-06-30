import frontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { remark } from 'remark';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import type { MarkdownRoot } from './types';

// https://github.com/remarkjs/remark-gfm/issues/16，解决某些 text 节点没有 position 的问题
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
 * @returns md ast 结构
 *
 * @public
 */
export const parseMd = (md: string): MarkdownRoot => {
  return depsLink.parse(md);
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
