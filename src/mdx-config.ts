import remarkMdx from 'remark-mdx';
import { createParserProcessor, getProcessorExtensions } from './remark-config';

/** Add MDX syntax only when a caller loads the MDX entry. */
export const createMdxProcessor = (): ReturnType<typeof createParserProcessor> => {
  // The MDX 3 test dependency exposes unified 11 types. remark-mdx 2 uses unified 10 at runtime.
  return createParserProcessor().use(remarkMdx as any);
};

export const getMdxParserExtensions = () =>
  getProcessorExtensions(createMdxProcessor());
