# Contributing

## Parser-sensitive dependency upgrades

The source-map feature (`parseMdWithSourceMap`, `src/source-map/build-source-map.ts`)
does **not** rely only on the public remark API. Its `recordingExtension`
injects handlers into the `mdast-util-from-markdown` compile phase and reads
undocumented internal compile context (see the comment block above
`recordingExtension`). Because of this, some dependency upgrades are **parser
behavior upgrades**, not routine bumps — an upstream change can silently rename a
token handler, reshape the compile context, or drift entity-decoding semantics,
and the type system will not catch it.

### Parser-sensitive dependencies

Treat a version change to any of these as a parser behavior upgrade:

- `mdast-util-from-markdown`
- `mdast-util-gfm-autolink-literal`
- `decode-named-character-reference`
- `micromark-util-decode-numeric-character-reference`
- `remark`
- `remark-parse`
- `remark-gfm`
- `remark-frontmatter`
- `remark-directive`
- `remark-math`
- `micromark` and any transitive `micromark-*` package pulled in by the above

Note that several of these are pinned to exact versions on purpose (e.g.
`mdast-util-from-markdown`, `decode-named-character-reference`,
`micromark-util-decode-numeric-character-reference`) so their internal contracts
stay locked. Do not relax those pins without going through this checklist.

### Upgrade checklist

Before merging any change that touches the versions above:

- [ ] `pnpm test` — full Jest suite, including:
  - AST parity (`parseMd` deep-equals `parseMdWithSourceMap().ast`)
  - position parity (`__tests__/position.spec.ts`)
  - source-map suites (`__tests__/source-map.spec.ts`, `__tests__/source-map/*`)
  - roundtrip (`__tests__/roundtrip.spec.ts`)
  - CJS/ESM behavior (`__tests__/index.spec.ts`, `__tests__/parser-isolation-bundle.spec.ts`)
- [ ] `pnpm run test:types` — type declarations still compile against the public API
- [ ] `pnpm run test:package` — `publint` + packed CJS/ESM tarball smoke test
- [ ] `pnpm run bench:source-map` — no unexpected build/query performance regression
- [ ] Manually review whether the handlers overridden in `recordingExtension`
      (`data`, `characterEscape(Value)`, `characterReference(Value)`,
      `lineEnding`, `autolinkProtocol`, `autolinkEmail`) or the compile-context
      fields it reads (`stack`, `config.canContainEols`, `getData`/`setData`
      keys, `sliceSerialize`) changed upstream.
- [ ] Run the downstream `@lint-md/core` compatibility test suite against the
      upgraded parser.

If any parity or source-map assertion changes, that is a behavior change and
must be documented in `CHANGELOG.md` — do not silently accept new snapshots.
