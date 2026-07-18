export { parseMd, revertMdAstNode, revertMdAstNode as stringifyMdAst } from './parse-md';
export { parseMdWithSourceMap } from './source-map/build-source-map';
export {
  SourceMapError,
  SourceMapConsistencyError,
  SourceMapUnavailableError,
  type SourceMapErrorCode,
} from './source-map/errors';

export * from './types';
export type {
  MarkdownSourceMap,
  ParsedMarkdownDocument,
} from './source-map/types';
