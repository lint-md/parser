// Benchmark source-map query performance (issue #51) and URL-field mapping
// construction (issue #74).
//
// The pathological shape is a single text node made of many alternating,
// non-mergeable atomic segments (`&amp;` character reference + `\(` escape),
// which maximizes segment count per node. We measure both source-map
// construction and several query patterns at growing input sizes so a
// regression in findSegmentAt() (e.g. reverting to a linear scan) shows up as
// super-linear query time.
//
// Run: pnpm run bench:source-map
// Smoke (CI): node scripts/bench-source-map.mjs --smoke
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseMdWithSourceMap } = require('../dist/lint-md-parser.cjs');

const UNIT = '&amp;\\('; // one character reference + one escape => 2 segments
const SMOKE = process.argv.includes('--smoke');
// On the 256 KiB alternating-atomic input, the binary-search lookup finishes
// in milliseconds while the pre-#55 linear lookup took several seconds.
const SIZES_KIB = SMOKE ? [256] : [1, 16, 64, 256];
const SMOKE_QUERY_BUDGET_MS = 1000;
const URL_BUILD_SIZES_KIB = [16, 32, 64, 128, 256];
// A 4× URL grows close to 4× on the bounded scan. The old unbounded `&`
// search grows beyond 5.5× from 64 KiB to 256 KiB; leave headroom for CI
// scheduling noise while measuring where the quadratic term is dominant.
const SMOKE_URL_BUILD_RATIO_MAX = 5.5;

/** Build an input of roughly `kib` kibibytes made of repeated UNIT. */
function makeInput(kib) {
  const targetBytes = kib * 1024;
  const count = Math.max(1, Math.round(targetBytes / UNIT.length));
  return UNIT.repeat(count);
}

/** Build a link destination with no valid character references. */
function makeUrlInput(kib) {
  return '[x](' + '&'.repeat(kib * 1024) + ')';
}

/** The first (and only) text node of the parsed document. */
function firstTextNode(root) {
  let found;
  (function walk(n) {
    if (!found && n.type === 'text')
      found = n;
    for (const c of n.children || []) walk(c);
  })(root);
  return found;
}

function time(label, fn) {
  // Warm up to trigger JIT, then measure.
  fn();
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  return { label, ms };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function timeMedian(label, fn) {
  // Warm up once, then use a short median to keep the growth check resilient
  // to an individual noisy CI sample.
  fn();
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return { label, ms: median(samples) };
}

function fmt(ms) {
  return `${ms.toFixed(2)} ms`;
}

for (const kib of SIZES_KIB) {
  const md = makeInput(kib);
  console.log(`\n=== ${kib} KiB input (${md.length} chars) ===`);

  const build = time('build source map only', () => {
    parseMdWithSourceMap(md);
  });
  console.log(`  ${build.label.padEnd(28)} ${fmt(build.ms)}`);

  const { ast, sourceMap } = parseMdWithSourceMap(md);
  const node = firstTextNode(ast);
  const len = node.value.length;

  const patterns = [
    [
      'query every code unit',
      () => {
        for (let i = 0; i < len; i++) sourceMap.getSourceRange(node, i, i + 1);
      },
    ],
    [
      'query a few hits',
      () => {
        const step = Math.max(1, Math.floor(len / 8));
        for (let i = 0; i + 1 <= len; i += step) {
          sourceMap.getSourceRange(node, i, i + 1);
        }
      },
    ],
    [
      'query full value range',
      () => {
        for (let r = 0; r < 1000; r++) sourceMap.getSourceRange(node, 0, len);
      },
    ],
    [
      'random queries',
      () => {
        let seed = 12345;
        const rand = () => {
          seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
          return seed / 0x7FFFFFFF;
        };
        for (let r = 0; r < len; r++) {
          const i = Math.floor(rand() * len);
          sourceMap.getSourceRange(node, i, i + 1);
        }
      },
    ],
    [
      'sequential span queries',
      () => {
        for (let i = 0; i + 8 <= len; i += 8) {
          sourceMap.getSourceRange(node, i, i + 8);
        }
      },
    ],
  ];

  const selectedPatterns = SMOKE ? [patterns[0]] : patterns;

  for (const [label, fn] of selectedPatterns) {
    const r = time(label, fn);
    console.log(`  ${r.label.padEnd(28)} ${fmt(r.ms)}`);

    if (SMOKE && r.ms > SMOKE_QUERY_BUDGET_MS) {
      throw new Error(
        `benchmark smoke failed: ${r.label} took ${fmt(r.ms)} `
        + `(budget ${SMOKE_QUERY_BUDGET_MS} ms)`,
      );
    }
  }
}

console.log('\n=== URL field construction ===');
const urlBuildResults = [];
for (const kib of URL_BUILD_SIZES_KIB) {
  const md = makeUrlInput(kib);
  const result = timeMedian(`${kib} KiB non-entity URL`, () => {
    parseMdWithSourceMap(md);
  });
  urlBuildResults.push(result);
  console.log(`  ${result.label.padEnd(28)} ${fmt(result.ms)}`);
}

if (SMOKE) {
  const smaller = urlBuildResults[2]; // 64 KiB
  const larger = urlBuildResults[4]; // 256 KiB
  const ratio = larger.ms / smaller.ms;
  console.log(`  ${'64 → 256 KiB growth'.padEnd(28)} ${ratio.toFixed(2)}x`);
  if (ratio > SMOKE_URL_BUILD_RATIO_MAX) {
    throw new Error(
      `benchmark smoke failed: URL construction grew ${ratio.toFixed(2)}x `
      + `from 64 KiB to 256 KiB (budget ${SMOKE_URL_BUILD_RATIO_MAX}x)`,
    );
  }
}
