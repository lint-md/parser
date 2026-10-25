import assert from 'node:assert/strict';
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { parseMdx, parseMdxWithSourceMap } from '../dist/lint-md-parser.mjs';

const source = [
  'export const 用户ID = 42',
  '',
  '# 中文English标题',
  '',
  '<Chart label="中文English标签" />',
  '',
  '当前编号：{用户ID}',
].join('\n');

const { ast, sourceMap } = parseMdxWithSourceMap(source);
assert.deepEqual(ast, parseMdx(source));

const esm = ast.children.find(node => node.type === 'mdxjsEsm');
const heading = ast.children.find(node => node.type === 'heading');
const jsx = ast.children.find(node => node.type === 'mdxJsxFlowElement');
const paragraph = ast.children.find(node => node.type === 'paragraph');
assert.ok(esm && heading && jsx && paragraph);

const headingText = heading.children[0];
const bodyText = paragraph.children[0];
const expression = paragraph.children[1];
assert.equal(headingText.type, 'text');
assert.equal(bodyText.type, 'text');
assert.equal(expression.type, 'mdxTextExpression');
assert.equal(esm.value, 'export const 用户ID = 42');
assert.equal(expression.value, '用户ID');
assert.equal(jsx.attributes[0].value, '中文English标签');
assert.equal(sourceMap.getRaw(jsx), '<Chart label="中文English标签" />');
assert.equal(sourceMap.getRaw(headingText), '中文English标题');
assert.equal(sourceMap.getRaw(bodyText), '当前编号：');

const textValues = [];
function visit(node) {
  if (node.type === 'text') textValues.push(node.value);
  for (const child of node.children || []) visit(child);
}
visit(ast);
assert.deepEqual(textValues, ['中文English标题', '当前编号：']);

const edits = [
  {
    range: sourceMap.getSourceRange(headingText, 0, headingText.value.length),
    value: '中文 English 标题',
  },
  {
    range: sourceMap.getSourceRange(bodyText, 0, bodyText.value.length),
    value: '当前编号： ',
  },
];
assert.deepEqual(
  edits.map(({ range }) => source.slice(range.start.offset, range.end.offset)),
  ['中文English标题', '当前编号：'],
);

let fixed = source;
for (const { range, value } of edits.sort((a, b) => b.range.start.offset - a.range.start.offset)) {
  fixed = fixed.slice(0, range.start.offset) + value + fixed.slice(range.end.offset);
}

const expected = [
  'export const 用户ID = 42',
  '',
  '# 中文 English 标题',
  '',
  '<Chart label="中文English标签" />',
  '',
  '当前编号： {用户ID}',
].join('\n');
assert.deepEqual(Buffer.from(fixed), Buffer.from(expected));

const fixedDoc = parseMdxWithSourceMap(fixed);
const fixedEsm = fixedDoc.ast.children.find(node => node.type === 'mdxjsEsm');
const fixedJsx = fixedDoc.ast.children.find(node => node.type === 'mdxJsxFlowElement');
const fixedParagraph = fixedDoc.ast.children.find(node => node.type === 'paragraph');
assert.ok(fixedEsm && fixedJsx && fixedParagraph);
assert.equal(fixedDoc.sourceMap.getRaw(fixedEsm), sourceMap.getRaw(esm));
assert.equal(fixedDoc.sourceMap.getRaw(fixedJsx), sourceMap.getRaw(jsx));
assert.equal(fixedDoc.sourceMap.getRaw(fixedParagraph.children[1]),
  sourceMap.getRaw(expression));
assert.equal(fixedJsx.attributes[0].value, jsx.attributes[0].value);

const compiled = await compile(fixed, { remarkPlugins: [remarkGfm, remarkMath] });
assert.ok(String(compiled).includes('用户ID'));
assert.ok(String(compiled).includes('中文English标签'));
