import {
  parseMd,
  revertMdAstNode,
  stringifyMdAst,
  type PositionedMarkdownRoot,
  type PositionedMarkdownNode,
} from '@lint-md/parser';

const root = parseMd('# ESM');

const rootOffset: number = root.position.start.offset;
const typedRoot: PositionedMarkdownRoot = root;

const firstNode: PositionedMarkdownNode = root.children[0];
const nodeOffset: number = firstNode.position.end.offset;

const markdown: string = revertMdAstNode(root);
const same: boolean = stringifyMdAst === revertMdAstNode;

void rootOffset;
void typedRoot;
void firstNode;
void nodeOffset;
void markdown;
void same;
