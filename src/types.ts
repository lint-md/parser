import type {
  BlockContent,
  Content,
  DefinitionContent,
  Literal,
  Parent,
  PhrasingContent,
  Root,
} from 'mdast';

export type { Code, Link, ListItem, Text } from 'mdast';

/** @public */
export interface MarkdownDirectiveFields {
  name: string
  attributes?: Record<string, string | null | undefined> | null | undefined
}

/** @public */
export interface MarkdownMath extends Literal {
  type: 'math'
  meta?: string | null | undefined
}

/** @public */
export interface MarkdownInlineMath extends Literal {
  type: 'inlineMath'
}

/** @public */
export interface MarkdownContainerDirective extends Parent, MarkdownDirectiveFields {
  type: 'containerDirective'
  children: Array<BlockContent | DefinitionContent>
}

/** @public */
export interface MarkdownLeafDirective extends Parent, MarkdownDirectiveFields {
  type: 'leafDirective'
  children: PhrasingContent[]
}

/** @public */
export interface MarkdownTextDirective extends Parent, MarkdownDirectiveFields {
  type: 'textDirective'
  children: PhrasingContent[]
}

/** @public */
export type MarkdownRoot = Root;

/** @public */
export type MarkdownNode = MarkdownRoot | Content;

/** @public */
export type MarkdownCodeNode = import('mdast').Code;

/** @public */
export type MarkdownListItemNode = import('mdast').ListItem;

/** @public */
export type MarkdownLinkNode = import('mdast').Link;

/** @public */
export type MarkdownTextNode = import('mdast').Text;
