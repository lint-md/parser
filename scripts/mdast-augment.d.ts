declare module 'mdast' {
  interface BlockContentMap {
    math: import('@lint-md/parser').MarkdownMath;
    containerDirective: import('@lint-md/parser').MarkdownContainerDirective;
    leafDirective: import('@lint-md/parser').MarkdownLeafDirective;
  }

  interface StaticPhrasingContentMap {
    inlineMath: import('@lint-md/parser').MarkdownInlineMath;
    textDirective: import('@lint-md/parser').MarkdownTextDirective;
  }
}
