# @lint-md/parser 发版分析

## 当前状态
- 版本：0.0.14
- 测试：通过
- Lint：通过
- 构建：dist 目录存在

## 最近 PR #2 改动
- 升级 TypeScript 4 → 5、@types/node 16 → 20、ESLint 8.26 → 8.57
- 升级 CI 工具链：GitHub Actions v2/v3 → v6，pnpm 6 → 11
- 回滚 remark 生态保持 14.x、jest 保持 27

## API 接口状态
- `parseMd` / `revertMdAstNode` 正常工作
- `src/parse-md.ts:10` 的 monkey-patch（禁用 GFM autolink transforms）是必要的，因为 remark-gfm 3.x 仍有 CJK 误报问题

---

## 待迭代事项

### 1. 构建配置问题（高优先级）
**位置：** `webpack.config.ts:5`

```ts
const isDev = true;  // 硬编码为 true
```

**问题：** 发布包不会被压缩，当前 dist/lint-md-parser.js 约 1.1M。

**建议：** 改为从环境变量读取：
```ts
const isDev = process.env.NODE_ENV !== 'production';
```
或在 build 脚本中设置：
```json
"build:dist": "NODE_ENV=production webpack --config webpack.config.ts"
```

### 2. 类型定义问题（中优先级）
**位置：** `src/types.ts:3`

```ts
export type MarkdownNode = Parent & any;  // any 等于放弃类型安全
```

**建议：** 改用更精确的类型定义，参考 mdast 规范：
```ts
import type { Root, Content } from 'mdast';
export type MarkdownNode = Root | Content;
```

**位置：** `src/types.ts:6-16` — `MarkdownNodePosition` 定义了但从未使用，可考虑移除或集成到类型中。

### 3. 包配置优化（中优先级）
**位置：** `package.json`

| 问题 | 建议 |
|------|------|
| 缺少 `exports` 字段 | 添加 `exports` 支持现代 Node.js 模块解析 |
| `src` 包含在 `files` 中 | 移除，消费者不需要源码 |
| `@types/unist` 在 `dependencies` | 应为 `peerDependencies` 或 `devDependencies` |

**建议的 exports 配置：**
```json
{
  "exports": {
    ".": {
      "types": "./dist/lint-md-parser.d.ts",
      "default": "./dist/lint-md-parser.js"
    }
  }
}
```

### 4. 工程化缺失（低优先级）

| 缺失项 | 说明 |
|--------|------|
| CHANGELOG | 无版本变更记录 |
| 测试覆盖率 | 无覆盖率配置和门禁 |
| `prepublishOnly` | 无发版前自动构建脚本 |
| CI 发布流水线 | 仅 build.yml，无 npm publish 流程 |

**建议添加的 scripts：**
```json
{
  "prepublishOnly": "pnpm run build && pnpm run test",
  "test:coverage": "jest --coverage"
}
```

---

## 发版前检查清单
- [ ] 修复 webpack isDev 硬编码
- [ ] 重新构建压缩产物
- [ ] npm login
- [ ] npm publish
