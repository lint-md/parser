# Markdown performance after MDX support

This report compares `v0.4.0` (`f5dd4a4`) with `master` (`e4c0dee`).
Both builds use their locked dependencies and the same build command.
The measurements ran on Node.js 24.15.0 and an AMD Ryzen 7 8745HS.

## Method

`bench-parse.mjs` measures warm calls in separate child processes.
Each sample runs one warmup parse and one measured parse.
The report uses ten samples per shape and phase.
Two passes reverse the version order.

`bench-markdown-versions.mjs` measures a fresh process for each cold sample.
It records package load time, first parse time, heap use, RSS, and bundle bytes.
The report uses 15 samples per function and module format.
The script alternates version order between samples.
Each cold sample parses the same 16 KiB Markdown input.
All values below are medians.

## Cold start and package size

| Format and function | Load, old → new | First parse, old → new | Total, old → new |
| --- | ---: | ---: | ---: |
| CJS `parseMd()` | 7.73 → 15.23 ms | 60.72 → 62.99 ms | 68.21 → 78.22 ms |
| CJS `parseMdWithSourceMap()` | 7.69 → 14.85 ms | 63.29 → 71.61 ms | 70.85 → 87.05 ms |
| ESM `parseMd()` | 9.47 → 16.46 ms | 59.65 → 61.18 ms | 69.41 → 78.60 ms |
| ESM `parseMdWithSourceMap()` | 9.42 → 16.49 ms | 67.03 → 68.37 ms | 76.39 → 84.96 ms |

| Built bundle | `v0.4.0` | `master` | Increase |
| --- | ---: | ---: | ---: |
| CJS | 194,494 bytes | 484,137 bytes | 149% |
| ESM | 194,177 bytes | 483,787 bytes | 149% |

The CJS `parseMd()` sample used 0.95 MiB of heap to load the old package.
The new package used 1.97 MiB for the same step.
The ESM `parseMd()` load changed from 1.62 MiB to 2.19 MiB.
Cold RSS stayed near 82–85 MiB across these runs.

## Warm Markdown parsing

The existing benchmark used 64 KiB inputs and ten samples per row.
The table shows median wall time and peak RSS for each child process.

| Shape | Function | Time, old → new | Peak RSS, old → new |
| --- | --- | ---: | ---: |
| Mixed Markdown | `parseMd()` | 145.58 → 138.94 ms | 162.9 → 168.3 MiB |
| Mixed Markdown | `parseMdWithSourceMap()` | 157.44 → 157.24 ms | 164.0 → 171.0 MiB |
| Multiline Markdown | `parseMd()` | 89.59 → 86.89 ms | 124.6 → 128.0 MiB |
| Multiline Markdown | `parseMdWithSourceMap()` | 93.25 → 87.43 ms | 126.7 → 130.3 MiB |

Each version produced the same node count for each shape.
Mixed Markdown produced 9,377 nodes.
Multiline Markdown produced three nodes.

Warm parse time shows no clear regression in these samples.
Peak RSS rose by about 3–7 MiB in this process-isolated benchmark.
The cold load time and built bundle size increased clearly.
This version comparison does not isolate MDX from other changes between the commits.

This PR changes only the benchmark and report.
A separate change can test lazy MDX processor creation against the same measurements.
Lazy processor creation alone will not remove statically imported MDX code from the bundles.

## Reproduce

Build both checkouts with `pnpm install --frozen-lockfile` and `pnpm run build`.
Then run the commands below from the `master` checkout.
Replace the paths with the two checkout paths.

```sh
node scripts/bench-markdown-versions.mjs \
  --baseline /tmp/lint-md-parser-v0.4.0 \
  --current . \
  --runs 15 --bytes 16384
node scripts/bench-parse.mjs \
  --sizes 65536 --shapes mixed-markdown,multiline-hmd \
  --runs 5 --warmup 1 --json
node scripts/test-bench-markdown-versions.mjs
```

Run `bench-parse.mjs` in both checkouts twice.
Reverse checkout order for the second pass.
