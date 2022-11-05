import type { Parent } from 'unist';

export type MarkdownNode = Parent & any;

/** Markdown 节点位置 */
export interface MarkdownNodePosition {
  /**
   * 所在行（索引从 1 开始）
   */
  line: number

  /**
   * 所在列（索引从 1 开始）
   */
  column: number
}

export type MarkdownCodeNode = MarkdownNode & {
  value: string
  lang: string
};

export type MarkdownListItemNode = MarkdownNode & {
  children: MarkdownNode[]
};

export type MarkdownLinkNode = MarkdownNode & {
  url: string
};

export type MarkdownTextNode = MarkdownNode & {
  value: string
};
