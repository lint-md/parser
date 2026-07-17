import parser = require('@lint-md/parser');

const doc = parser.parseMdWithSourceMap('# CommonJS');
const segKind: parser.MarkdownSourceMapSegment['kind'] = 'character-reference';
const raw: string = doc.sourceMap.getRaw(doc.ast.children[0]);
const range = doc.sourceMap.getSourceRange(doc.ast.children[0] as parser.MarkdownTextNode, 0, 1);
void segKind;
void raw;
void range;

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
