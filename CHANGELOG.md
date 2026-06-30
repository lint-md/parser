# Changelog

## 0.0.14

- 使用 mdast 标准类型替代 `Parent & any`，提升类型安全性
- 添加 `exports` 字段，支持现代 Node.js 模块解析
- 优化 `files` 配置，移除 source map 和临时文件
- 将 `@types/unist` 移至 devDependencies
- 修复 webpack 构建配置，启用生产模式压缩
- 升级 TypeScript 4 → 5、@types/node 16 → 20
- 升级 CI 工具链：GitHub Actions v6、pnpm 11

## 0.0.13

- 修复 GFM AST 错误
