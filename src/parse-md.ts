import { unified } from 'unified';
import remarkParse from 'remark-parse';
import frontmatter from 'remark-frontmatter';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { MarkdownNode } from './types';

const depsLink = unified()
  .use(remarkParse)
  .use(frontmatter)
  .use(remarkMdx)
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
export const revertMdAstNode = (node: MarkdownNode) => {
  return depsLink.stringify(node);
};
