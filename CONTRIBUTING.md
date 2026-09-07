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

### On-demand source-map validation

The regular Node 22 push and pull-request job runs the bounded source-map
benchmark smoke automatically. The full downstream compatibility check is
heavier, so it runs every Monday at 03:00 UTC and can be started before a
parser-sensitive dependency upgrade, a source-map implementation change, or a
release candidate from the Actions tab (or
`gh workflow run source-map-validation.yml --ref <branch>`).
Scheduled runs use the default branch; use the manual dispatch with an explicit
branch before merging a candidate.

The automatic smoke uses a 256 KiB alternating-atomic input, queries every
value code unit, and rejects the known linear-search regression. The scheduled
or manually triggered workflow runs the full `lint-md/lint-md` Jest suite after
installing the packed parser tarball, which verifies the package artifact and
downstream source-map integration together.

The workflow uses a read-only token and disables persisted checkout
credentials because it executes downstream repository code.

## Source-map heap profiling

The `profile:source-map` script captures V8 heap snapshots at specific
construction phases to verify that lazy indexes (`lineStarts`,
`sourceGapPrefix`) do not exist in retained heap until first use.

### Usage

```bash
# Capture a snapshot
pnpm run profile:source-map -- segments build
pnpm run profile:source-map -- segments raw
pnpm run profile:source-map -- segments range

# Open in Chrome DevTools → Memory → Load .heapsnapshot
```

**Fixtures:**

| Fixture | Shape | Purpose |
|---|---|---|
| `many-nodes` | 10k short paragraphs | high node count, low segment density |
| `segments` | 256 KiB `&amp;\(` repeats | maximum segment count per node |
| `fenced-code` | 1 MiB code block | single large code node with source-map segments |
| `urls` | 1000 link definitions | URL segment construction |

**Phases:**

| Phase | What runs | What should NOT exist in heap |
|---|---|---|
| `build` | `parseMdWithSourceMap()` only | `lineStarts`, `sourceGapPrefix` |
| `raw` | + `getRaw()` on every mapped node | `lineStarts`, `sourceGapPrefix` |
| `range` | + `getSourceRange()` on every mapped value node | (indexes now created on demand) |

### What to look for in DevTools

**Retained size dominators** — in the Dominators view, check:

- AST nodes (`type`, `position`, `children`, `value`)
- Source strings (the original Markdown input)
- Segment objects (`valueStart`, `valueEnd`, `sourceStart`, `sourceEnd`, `kind`)
- Segment arrays (one per mapped node)
- WeakMap state (sourceMap closure → WeakMap → values)
- Lazy indexes (`lineStarts` array, `sourceGapPrefix` arrays)

The build → raw → range progression should show `lineStarts` and
`sourceGapPrefix` (for multi-segment ranges) appearing only in the
`range` phase. If they appear
in `build` or `raw`, the lazy design is broken.

### Interpretation

The goal is a retained-heap breakdown:

```
retained heap
├── AST                 ??%
├── source strings      ??%
├── segment objects     ??%
├── segment arrays      ??%
├── WeakMap state       ??%
└── lazy indexes        ??%
```

If AST + source strings + parser strings dominate, source-map memory
optimization is not worthwhile. If segment objects/arrays are large,
consider a more compact segment representation.

**Rule: no heap dominator / retained-size evidence → no memory optimization PRs.**
