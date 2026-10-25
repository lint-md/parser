const parser = require('../dist/lint-md-parser.cjs');
export const {
  parseMd,
  parseMdx,
  revertMdAstNode,
  stringifyMdAst,
  parseMdWithSourceMap,
  parseMdxWithSourceMap,
  SourceMapError,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
} = parser;
