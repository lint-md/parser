import {
  parseMd,
  parseMdWithSourceMap,
  revertMdAstNode,
  stringifyMdAst,
  SourceMapError,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
  type SourceMapErrorCode,
  type ParsedMarkdownDocument,
  type MarkdownLinkNode,
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

const doc: ParsedMarkdownDocument = parseMdWithSourceMap('# ESM');
const urlRange = doc.sourceMap.getFieldSourceRange(
  doc.ast.children[0] as MarkdownLinkNode,
  'url',
  0,
  1,
);

// @ts-expect-error segment implementation details are intentionally internal.
type HiddenSegment = import('@lint-md/parser').MarkdownSourceMapSegment;
// @ts-expect-error segment implementation details are intentionally internal.
type HiddenSegmentKind = import('@lint-md/parser').SourceMapSegmentKind;

const consistency = new SourceMapConsistencyError();
const unavailable = new SourceMapUnavailableError();
const asRangeError: RangeError = consistency;
const code: SourceMapErrorCode = unavailable.code;
const isSourceMapError: boolean = unavailable instanceof SourceMapError;

void rootOffset;
void typedRoot;
void firstNode;
void nodeOffset;
void markdown;
void same;
void doc;
void urlRange;
void consistency;
void unavailable;
void asRangeError;
void code;
void isSourceMapError;
