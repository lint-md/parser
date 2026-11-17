# CommonMark specification tests

`unit/commonmark-spec.spec.ts` runs the 652 examples from `commonmark-spec@0.31.2`.
The package contains the official `spec.txt` data. Tests use the local package and make no network requests.
The spec uses `→` for tabs. The test converts each marker to a tab before parsing.

The test parses Markdown with `parseMd` and converts its AST to HTML.
It compares that HTML with the specification's expected HTML.
The comparison parses both HTML strings as fragments.
It ignores entity spelling, void tag spelling, one final newline, and space between block elements.
It keeps text inside paragraphs and code blocks unchanged.

The test checks 644 examples against the official result.
Eight examples have recorded differences. Each case must match its current result and differ from the official result.
Two cases use `---` as frontmatter. Four cases use GFM autolinks.
One case creates a directive. One case parses Unicode emphasis differently.
See `knownDifferences` in the test for their example numbers.
[Issue #159](https://github.com/lint-md/parser/issues/159) tracks the Unicode emphasis case.

The `commonmark-spec` package uses the [CC BY-SA 4.0 license](https://github.com/commonmark/commonmark-spec/blob/0.31.2/LICENSE).
This repository does not copy the specification data into its source tree.
The HTML tools are test dependencies. They do not change the parser package.

Run `pnpm run test:source` to run these examples with the source parser.
Run `pnpm test` to run all tests and package checks.
