# @lint-md/parser

lint-md 的解析器，基于 remark 生态，将 Markdown 字符串转换成 AST。

单独拆包封装一层的意义是当前 remark 的稳定版本只支持 ESModule，但是 lint-md 主模块依赖了很多 CommonJS 的库，故无法直接迁移到 ESModule。

故将使用 remark 的代码抽离到单独模块，通过 esbuild 同时提供 CommonJS 和 ESModule 产物。


## 快速开始

```ts
import { parseMd } from '@lint-md/parser';

// 将 markdown 转换成 ast
const ast = parseMd('你的 Markdown 文本');
```

### 序列化说明

`revertMdAstNode` 会将 AST 序列化为 Markdown，但 **不保证恢复原始文本**。
`revertMdAstNode(parseMd(md))` 会对 Markdown 做规范化：

- 合法的 autolink（`www.…`、`http://…`、`foo@example.com`）会被序列化为标准 GFM 格式
- 波浪线删除线 `~text~` 会规范化为 `~~text~~`
- 部分特殊字符会被转义（如 `"www.google.com"` 在序列化时变为 `"www\.google.com"`）

如需语义更明确的名字，可使用别名 `stringifyMdAst`，功能与 `revertMdAstNode` 完全相同。

## 位置契约

`parseMd` 返回的 AST 节点**总是**带 `position`，且 `position.start` 与
`position.end` 的 `line` / `column` / `offset` 字段都是 `number`（而非 `undefined`）。
这个契约通过 `PositionedMarkdownRoot` / `PositionedMarkdownNode` 在类型层表达，
因此直接解析和遍历 AST 时不需要额外判空：

```ts
import { parseMd, type PositionedMarkdownNode } from '@lint-md/parser';

const ast = parseMd('# title');
ast.position.start.offset; // number

const firstNode: PositionedMarkdownNode = ast.children[0];
firstNode.position.end.offset; // number
```

> **注意**：`MarkdownRoot` / `MarkdownNode` 仍透传 mdast 原生类型（即 `position` 可选），
> 因为外部构造或修改后的 AST 未必带 position。如果需要“必有 position”约束，使用
> `PositionedMarkdownRoot` / `PositionedMarkdownNode`。
>
> 如果要向解析结果插入自行构造的无 position 节点，请先将其类型放宽为 `MarkdownRoot`，
> 或为新节点补齐 position。

## 源码映射（source map）

`parseMd` 只保证每个节点在原始 Markdown 中的整体范围（`node.position`）。但对于
`text` 节点，`node.value` 已经过归一化（如 `\(` → `(`、`&amp;` → `&`），而
`node.position` 仍指向原始文本。要回答“`node.value` 中的某一段对应原文哪一段”，
请使用 `parseMdWithSourceMap`：

```ts
import { parseMdWithSourceMap } from '@lint-md/parser';

const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');

const textNode = ast.children[0].children[0]; // text value "A&B"
// 把 value 中第 1 个字符（解码后的 '&'）映射回原始 Markdown 的 '&amp;' 区间
const range = sourceMap.getSourceRange(textNode, 1, 2);
// range.start.offset === 2, range.end.offset === 5

// 取回该 text 节点对应的原始 Markdown 子串
sourceMap.getRaw(textNode); // 'A&amp;B'
```

### 为什么由 parser 提供

只有 tokenizer / AST 编译器掌握完整上下文，才能正确处理：

- `\(` 是否被解析为转义字符
- `&amp;` 是否被解析为字符引用，还是（如在 autolink `<https://…?a&amp;b>` 中）保持字面量
- 数值字符引用被归一化成什么字符，非法码点是否变为替换字符（U+FFFD）

下游若自行重新解析或对齐，会与 parser / 实体库的语义产生漂移。`parseMdWithSourceMap`
在同一次 micromark → mdast 编译过程中直接记录映射，复用与 `parseMd` 完全相同的
解码决策路径。

### 契约

- `getSourceRange(node, valueStart, valueEnd)` 的索引与 JavaScript 字符串下标一致，范围均为半开区间 `[start, end)`。
- 映射覆盖整个 `node.value`，segment 之间无空洞、无重叠。
- `getSourceRange(node, 0, node.value.length)` 覆盖该 text 节点的完整原始来源范围。
- 无法对应原文的节点（如插件合成节点）`getRaw` / `getSourceRange` 会抛出 `RangeError`，不会伪造位置。
- 当前版本仅覆盖 `text.value`；其余字段（`inlineCode.value`、`code.value`、`link.url` 等）后续版本补充。

## 开发验证

```bash
pnpm run build
pnpm run test:package
```

`test:package` 会打包并安装实际 tarball，然后验证 CommonJS、ESModule 和 TypeScript 类型入口。

## 维护说明

### 环境要求

- Node.js >= 20
- pnpm 11（参见 `packageManager` 字段）

```bash
pnpm install --frozen-lockfile   # 首次安装使用锁文件
```

### 公开 API 管理

本项目使用 [API Extractor](https://api-extractor.com/) 管理公开 API。

- 所有公开导出必须添加 `/** @public */` 标签
- JSDoc 注释须遵循 TSDoc 格式：参数写 `@param name - 说明`（不写类型），返回值写 `@returns 说明`
- 修改公开 API 后运行 `pnpm run build`，API Extractor 会自动更新 `etc/parser.api.md`
- 将更新后的 API report 文件一并提交

### CI 检查

- `etc/parser.api.md` 过期会导致 CI 构建失败
- API Extractor 报告的 compiler / extractor / TSDoc warning 均视为错误

## License

MIT
