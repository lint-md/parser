# MDX entry experiment

This experiment moves the synchronous MDX functions to `@lint-md/parser/mdx`.
The default entry keeps the Markdown functions.
Both entries include their own bundled parser code.

## Measurement

The baseline is commit `22b995f`.
The measurements use Node 24.15.0 and nine fresh processes per case.
Each process parses about 16 KiB of input.
The table shows median values.

| Case | Baseline | Split entry |
| --- | ---: | ---: |
| Default CJS bytes | 484,137 | 194,515 |
| Default CJS gzip bytes | 143,556 | 59,141 |
| Default CJS load time | 14.44 ms | 7.85 ms |
| Default CJS load heap | 2.06 MB | 1.00 MB |
| Default ESM bytes | 483,787 | 194,198 |
| Default ESM gzip bytes | 143,438 | 59,011 |
| Default ESM load time | 16.17 ms | 9.05 ms |
| Default ESM load heap | 2.30 MB | 1.24 MB |
| Cold MDX CJS load time | 14.61 ms | 14.21 ms |
| Cold MDX ESM load time | 15.14 ms | 15.81 ms |
| MDX CJS load after default | 0.08 ms | 12.42 ms |
| MDX CJS load heap after default | 0.01 MB | 1.93 MB |
| MDX ESM load after default | 0.09 ms | 12.69 ms |
| MDX ESM load heap after default | 0.01 MB | 1.88 MB |

The four bundled JavaScript files total 1,356,173 bytes after the split.
The two baseline files total 967,924 bytes.
This adds 388,249 bytes to the package's uncompressed JavaScript files.

Use this command to compare the default entries:

```bash
node scripts/bench-markdown-versions.mjs --baseline /path/to/baseline --current . --runs 9 --bytes 16384
```

Use this command to compare cold MDX loads:

```bash
node scripts/bench-markdown-versions.mjs --baseline /path/to/baseline --current . --mode mdx --runs 9 --bytes 16384
```

Add `--preload-default` to measure MDX loading after the default entry.
Build both checkouts before running the commands.

## Decision

The split cuts default bundle size and load work by about half.
It gives no clear cold MDX gain.
It adds a second entry, a second type bundle, and separate error class instances.
Callers must change MDX imports to `@lint-md/parser/mdx`.
The import change needs a major release or a migration plan.
The split also duplicates bundled code across the two entries.

Keep this PR as an experiment until consumers review the import change.
Adopt it only if default entry load cost matters more than the added package size and API change.
