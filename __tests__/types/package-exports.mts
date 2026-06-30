import { parseMd, revertMdAstNode } from '@lint-md/parser';

const root = parseMd('# ESM');
const markdown: string = revertMdAstNode(root);

void markdown;
