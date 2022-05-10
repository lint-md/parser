# @lint-md/parser

lint-md 的解析器，基于 remark 生态，将 Markdown 字符串转换成 AST。

单独拆包封装一层的意义是当前 remark 的稳定版本只支持 ESModule，但是 lint-md 主模块依赖了很多 CommonJS 的库，故无法直接迁移到 ESModule。

故将使用 remark 的那部分代码抽离到单独模块然后用 webpack 打包成 CommonJS。


## 快速开始

```ts
import { parseMd } from '@lint-md/parser';

// 将 markdown 转换成 ast
const ast = parseMd('你的 Markdown 文本');
```

## License

MIT