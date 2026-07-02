# Changelog

## 0.1.2

### Added

- 新增 `ParsedPoint` / `ParsedPosition` / `Positioned<T>` / `PositionedMarkdownRoot` / `PositionedMarkdownNode` 公开类型
- `parseMd` 返回类型收紧为 `PositionedMarkdownRoot`，在 API 边界表达"所有解析节点都带 `position` 与 `start/end.offset`"的运行时契约
- README 增加"位置契约"小节

### Tests

- 新增 `__tests__/position.spec.ts`，参数化覆盖 24 个节点类型（frontmatter / heading / thematicBreak / blockquote / list / task list / table / strikethrough / inline code / code block / hard break / autolink / link / image / reference / definition / html / math / directive 等），递归断言每个节点的 `position` 完整
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
