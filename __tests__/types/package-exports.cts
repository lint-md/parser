import parser = require('@lint-md/parser');

const root = parser.parseMd('# CommonJS');
const markdown: string = parser.revertMdAstNode(root);

void markdown;
