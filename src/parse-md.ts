import frontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { remark } from 'remark';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import type { MarkdownNode } from './types';

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
 * @param {string} md Markdown 文本
 * @returns {MarkdownNode} md ast 结构
 * @author YuZhanglong <loveyzl1123@gmail.com>
 */
export const parseMd = (md: string): MarkdownNode => {
  return depsLink.parse(md);
};

/**
 * 将 ast 解析成 markdown
 *
 * @param {MarkdownNode} node ast 结构
 * @returns {string} md Markdown 文本
 * @author YuZhanglong <loveyzl1123@gmail.com>
 */
export const revertMdAstNode = (node: MarkdownNode): string => {
  return depsLink.stringify(node);
};
