// Benchmark for the source-map query path (issue #51).
//
// The pathological shape is a single text node made of many alternating,
// non-mergeable atomic segments (`&amp;` character reference + `\(` escape),
// which maximizes segment count per node. We measure both source-map
// construction and several query patterns at growing input sizes so a
// regression in findSegmentAt() (e.g. reverting to a linear scan) shows up as
// super-linear query time.
//
// Run: pnpm run bench:source-map
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseMdWithSourceMap } = require('../dist/lint-md-parser.cjs');

const UNIT = '&amp;\\('; // one character reference + one escape => 2 segments
const SIZES_KIB = [1, 16, 64, 256];

/** Build an input of roughly `kib` kibibytes made of repeated UNIT. */
function makeInput(kib) {
  const targetBytes = kib * 1024;
  const count = Math.max(1, Math.round(targetBytes / UNIT.length));
  return UNIT.repeat(count);
}

/** The first (and only) text node of the parsed document. */
function firstTextNode(root) {
  let found;
  (function walk(n) {
    if (!found && n.type === 'text') found = n;
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
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x7fffffff;
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

  for (const [label, fn] of patterns) {
    const r = time(label, fn);
    console.log(`  ${r.label.padEnd(28)} ${fmt(r.ms)}`);
  }
}
