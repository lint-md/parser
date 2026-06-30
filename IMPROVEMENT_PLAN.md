# 项目改进计划

本文档记录 `@lint-md/parser` 后续需要完成的工程改进，按优先级排列。

## P0：发布与兼容性

### 1. 修复 ESM 命名导入

当前产物只有 CommonJS 构建。TypeScript 允许以下写法，但原生 ESM 运行时无法获得命名导出：

```ts
import { parseMd } from '@lint-md/parser';
```

待办：

- [ ] 确定继续仅支持 CommonJS，还是同时发布 CommonJS 和 ESM。
- [ ] 推荐生成独立的 CJS、ESM 产物，并通过 `exports.require`、`exports.import` 分别导出。
- [ ] 如果仅支持 CommonJS，添加 `"type": "commonjs"`，并在 README 中明确 ESM 调用方式。
- [ ] 增加 CommonJS `require()` 和原生 ESM `import` 的发布包测试。

验收标准：

- `@arethetypeswrong/cli --pack .` 不再报告 Named exports 问题。
- README 中的所有导入示例都能在对应运行环境执行。

### 2. 固定构建环境

当前仓库忽略 `pnpm-lock.yaml`，CI 安装结果会随依赖更新而变化。

待办：

- [ ] 不再忽略 `pnpm-lock.yaml`，生成并提交锁文件。
- [ ] 在 `package.json` 中添加 `packageManager`。
- [ ] 明确最低 Node.js 版本并添加 `engines.node`。
- [ ] GitHub Actions 使用明确的 Node.js 版本。
- [ ] CI 改用 `pnpm install --frozen-lockfile`。

验收标准：

- 本地与 CI 安装相同版本的依赖。
- `pnpm peers check` 无错误。

## P1：公开类型 API

### 3. 完善 Markdown AST 类型

`MarkdownRoot = Root` 已覆盖标准 mdast、GFM 和 YAML 节点，但当前解析器还会产生 math 和 directive 扩展节点。发布的声明文件没有完整表达这些节点。

待办：

- [ ] 将 `math`、`inlineMath` 和 directive 节点纳入公开 AST 类型。
- [ ] 保持 `parseMd(md: string): MarkdownRoot`。
- [ ] 保持 `revertMdAstNode(node: MarkdownRoot): string`。
- [ ] 确认声明文件依赖只包含消费者实际需要的类型包。
- [ ] 增加针对发布后 `.d.ts` 的消费者编译测试。

验收标准：

- 消费者可以对所有实际返回的节点进行类型收窄。
- 类型测试覆盖 frontmatter、GFM、math 和 directive 节点。

### 4. 管理公开 API 变更

API Extractor 当前产生 TSDoc 和 release tag 警告，但不会阻止构建。

待办：

- [ ] 将 JSDoc 类型标记改成符合 TSDoc 的注释。
- [ ] 为公开函数和类型添加 `@public`。
- [ ] 启用并提交 API Extractor API report。
- [ ] CI 中将公开 API 警告视为失败。

验收标准：

- `pnpm run build` 不产生 API Extractor 警告。
- 公开类型变化会在 PR diff 中明确显示。

## P1：解析行为

### 5. 明确 GFM autolink workaround

当前代码通过修改 `gfmAutolinkLiteralFromMarkdown.transforms` 保证部分节点带有位置，但这会改变完整的 GFM autolink 行为，并依赖第三方模块实例被正确去重。

待办：

- [ ] 记录该 workaround 的业务需求和行为差异。
- [ ] 为上游 issue 中的输入增加回归测试。
- [ ] 测试普通 URL、编码 URL、引号内 URL 和邮箱地址。
- [ ] 评估使用解析后位置修复，替代修改第三方模块全局状态。
- [ ] 如果保留当前行为，在 README 中明确说明。

验收标准：

- 位置行为和 autolink 行为都有明确、稳定的测试。
- 依赖升级不会静默改变解析结果。

### 6. 明确序列化语义

`revertMdAstNode(parseMd(md))` 会规范化 Markdown，不保证恢复原始文本。

待办：

- [ ] 在 README 中说明序列化会调整链接、转义和格式。
- [ ] 考虑新增语义更明确的 `stringifyMdAst` 别名。
- [ ] 如新增别名，保留 `revertMdAstNode` 以避免破坏兼容性。

## P2：依赖与构建

### 7. 清理依赖分类

remark 相关依赖已被 Webpack 打入最终产物，但仍被声明为运行时依赖。

待办：

- [ ] 将仅用于构建的 remark 相关包移至 `devDependencies`。
- [ ] 保留发布声明文件直接引用的类型依赖。
- [ ] 删除未直接使用的 `@types/unist`。
- [ ] 删除未使用的 `concurrently`、`npm-run-all` 和 `rimraf`。
- [ ] 使用 `pnpm pack` 安装测试确认发布包可独立运行。

验收标准：

- 安装发布包时不再重复安装已经打包的 remark 运行时依赖。
- CJS、ESM和类型测试均从实际 tarball 执行成功。

### 8. 升级工具链

当前 Jest、ts-jest 和 TypeScript 存在 peer dependency 冲突，多个依赖已落后一个或多个主版本。

待办：

- [ ] 先解决 Jest、ts-jest、`@types/jest` 和 TypeScript 的版本匹配。
- [ ] 成组升级 remark 及其插件，避免跨代组合。
- [ ] 升级 ESLint 和共享配置。
- [ ] 清理 `tsconfig.json` 中未使用的 JS、装饰器配置。
- [ ] 评估启用完整的 `"strict": true`。

验收标准：

- `pnpm peers check` 通过。
- lint、类型检查、构建和测试全部通过且无弃用警告。

## P2：测试与项目元数据

### 9. 改进测试结构

当前测试依赖预先存在的 `dist`，主要通过两个大型快照检查行为。

待办：

- [ ] 将源码行为测试与发布包 smoke test 分开。
- [ ] 使用针对性断言覆盖每个启用的 remark 插件。
- [ ] 保留少量必要快照，减少大范围无关更新。
- [ ] 保证干净检出后执行标准测试命令即可完成所需构建。

### 10. 补充包元数据和文档

待办：

- [ ] 添加 `LICENSE` 文件。
- [ ] 在 `package.json` 中添加 `repository` 和 `bugs`。
- [ ] README 补充 `revertMdAstNode`、类型导出、模块兼容性和 Node.js 版本说明。
- [ ] 文档列出实际启用的 Markdown 扩展。

## 建议实施顺序

1. 固定 Node、pnpm 和锁文件，先让构建可复现。
2. 修复 CJS/ESM 发布契约并增加 tarball 测试。
3. 完善插件扩展节点类型和类型测试。
4. 固化 GFM workaround 的预期行为。
5. 清理依赖并分批升级工具链。
6. 清理文档警告、启用 API report、补充项目文档。
