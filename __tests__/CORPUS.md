# Parser corpus

This directory holds fixed Markdown and MDX test files.
The test reads each file from disk. It does not fetch files during a test run.

`corpus-manifest.json` lists every file. Each entry records its source, license, tags, and expected node types.
The `kind` field separates syntax samples from real project documents.
The syntax samples are original MIT test documents. Their source links identify the syntax reference.
The real documents are copies from the pinned `lint-md/parser` commit in the manifest.

Run `pnpm run build` before the corpus test. Then run `pnpm exec jest __tests__/corpus.spec.ts --runInBand`.
`pnpm test` also runs this test.

The test checks AST parity, node positions, raw source, value ranges, and URL ranges.
It checks fixed examples of entity, escape, emoji, CRLF, and MDX repair offsets.
The expected node types guard against a parser that returns a plausible but wrong tree.
This test does not compare rendered HTML with the CommonMark or GFM specification.

Add each new `.md` or `.mdx` file to the manifest. Keep the manifest paths sorted.
Use a pinned source URL for copied documents. Check the license before you copy a file.
Add expected node types that describe the feature under test.

One input still needs parser work. A GFM table cell with `` `a\|b` `` gives different
`inlineCode.value` results from `parseMd` and `parseMdWithSourceMap`.
The corpus uses an escaped pipe outside the code span until the two parsers agree.
