# Changelog

## 0.1.3

### Added

- 新增 `parseMdWithSourceMap(md)`，在解析同时产出 `text` 节点 `value` 到原始 Markdown 的源码映射（`MarkdownSourceMap`）
- 新增公开类型 `ParsedMarkdownDocument`、`MarkdownSourceMap`、`MarkdownSourceMapSegment`、`SourceMapSegmentKind`
- `MarkdownSourceMap.getRaw` / `getSourceRange` 提供"归一化 value → 原始 source 区间"的反查能力，autolink 内保持字面量的 `&amp;` 也正确映射
- 新增依赖：`mdast-util-from-markdown`、`decode-named-character-reference`、`micromark-util-decode-numeric-character-reference`（与 remark 内部使用的版本一致，避免实体解码语义漂移）

### Tests

- 新增 `__tests__/source-map.spec.ts`，覆盖转义、命名 / 十进制 / 十六进制字符引用、双 UTF-16 code unit 解码、autolink 字面量、`&#0;` / `&#128;` / `&#xFDD0;` 等非法码点、CRLF 与多行、连续片段、插件拆分（www / email autolink 前后的兄弟 text 节点）与无法归因节点的 `RangeError` 契约，以及 `getRaw` / `getSourceRange` 的越界与外来节点契约

### Fixed

- `getSourceRange` 将转义 / 字符引用 / 非法码点归一化视为**不可拆分原子**：任何与其相交的 value range 都返回该 segment 的完整 source range，避免自动修复只替换实体的一半；仅 `literal` 段支持逐 code unit 边界
- `pointAtOffset` 改为复用与 micromark 一致的换行与列约定（CRLF / CR / LF 均结束一行，列按 UTF-16 code unit 计数），修复 `a\rb`、astral Unicode 等场景的 `line` / `column` 错误
- `getRaw(node)` 改用节点自身的 `position` 从原文切片，对任意带 position 的 AST 节点（root、paragraph 等）都有效，不再仅限被记录的 text 节点
- 非法码点（如 `&#0;` / `&#128;` / `&#xFDD0;`）正确记录为 `normalization` kind，而非 `character-reference`

### Changed

- `getSourceRange` 的结束位置改由 `valueEnd - 1` 所在 segment 计算，避免 `[0,1)` 误吞紧随其后的实体 / 转义（如 `A&amp;B` 仅映射 `A`）；空区间 `[i,i)` 若落在原子段内部则抛出 `RangeError`，因为那里不存在准确的原文边界
- `getRaw(textNode)` 改为使用已记录的 source-map segment 的**完整** outer-token 区间（如 `&#0;` 现在返回完整的 `&#0;`，含结尾分号）；非 text 节点仍使用节点自身 `position`
- `getRaw` / `getSourceRange` 增加文档归属校验：通过解析后遍历 AST 建立 `WeakSet`，拒绝外来节点（来自另一次 `parseMdWithSourceMap` 调用），不再用外部 offset 静默切当前文档
- `getSourceRange` 增加有限整数校验，`valueStart` / `valueEnd` 必须为有限整数，否则抛 `RangeError`
- 抽取共享模块 `src/remark-config.ts`（`createParserProcessor` / `getParserExtensions`），`parseMd` 与 `parseMdWithSourceMap` 复用同一套插件栈与冻结的 parser 扩展，降低 AST 漂移风险
- 空区间 `[i,i)` 改为单独解析为单一 source point：起点 / 终点 / 某 segment 起点 / literal 段内部均返回准确边界；仅多 code unit 原子段（如 `&Afr;` 的 surrogate pair）内部才抛 `RangeError`，不再把 `[0,0)` 错误变成 `[0,1)` 或误拒原子段的精确起点
- README 示例修正：`A&amp;B` 中 `&amp;` 的半开区间为 `[1, 6)`（原写为 `[2, 5)`）

### Tests

- `__tests__/source-map.spec.ts` 补充 P1 / P2 / P4 回归用例，并新增 `parseMd` 与 `parseMdWithSourceMap` 的 AST 一致性 corpus / property 测试（覆盖 GFM、directive、math、frontmatter、混合换行、astral Unicode 等）

## 0.1.2

### Added

- 新增 `ParsedPoint` / `ParsedPosition` / `Positioned<T>` / `PositionedMarkdownRoot` / `PositionedMarkdownNode` 公开类型
- `parseMd` 返回类型收紧为 `PositionedMarkdownRoot`，在 API 边界表达"所有解析节点都带 `position` 与 `start/end.offset`"的运行时契约
- README 增加“位置契约”及修改 AST 时的类型注意事项

### Tests

- 新增 `__tests__/position.spec.ts`，覆盖 frontmatter、GFM、math 和 directive 等插件生成的解析树，递归断言其中每个节点的 `position` 完整
- `__tests__/types/package-exports.{mts,cts}` 验证 `parseMd(...).position.start.offset` 编译为 `number`

## 0.1.0

### Added

- 新增 `MarkdownMath`、`MarkdownInlineMath`、`MarkdownContainerDirective`、`MarkdownLeafDirective`、`MarkdownTextDirective` 等公开 AST 节点类型
- 新增 `MarkdownDirectiveFields` 公共字段接口
- 新增 `stringifyMdAst` 别名，语义更明确

### Changed

- `revertMdAstNode(parseMd(md))` 规范化说明写入 README（不保证恢复原始文本）
- 公开 API 全部添加 `@public` 标签，TSDoc 注释修正
- API Extractor 启用 API report（`etc/parser.api.md`），警告视为错误
- CI 添加 `node-version` matrix（20/22/24）、API report diff 检查
- `engines.node` 设为 `>=20`

### Fixed

- `MarkdownContainerDirective.children` 收窄为 `Array<BlockContent | DefinitionContent>`
- `MarkdownLeafDirective.children` / `MarkdownTextDirective.children` 收窄为 `PhrasingContent[]`

### Documented

- 记录 GFM autolink `transforms` workaround，增加引号内 URL 回归测试
- README 添加维护说明（环境要求、公开 API 管理、CI 检查）

## 0.0.14

- 使用 mdast 标准类型替代 `Parent & any`，提升类型安全性
- 添加 `exports` 字段，支持现代 Node.js 模块解析
- 优化 `files` 配置，移除 source map 和临时文件
- 将 `@types/unist` 移至 devDependencies
- 使用 esbuild 同时生成 CommonJS 和 ESModule 产物
- 升级 TypeScript 4 → 5、@types/node 16 → 20
- 升级 CI 工具链：GitHub Actions v6、pnpm 11

## 0.0.13

- 修复 GFM AST 错误
