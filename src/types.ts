import type { Code, Content, Link, ListItem, Root, Text } from 'mdast';

export type MarkdownRoot = Root;

export type MarkdownNode = MarkdownRoot | Content;

export type MarkdownCodeNode = Code;

export type MarkdownListItemNode = ListItem;

export type MarkdownLinkNode = Link;

export type MarkdownTextNode = Text;
