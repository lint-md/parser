# Changelog

## Unreleased

### Fixed

- 新增确定性差分组合 fuzz 测试（`__tests__/source-map/differential.spec.ts`）：枚举原子 Markdown 片段的笛卡尔积（pair / triple / 行首前缀）对每篇文档断言 AST parity、整值 range 落在原文内、`getRaw` 与整值区间一致；并新增「任意前序构造后接 CRLF+x」的 oracle 检查——从生成输入的已知后缀位置直接断言 `\r`/`\n`/x 各自映射为单个源码 code unit（oracle 来自输入而非映射结果，避免用被测输出反推 literal），系统覆盖 #57「前序构造污染后续 literal」类别。通用 fuzz 不再 swallow `getRaw` 异常，且对每个 owned node（含非 text）断言 `getRaw` 等于其 position 的源码切片。CI 新增对应 smoke 步骤（#58）

- 修复转义字符后紧跟 CRLF 时，换行 source-map segment 错误继承 `escape` kind，导致 `\r` 与 `\n` 被作为同一原子段映射（两者映射到整个 `\r\n` 且重叠、CR/LF 之间的空区间误抛 `RangeError`）的问题；换行现按逐 UTF-16 code unit 正确映射（#57）

## 0.1.3

### Added

- 新增 `parseMdWithSourceMap(md)`，在解析同时产出 `text` 节点 `value` 到原始 Markdown 的源码映射（`MarkdownSourceMap`）
- 新增公开类型 `ParsedMarkdownDocument`、`MarkdownSourceMap`、`MarkdownSourceMapSegment`、`SourceMapSegmentKind`
- `MarkdownSourceMap.getRaw` / `getSourceRange` 提供"归一化 value → 原始 source 区间"的反查能力，autolink 内保持字面量的 `&amp;` 也正确映射
- 新增依赖：`mdast-util-from-markdown`、`decode-named-character-reference`、`micromark-util-decode-numeric-character-reference`（与 remark 内部使用的版本一致，避免实体解码语义漂移）
- 新增公开错误类型 `SourceMapError` / `SourceMapConsistencyError` / `SourceMapUnavailableError`：继承 `RangeError` 并带稳定 `code` 字段（`ERR_SOURCE_MAP_CONSISTENCY` / `ERR_SOURCE_MAP_UNAVAILABLE`，类型为字面量联合 `SourceMapErrorCode`），区分「映射失效」「无可用映射」「非法参数」三条错误路径，`instanceof` 不可靠时可用 `code` 判断
- `getRaw` / `getSourceRange` 检测解析后被修改的 text 节点并抛 `SourceMapConsistencyError`（映射仅对原始解析值有效；赋入相同内容的 `value` 不受影响）

### Tests

- 新增 `__tests__/source-map.spec.ts`，覆盖转义、命名 / 十进制 / 十六进制字符引用、双 UTF-16 code unit 解码、autolink 字面量、`&#0;` / `&#128;` / `&#xFDD0;` 等非法码点、CRLF 与多行、连续片段、插件拆分（www / email autolink 前后的兄弟 text 节点）与无法归因节点的 `RangeError` 契约，以及 `getRaw` / `getSourceRange` 的越界与外来节点契约
- 新增 error lifecycle 测试：解析后修改 text 节点抛 `SourceMapConsistencyError`（含 `code` / `name` / `instanceof` 断言）、解析后加入 AST 的 text 节点（即使带看似合法的 position）抛 `SourceMapUnavailableError`、无映射节点抛 `SourceMapUnavailableError`、非法参数保持普通 `RangeError`、多次解析的 source map 相互隔离
- CJS / ESM 运行时冒烟测试覆盖 `parseMdWithSourceMap` 与错误类导出（含预期输出断言）；tarball 冒烟测试从安装后的包分别验证 CJS / ESM 的 `parseMdWithSourceMap` 与三个错误类的名称与 `code`

### Fixed

