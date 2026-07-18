import parser = require('@lint-md/parser');

const doc = parser.parseMdWithSourceMap('# CommonJS');
// @ts-expect-error segment implementation details are intentionally internal.
type HiddenSegment = parser.MarkdownSourceMapSegment;
// @ts-expect-error segment implementation details are intentionally internal.
type HiddenSegmentKind = parser.SourceMapSegmentKind;
const raw: string = doc.sourceMap.getRaw(doc.ast.children[0]);
const inlineCodeRaw: string = doc.sourceMap.getRaw(
  doc.ast.children[0] as parser.MarkdownInlineCodeNode,
);
const codeRaw: string = doc.sourceMap.getRaw(
  doc.ast.children[0] as parser.MarkdownCodeNode,
);
const range = doc.sourceMap.getSourceRange(doc.ast.children[0] as parser.MarkdownTextNode, 0, 1);
const inlineCodeRange = doc.sourceMap.getSourceRange(
  doc.ast.children[0] as parser.MarkdownInlineCodeNode,
  0,
  1,
);
const codeRange = doc.sourceMap.getSourceRange(
  doc.ast.children[0] as parser.MarkdownCodeNode,
  0,
  1,
);
const consistency = new parser.SourceMapConsistencyError();
const asRangeError: RangeError = new parser.SourceMapUnavailableError();
const isSourceMapError: boolean = consistency instanceof parser.SourceMapError;
const code: parser.SourceMapErrorCode = consistency.code;
void raw;
void inlineCodeRaw;
void range;
void inlineCodeRange;
void codeRange;
void codeRaw;
void consistency;
void asRangeError;
void isSourceMapError;
void code;

const root = parser.parseMd('# CommonJS');

const rootOffset: number = root.position.start.offset;
const typedRoot: parser.PositionedMarkdownRoot = root;

const firstNode: parser.PositionedMarkdownNode = root.children[0];
const nodeOffset: number = firstNode.position.end.offset;

const markdown: string = parser.revertMdAstNode(root);
const same: boolean = parser.stringifyMdAst === parser.revertMdAstNode;

void rootOffset;
void typedRoot;
void firstNode;
void nodeOffset;
void markdown;
void same;
