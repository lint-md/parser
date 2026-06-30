import { parseMd, revertMdAstNode, stringifyMdAst } from '@lint-md/parser';

const root = parseMd('# ESM');
const markdown: string = revertMdAstNode(root);

const same: boolean = stringifyMdAst === revertMdAstNode;

void markdown;
void same;
