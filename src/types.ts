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

/**
 * A 1-based line and column with a 0-based character offset from the start of
 * the input.
 *
 * @public
 */
export interface ParsedPoint {
  /** 1-based line number */
  line: number
  /** 1-based column number */
  column: number
  /** 0-based character offset from the beginning of the input */
  offset: number
}

/**
 * Start and end positions of a parsed AST node.
 *
 * @public
 */
export interface ParsedPosition {
  /** Position of the first character of the node */
  start: ParsedPoint
  /** Position of the first character after the node */
  end: ParsedPoint
}

/**
 * Recursively rewrites a mdast node so `position` and its nested
 * `start/end.offset` are non-optional.
 *
 * @public
 */
export type Positioned<T> = T extends { children: Array<infer Child> }
  ? Omit<T, 'position' | 'children'> & {
    position: ParsedPosition
    children: Array<Positioned<Child>>
  }
  : Omit<T, 'position'> & {
    position: ParsedPosition
  };

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

/** @public */
export type MarkdownInlineCodeNode = import('mdast').InlineCode;

/**
 * The AST root returned by `parseMd`, with non-optional `position`
 * (including `start/end.offset`) on every node in the tree.
 *
 * @public
 */
export type PositionedMarkdownRoot = Positioned<MarkdownRoot>;

/**
 * Any AST node returned by `parseMd`, with non-optional `position`
 * (including `start/end.offset`).
 *
 * @public
 */
export type PositionedMarkdownNode = Positioned<MarkdownNode>;
