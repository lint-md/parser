import { createMdxProcessor } from './mdx-config';
import type { PositionedMdxRoot } from './types';

const mdxProcessor = createMdxProcessor();

/** Parse MDX into positioned Markdown and MDX syntax nodes. @public */
export const parseMdx = (mdx: string): PositionedMdxRoot =>
  mdxProcessor.parse(mdx) as PositionedMdxRoot;
