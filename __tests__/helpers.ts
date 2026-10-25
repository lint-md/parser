const parser = require('../dist/lint-md-parser.cjs');
const mdxParser = require('../dist/lint-md-parser-mdx.cjs');
export const {
  parseMd,
  revertMdAstNode,
  stringifyMdAst,
  parseMdWithSourceMap,
  SourceMapError,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
} = parser;
export const {
  parseMdx,
  parseMdxWithSourceMap,
  SourceMapUnavailableError: MdxSourceMapUnavailableError,
} = mdxParser;
