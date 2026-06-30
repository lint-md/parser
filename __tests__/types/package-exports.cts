import parser = require('@lint-md/parser');

const root = parser.parseMd('# CommonJS');
const markdown: string = parser.revertMdAstNode(root);

const same: boolean = parser.stringifyMdAst === parser.revertMdAstNode;

void markdown;
void same;
