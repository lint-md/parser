import {
  parseMd,
  parseMdWithSourceMap,
  revertMdAstNode,
  stringifyMdAst,
  SourceMapError,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
  type MarkdownSourceMapSegment,
  type ParsedMarkdownDocument,
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
const segKind: MarkdownSourceMapSegment['kind'] = 'character-reference';

const consistency = new SourceMapConsistencyError();
const unavailable = new SourceMapUnavailableError();
const asRangeError: RangeError = consistency;
const code: string = unavailable.code;
const isSourceMapError: boolean = unavailable instanceof SourceMapError;

void rootOffset;
void typedRoot;
void firstNode;
void nodeOffset;
void markdown;
void same;
void doc;
void segKind;
void consistency;
void unavailable;
void asRangeError;
void code;
void isSourceMapError;