- `getSourceRange` 将转义 / 字符引用 / 非法码点归一化视为**不可拆分原子**：任何与其相交的 value range 都返回该 segment 的完整 source range，避免自动修复只替换实体的一半；仅 `literal` 段支持逐 code unit 边界
- `pointAtOffset` 改为复用与 micromark 一致的换行与列约定（CRLF / CR / LF 均结束一行，列按 UTF-16 code unit 计数），修复 `a\rb`、astral Unicode 等场景的 `line` / `column` 错误
- `getRaw(node)` 改用节点自身的 `position` 从原文切片，对任意带 position 的 AST 节点（root、paragraph 等）都有效，不再仅限被记录的 text 节点
- 非法码点（如 `&#0;` / `&#128;` / `&#xFDD0;`）正确记录为 `normalization` kind，而非 `character-reference`

### Changed

- `getSourceRange` 的结束位置改由 `valueEnd - 1` 所在 segment 计算，避免 `[0,1)` 误吞紧随其后的实体 / 转义（如 `A&amp;B` 仅映射 `A`）；空区间 `[i,i)` 若落在原子段内部则抛出 `RangeError`，因为那里不存在准确的原文边界
- `getRaw(textNode)` 改为使用已记录的 source-map segment 的**完整** outer-token 区间（如 `&#0;` 现在返回完整的 `&#0;`，含结尾分号）；非 text 节点仍使用节点自身 `position`

### Refactored

- 解析器不再在模块初始化时改写共享的第三方扩展单例 `gfmAutolinkLiteralFromMarkdown.transforms`（会污染同进程内所有使用该依赖实例的代码）；改为 `createParserProcessor()` 内的本地插件 `positionSafeGfm`，在当前 processor 自己的 data 中将 autolink 扩展替换为一个 `transforms` 置空的浅克隆，保持原单例不变（#50）
- `positionSafeGfm` 保留扩展的嵌套数组结构（不 flatten 写回），并要求恰好替换一次，否则显式抛错，避免 `remark-gfm` 升级或重复依赖安装时该 workaround 静默失效；每次 `createParserProcessor()` 产出相互独立的 processor 实例
- 解析行为、公开 API 与 positioned-node 契约完全不变；`parseMd()` 与 `parseMdWithSourceMap().ast` 对代表性语料仍深度一致

### Tests

- 新增 `__tests__/source-map/` 三个测试文件，通过 `getRaw` / `getSourceRange` 黑盒锁定映射不变量（整体范围合法且落在 `[0, markdown.length]`、与 `getRaw` 一致、逐 code unit 非递减、原子段可重叠）、fixer 集成（转义 / 字符引用按完整 token 从右到左替换）与边界用例（跟随 parser 实际输出，独立断言精确 source span）（#49）
- 新增 `__tests__/parser-isolation-bundle.spec.ts`：以依赖外置（`packages: 'external'`）方式临时构建产物，令测试与产物解析到同一个 `mdast-util-gfm-autolink-literal` 单例，验证解析后单例引用与内容均未变（两种 import 顺序、重复 / 交错解析），并直接断言每个 processor 持有各自独立、`transforms` 置空的克隆；`__tests__/parser-isolation.spec.ts` 以公开 API 验证默认语法节点类型、完整 position 与 source-map parity（#50）
- `getRaw` / `getSourceRange` 增加文档归属校验：通过解析后遍历 AST 建立 `WeakSet`，拒绝外来节点（来自另一次 `parseMdWithSourceMap` 调用），不再用外部 offset 静默切当前文档
- `getSourceRange` 增加有限整数校验，`valueStart` / `valueEnd` 必须为有限整数，否则抛 `RangeError`
- 抽取共享模块 `src/remark-config.ts`（`createParserProcessor` / `getParserExtensions`），`parseMd` 与 `parseMdWithSourceMap` 复用同一套插件栈与冻结的 parser 扩展，降低 AST 漂移风险
- 空区间 `[i,i)` 改为单独解析为单一 source point：起点 / 终点 / 某 segment 起点 / literal 段内部均返回准确边界；仅多 code unit 原子段（如 `&Afr;` 的 surrogate pair）内部才抛 `RangeError`，不再把 `[0,0)` 错误变成 `[0,1)` 或误拒原子段的精确起点
- README 示例修正：`A&amp;B` 中 `&amp;` 的半开区间为 `[1, 6)`（原写为 `[2, 5)`）
- 错误类名通过各子类构造函数显式设置（`this.name = 'SourceMapConsistencyError'` 等），不依赖 bundler 的 `--keep-names`；公共 `name` 在任何压缩配置下都稳定

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
