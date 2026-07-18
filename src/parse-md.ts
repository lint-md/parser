import { createParserProcessor } from './remark-config';
import type { MarkdownRoot, PositionedMarkdownRoot } from './types';

const depsLink = createParserProcessor();

/**
 * 将 Markdown 解析成 ast
 *
 * @param md - Markdown 文本
 * @returns 解析后的 AST 根节点，递归带 position（含 start/end.offset）
 *
 * @public
 */
export const parseMd = (md: string): PositionedMarkdownRoot => {
  // The `as PositionedMarkdownRoot` cast asserts a parser-level contract:
  // the AST returned by `remark().parse()` is fully positioned.
  //
  // The contract rests on three guarantees:
  // 1. `gfmAutolinkLiteralFromMarkdown.transforms = []` (set in
  //    `./remark-config`) disables the GFM autolink post-process, which is the
  //    only known path that can synthesize children without a `position` (see
  //    https://github.com/remarkjs/remark-gfm/issues/16).
  // 2. The unified processor is module-level and reused across calls,
  //    so behavior does not drift between invocations.
  // 3. `__tests__/position.spec.ts` traverses the parsed tree and
  //    asserts every node carries a complete `position`. If a future
  //    plugin or remark upgrade violates the contract, the test fails
  //    before this cast can silently propagate to downstream code.
  return depsLink.parse(md) as PositionedMarkdownRoot;
};

/**
 * 将 ast 解析成 markdown
 *
 * @param node - ast 结构
 * @returns md Markdown 文本
 *
 * @public
 */
export const revertMdAstNode = (node: MarkdownRoot): string => {
  return depsLink.stringify(node);
};
