import frontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { remark } from 'remark';
import { combineExtensions } from 'micromark-util-combine-extensions';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { gfmFootnoteFromMarkdown, gfmFootnoteToMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown, gfmStrikethroughToMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown, gfmTaskListItemToMarkdown } from 'mdast-util-gfm-task-list-item';
import type { MarkdownNode } from './types';

const gfmExtension = combineExtensions([
  gfmFootnote(),
  gfmStrikethrough(),
  gfmTable(),
  gfmTaskListItem(),
]);

const depsLink = remark()
  .use(frontmatter)
  .use(remarkDirective)
  .use(remarkMath);

// Manually register GFM extensions (without autolink literals to avoid false positives)
const data = depsLink.data();
data.micromarkExtensions = data.micromarkExtensions || [];
data.micromarkExtensions.push(gfmExtension);
data.fromMarkdownExtensions = data.fromMarkdownExtensions || [];
data.fromMarkdownExtensions.push(
  gfmFootnoteFromMarkdown(),
  gfmStrikethroughFromMarkdown(),
  gfmTableFromMarkdown(),
  gfmTaskListItemFromMarkdown(),
);
data.toMarkdownExtensions = data.toMarkdownExtensions || [];
data.toMarkdownExtensions.push(
  gfmFootnoteToMarkdown(),
  gfmStrikethroughToMarkdown(),
  gfmTableToMarkdown(),
  gfmTaskListItemToMarkdown(),
);

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
