import { getMdxParserExtensions } from '../mdx-config';
import { parseWithSourceMap } from './build-source-map';
import type { ParsedMdxDocument } from './types';

const mdxExtensions = getMdxParserExtensions();

/** Parse MDX and map Markdown values to source positions. @public */
export const parseMdxWithSourceMap = (mdx: string): ParsedMdxDocument =>
  parseWithSourceMap(mdx, mdxExtensions);
