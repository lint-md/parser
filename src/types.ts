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

export interface MarkdownDirectiveFields {
  name: string
  attributes?: Record<string, string | null | undefined> | null | undefined
}

export interface MarkdownMath extends Literal {
  type: 'math'
  meta?: string | null | undefined
}

export interface MarkdownInlineMath extends Literal {
  type: 'inlineMath'
}

export interface MarkdownContainerDirective extends Parent, MarkdownDirectiveFields {
  type: 'containerDirective'
  children: Array<BlockContent | DefinitionContent>
}

export interface MarkdownLeafDirective extends Parent, MarkdownDirectiveFields {
  type: 'leafDirective'
  children: PhrasingContent[]
}

export interface MarkdownTextDirective extends Parent, MarkdownDirectiveFields {
  type: 'textDirective'
  children: PhrasingContent[]
}

export type MarkdownRoot = Root;

export type MarkdownNode = MarkdownRoot | Content;

export type MarkdownCodeNode = import('mdast').Code;

export type MarkdownListItemNode = import('mdast').ListItem;

export type MarkdownLinkNode = import('mdast').Link;

export type MarkdownTextNode = import('mdast').Text;
