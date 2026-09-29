import {
  parseMd,
  parseMdWithSourceMap,
  revertMdAstNode,
  stringifyMdAst,
  SourceMapError,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
  type SourceMapErrorCode,
  type CodeSourceInfo,
  type FencedCodeSourceInfo,
  type IndentedCodeSourceInfo,
  type MarkdownCodeNode,
  type ParsedMarkdownDocument,
  type MarkdownLinkNode,
  type MarkdownTextNode,
  type MarkdownValueSourceIndex,
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
const sourceIndex: MarkdownValueSourceIndex = doc.sourceMap.getValueSourceIndex(
  doc.ast.children[0] as MarkdownTextNode,
);
const sourceOffset: number = sourceIndex.sourceOffsetAt(0);
const urlRange = doc.sourceMap.getFieldSourceRange(
  doc.ast.children[0] as MarkdownLinkNode,
  'url',
  0,
  1,
);
const codeNode = doc.ast.children[0] as MarkdownCodeNode;
const codeSourceInfo: CodeSourceInfo = doc.sourceMap.getCodeSourceInfo(codeNode);

// The three new public types must stay exported.
type ExportedCodeSourceInfo = CodeSourceInfo;
type ExportedFencedCodeSourceInfo = FencedCodeSourceInfo;
type ExportedIndentedCodeSourceInfo = IndentedCodeSourceInfo;

// A consumer narrows the result with `kind`.
if (codeSourceInfo.kind === 'fenced') {
  const fenceStart: number = codeSourceInfo.openingFence.start.offset;
  const infoOffset: number = codeSourceInfo.infoInsertPoint.offset;
  void fenceStart;
  void infoOffset;
}
else {
  const indentedKind: 'indented' = codeSourceInfo.kind;
  void indentedKind;
}

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
void sourceIndex;
void sourceOffset;
void urlRange;
void codeNode;
void codeSourceInfo;
void consistency;
void unavailable;
void asRangeError;
void code;
void isSourceMapError;
