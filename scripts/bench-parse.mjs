#!/usr/bin/env node
// Parse-phase benchmark for @lint-md/parser.
//
// The benchmark separates four phases on the same input:
//
//   A  = parseMd(md)                        (remark / unified wrapper)
//   B  = fromMarkdown + parser extensions   (bare compile, no recording)
//   B2 = B + recordingExtension             (source-map recording)
//   C  = parseMdWithSourceMap(md)           (recording + post-parse setup)
//
// Derived values:
//
//   A-B   remark / unified wrapper difference
//   B2-B  recordingExtension overhead
//   C-B2  post-parse source-map setup / indexing overhead
//   C-B   total source-map increment
//
// `indexNode` is likely most of C-B2, but this harness does not time it alone.
// C-B2 also covers RecordingState / WeakMap creation, the
// recordingExtension(state) call, parse-time snapshots, and the sourceMap
// object and its closures.
//
// `multiline-hmd` is a realistic soft-break workload.
// `soft-break-L` shapes are the synthetic density axis: one paragraph with
// `L` characters per line. A smaller `L` means more line endings per byte.
// Use them to separate line-ending count from byte count.
//
// Each measured sample runs in its own child process. The parent aggregates
// only. A single process builds a large multiline AST with heavy GC churn, so
// an in-process median flips between runs. The child isolates one phase and
// one parse per measured sample.
//
// The internal entry is bundled from `src/` with esbuild. `bench:source-map`
// uses the same pattern to keep benchmark-only exports out of the package.
//
// Run:
//   pnpm run bench:parse
//   node scripts/bench-parse.mjs --smoke
//   node scripts/bench-parse.mjs --sizes 262144 --shapes multiline-hmd,mixed-markdown
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

// One extension entry for every phase. `getParserExtensions` freezes the real
// processor data, so B / B2 / C use the same tokenizer and mdast extensions as
// `parseMd`.
const INTERNAL_ENTRY = `
export { parseMd } from './src/parse-md';
export { parseMdWithSourceMap } from './src/source-map/build-source-map';
export { getParserExtensions } from './src/remark-config';
export { recordingExtension } from './src/source-map/recording-extension';
export { fromMarkdown } from 'mdast-util-from-markdown';
`;

const PHASES = ['A', 'B', 'B2', 'C'];

// Shapes focus on parse cost. `multiline-hmd` maximizes soft-break tokens,
// `mixed-markdown` maximizes link / code post-processing, and the rest cover
// atomic escapes, entities, and block structure.
const SHAPES = [
  'single-line',
  'multiline-hmd',
  'entity-dense',
  'escape-dense',
  'mixed-markdown',
  'many-paragraphs',
  'large-code-block',
];

// Soft-break-density shapes separate line-ending count from byte count.
// `soft-break-L` builds one paragraph from `L` characters plus one line
// ending, so a smaller `L` means more line endings for the same bytes.
// These shapes stay out of the default run: they are slow at large sizes
// while micromark-util-subtokenize@1 shows O(n^2) behavior (issue #127).
// `soft-break-1` is the primary smoke growth check.
const SOFT_BREAK_SHAPES = [
  'soft-break-1',
  'soft-break-4',
  'soft-break-16',
  'soft-break-64',
];
const ALL_SHAPES = [...SHAPES, ...SOFT_BREAK_SHAPES];

const DEFAULT_SIZES = [256 * 1024];

// Smoke checks growth, not absolute wall time. CI machines move too much.
// Each check grows the input 4x. The budget tolerates the parser's current
// near-linear scaling and CI noise while still catching a severe regression.
// A tight budget is meaningful only after the subtokenize backport (#127).
const SMOKE_GROWTH_RATIO_MAX = 6;
// `soft-break-1` is the primary regression check: it maximizes line-ending
// count per byte, so it exposes the O(n^2) soft-break cost. `multiline-hmd`
// and `mixed-markdown` stay as realistic confirmation at smaller sizes.
const SMOKE_GROWTH_CHECKS = [
  { shape: 'multiline-hmd', sizes: [16 * 1024, 64 * 1024] },
  { shape: 'mixed-markdown', sizes: [16 * 1024, 64 * 1024] },
  { shape: 'soft-break-1', sizes: [64 * 1024, 256 * 1024] },
];

// ---------------------------------------------------------------------------
// Child mode and parity mode
// ---------------------------------------------------------------------------

function makeState() {
  return {
    segments: new WeakMap(),
    inlineCodeSegments: new WeakMap(),
    codeSegments: new WeakMap(),
    emptyCodeOffsets: new WeakMap(),
    urlSegments: new WeakMap(),
    emptyUrlOffsets: new WeakMap(),
    urlSourceSpans: new WeakMap(),
  };
}

function repeatToSize(base, targetBytes) {
  return base.repeat(Math.ceil(targetBytes / Buffer.byteLength(base))).slice(0, targetBytes);
}

function generateInput(shape, bytes) {
  const generators = {
    'single-line': () => repeatToSize(
      '这是用于性能测试的长段落文本，包含中英文混合内容 test content and numbers 1234567890。',
      bytes,
    ),
    'multiline-hmd': () => repeatToSize('中文a中文1\n', bytes),
    'entity-dense': () => repeatToSize('中文&amp;文本', bytes),
    'escape-dense': () => repeatToSize('中文\\(文本\\)中文', bytes),
    'mixed-markdown': () => repeatToSize(
      '# 一级标题\n\n这是**粗体**和*斜体*混合的段落文字。\n\n- 列表项 [链接](https://example.com)\n\n',
      bytes,
    ),
    'many-paragraphs': () => repeatToSize('## 标题\n\n这是段落的正文内容，包含中文和 English words。\n\n', bytes),
    'large-code-block': () => {
      const body = repeatToSize(`${'x'.repeat(79)}\n`, Math.max(0, bytes - 8));
      return `\`\`\`text\n${body}\n\`\`\``;
    },
  };
  const softBreak = /^soft-break-(\d+)$/.exec(shape);
  if (softBreak) {
    return repeatToSize(`${'a'.repeat(Number(softBreak[1]))}\n`, bytes);
  }
  const generator = generators[shape];
  if (!generator)
    throw new Error(`Unknown shape: ${shape}`);
  return generator();
}

// A cheap structural fingerprint. It detects an empty or truncated parse and
// lets the parent confirm that all phases built the same tree.
function checksum(node) {
  let nodes = 0;
  let valueChars = 0;
  let offsetSum = 0;
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (typeof current.value === 'string')
      valueChars += current.value.length;
    if (current.position) {
      offsetSum += current.position.start.offset + current.position.end.offset;
    }
    for (const child of current.children || [])
      stack.push(child);
  }
  return { nodes, valueChars, offsetSum };
}

function phaseRunner(bundle, phase) {
  const { parseMd, parseMdWithSourceMap, getParserExtensions, recordingExtension, fromMarkdown } = bundle;
  const { micromarkExtensions, fromMarkdownExtensions } = getParserExtensions();
  switch (phase) {
    case 'A':
      return (md) => parseMd(md);
    case 'B':
      return (md) => fromMarkdown(md, {
        extensions: micromarkExtensions,
        mdastExtensions: fromMarkdownExtensions,
      });
    case 'B2':
      return (md) => fromMarkdown(md, {
        extensions: micromarkExtensions,
        mdastExtensions: [...fromMarkdownExtensions, recordingExtension(makeState())],
      });
    case 'C':
      return (md) => parseMdWithSourceMap(md).ast;
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

async function runChild() {
  const bundle = await import(pathToFileURL(process.env.BENCH_PARSE_BUNDLE).href);
  const shape = process.env.BENCH_PARSE_SHAPE;
  const bytes = Number(process.env.BENCH_PARSE_BYTES);
  const phase = process.env.BENCH_PARSE_PHASE;
  const warmup = Number(process.env.BENCH_PARSE_WARMUP || '0');
  const input = generateInput(shape, bytes);
  const run = phaseRunner(bundle, phase);

  for (let index = 0; index < warmup; index += 1)
    run(input);
  if (typeof global.gc === 'function')
    global.gc();

  const start = performance.now();
  const ast = run(input);
  const wallTimeMs = performance.now() - start;

  process.stdout.write(`${JSON.stringify({
    kind: 'child',
    shape,
    bytes,
    phase,
    wallTimeMs,
    checksum: checksum(ast),
    maxRss: process.resourceUsage().maxRSS * 1024,
    nodeVersion: process.version,
  })}\n`);
}

// A small fixture set. Every phase must build the same tree, including the
// bare `fromMarkdown` baseline and the recording variants.
const PARITY_FIXTURES = [
  '中文a中文1\n中文b中文2',
  '# H\n\n> 引用(test)\n\n- 项a中文\n\n```js\nconst x = 1\n```\n\n[中文](https://example.com/a b) 和 ` code `',
  '中文&amp;文本 \\(x\\) 中文',
  '| a | b |\n|--|--|\n| 1 | 2 |\n\ntext',
  'a\r\nb\rc',
  '中文&#40;test&#41;中文 与 &Afr;',
];

function reduceTree(node) {
  const out = { type: node.type };
  if (typeof node.value === 'string')
    out.value = node.value;
  if (typeof node.url === 'string')
    out.url = node.url;
  if (node.position)
    out.position = [node.position.start.offset, node.position.end.offset];
  if (node.children)
    out.children = node.children.map(reduceTree);
  return out;
}

async function runParity() {
  const bundle = await import(pathToFileURL(process.env.BENCH_PARSE_BUNDLE).href);
  const { parseMd, parseMdWithSourceMap, getParserExtensions, recordingExtension, fromMarkdown } = bundle;
  const { micromarkExtensions, fromMarkdownExtensions } = getParserExtensions();
  const canon = (ast) => JSON.stringify(reduceTree(ast));
  const results = PARITY_FIXTURES.map((md) => {
    const a = canon(parseMd(md));
    const b = canon(fromMarkdown(md, {
      extensions: micromarkExtensions,
      mdastExtensions: fromMarkdownExtensions,
    }));
    const b2 = canon(fromMarkdown(md, {
      extensions: micromarkExtensions,
      mdastExtensions: [...fromMarkdownExtensions, recordingExtension(makeState())],
    }));
    const c = canon(parseMdWithSourceMap(md).ast);
    return { bytes: Buffer.byteLength(md), aEqC: a === c, bEqC: b === c, b2EqC: b2 === c };
  });
  const ok = results.every((item) => item.aEqC && item.bEqC && item.b2EqC);
  process.stdout.write(`${JSON.stringify({ kind: 'parity', ok, results })}\n`);
}

// ---------------------------------------------------------------------------
// Parent mode
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage: node scripts/bench-parse.mjs [options]

Options:
  --sizes <list>    Comma-separated input sizes in bytes (default: ${DEFAULT_SIZES.join(',')})
  --bytes <n>       Shorthand for one size
  --shapes <list>   Comma-separated shapes (default: all except soft-break)
                    Shapes: ${SHAPES.join(' | ')}
                    Soft-break density: ${SOFT_BREAK_SHAPES.join(' | ')}
                    A soft-break-L shape is one paragraph with L characters per
                    line. A smaller L means more line endings per byte.
                    These shapes are not in the default set and are slow at
                    large sizes (see issue #127).
  --runs <n>        Measured samples per phase (default: 3)
  --warmup <n>      Warmup parses per sample (default: 1)
  --smoke           Fast CI check: growth ratio, AST parity, soft-break density
  --json            Print one JSON sample per line instead of the table
  -h, --help        Show this help

Phases:
  A parseMd | B fromMarkdown | B2 +recording | C parseMdWithSourceMap
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    sizes: null,
    shapes: null,
    runs: 3,
    warmup: 1,
    smoke: false,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      case '--sizes':
        options.sizes = args[++index].split(',').map((value) => Number(value.trim()));
        break;
      case '--bytes':
        options.sizes = [Number(args[++index])];
        break;
      case '--shapes':
        options.shapes = args[++index].split(',').map((value) => value.trim());
        break;
      case '--runs':
        options.runs = Number(args[++index]);
        break;
      case '--warmup':
        options.warmup = Number(args[++index]);
        break;
      case '--smoke':
        options.smoke = true;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown flag: ${args[index]}`);
    }
  }
  if (options.smoke) {
    options.sizes ??= [...new Set(SMOKE_GROWTH_CHECKS.flatMap((check) => check.sizes))];
    options.shapes ??= [...new Set(SMOKE_GROWTH_CHECKS.map((check) => check.shape))];
    options.runs = 1;
    options.warmup = 1;
  }
  options.sizes ??= DEFAULT_SIZES;
  options.shapes ??= SHAPES;
  if (options.sizes.some((size) => !Number.isSafeInteger(size) || size < 1))
    throw new Error('Sizes must be positive integers.');
  for (const shape of options.shapes) {
    if (!ALL_SHAPES.includes(shape))
      throw new Error(`Unknown shape: ${shape}`);
  }
  return options;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Bundle the internal entry once. Children import the temp file, so esbuild
// runs one time for the whole benchmark. `cleanupDir` is set only for a
// directory this script created, so a caller-supplied BENCH_PARSE_BUNDLE is
// never removed.
async function buildBundle() {
  if (process.env.BENCH_PARSE_BUNDLE)
    return { bundlePath: process.env.BENCH_PARSE_BUNDLE, cleanupDir: null };
  const { outputFiles } = await build({
    stdin: { contents: INTERNAL_ENTRY, resolveDir: REPO_ROOT, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-md-parser-bench-'));
  const bundlePath = path.join(dir, 'entry.mjs');
  fs.writeFileSync(bundlePath, outputFiles[0].text);
  return { bundlePath, cleanupDir: dir };
}

function runSample({ bundlePath, shape, bytes, phase, warmup }) {
  const child = spawnSync(process.execPath, ['--expose-gc', SCRIPT_PATH], {
    env: {
      ...process.env,
      BENCH_PARSE_CHILD: '1',
      BENCH_PARSE_BUNDLE: bundlePath,
      BENCH_PARSE_SHAPE: shape,
      BENCH_PARSE_BYTES: String(bytes),
      BENCH_PARSE_PHASE: phase,
      BENCH_PARSE_WARMUP: String(warmup),
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    throw new Error(`Child failed (${shape} ${bytes} ${phase}):\n${child.stderr}`);
  }
  const line = child.stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

function runParityCheck(bundlePath) {
  const child = spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, BENCH_PARSE_PARITY: '1', BENCH_PARSE_BUNDLE: bundlePath },
    encoding: 'utf8',
  });
  if (child.status !== 0)
    throw new Error(`Parity child failed:\n${child.stderr}`);
  return JSON.parse(child.stdout.trim().split('\n').filter(Boolean).pop());
}

function formatMs(value) {
  return `${value.toFixed(0)} ms`.padStart(9);
}

function printTable(rows, runs) {
  const header = [
    'shape'.padEnd(16),
    'bytes'.padStart(8),
    'A parseMd'.padStart(10),
    'B base'.padStart(10),
    'B2 +rec'.padStart(10),
    'C wMap'.padStart(10),
    '| A-B'.padStart(8),
    'B2-B'.padStart(8),
    'C-B2'.padStart(8),
    'C-B'.padStart(8),
  ].join(' ');
  console.log(`# parse-phase benchmark (median of ${runs}, child-process isolated, ${process.version})`);
  console.log('# derived: A-B unified wrapper | B2-B recording | C-B2 post-parse setup / indexing | C-B total source-map');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    console.log([
      row.shape.padEnd(16),
      String(row.bytes).padStart(8),
      formatMs(row.phases.A),
      formatMs(row.phases.B),
      formatMs(row.phases.B2),
      formatMs(row.phases.C),
      formatMs(row.phases.A - row.phases.B),
      formatMs(row.phases.B2 - row.phases.B),
      formatMs(row.phases.C - row.phases.B2),
      formatMs(row.phases.C - row.phases.B),
    ].join(' '));
  }
}

// Sample pairs to measure. Smoke uses only the pairs named by the growth
// checks, so a dense shape can use larger sizes without pushing the other
// shapes up too.
function samplePairs(options) {
  if (options.smoke) {
    const pairs = [];
    const seen = new Set();
    for (const check of SMOKE_GROWTH_CHECKS) {
      for (const bytes of check.sizes) {
        const key = `${check.shape}|${bytes}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ shape: check.shape, bytes });
        }
      }
    }
    return pairs;
  }
  const pairs = [];
  for (const shape of options.shapes) {
    for (const bytes of options.sizes)
      pairs.push({ shape, bytes });
  }
  return pairs;
}

async function main() {
  const options = parseArgs();
  const { bundlePath, cleanupDir } = await buildBundle();
  try {
    const pairs = samplePairs(options);
    const samples = [];
    for (const { shape, bytes } of pairs) {
      for (const phase of PHASES) {
        for (let run = 0; run < options.runs; run += 1) {
          samples.push(runSample({ bundlePath, shape, bytes, phase, warmup: options.warmup }));
        }
      }
    }

    if (options.json) {
      for (const sample of samples)
        process.stdout.write(`${JSON.stringify(sample)}\n`);
      if (options.smoke)
        runSmokeChecks(samples, undefined, bundlePath);
      return;
    }

    const rows = [];
    for (const { shape, bytes } of pairs) {
      const phases = {};
      let checksumsEqual = true;
      let baseline = null;
      for (const phase of PHASES) {
        const phaseSamples = samples.filter(
          (sample) => sample.shape === shape && sample.bytes === bytes && sample.phase === phase,
        );
        phases[phase] = median(phaseSamples.map((sample) => sample.wallTimeMs));
        const checksum = JSON.stringify(phaseSamples[0].checksum);
        if (baseline === null)
          baseline = checksum;
        else if (baseline !== checksum)
          checksumsEqual = false;
      }
      rows.push({ shape, bytes, phases, checksumsEqual });
    }

    printTable(rows, options.runs);

    const mismatched = rows.filter((row) => !row.checksumsEqual);
    if (mismatched.length > 0) {
      console.warn(`\nWarning: phase checksums differ for ${mismatched.length} group(s).`);
    }

    if (options.smoke)
      runSmokeChecks(samples, rows, bundlePath);
  }
  finally {
    if (cleanupDir)
      fs.rmSync(cleanupDir, { recursive: true, force: true });
  }
}

function runSmokeChecks(samples, rows, bundlePath) {
  for (const sample of samples) {
    if (!Number.isFinite(sample.wallTimeMs) || sample.wallTimeMs < 0)
      throw new Error(`Non-finite wall time for ${sample.shape} ${sample.phase}`);
  }

  const parity = runParityCheck(bundlePath ?? process.env.BENCH_PARSE_BUNDLE);
  if (!parity.ok)
    throw new Error(`AST parity failed: ${JSON.stringify(parity.results)}`);
  console.log('\nSmoke: AST parity holds for all fixtures.');

  if (rows) {
    for (const row of rows) {
      if (!row.checksumsEqual)
        throw new Error(`Smoke failed: phase checksums differ for ${row.shape} ${row.bytes}.`);
    }
  }

  for (const check of SMOKE_GROWTH_CHECKS) {
    const [smallest, largest] = check.sizes;
    const growth = largest / smallest;
    for (const phase of ['B', 'C']) {
      const small = median(samples
        .filter((sample) => sample.shape === check.shape && sample.bytes === smallest && sample.phase === phase)
        .map((sample) => sample.wallTimeMs));
      const large = median(samples
        .filter((sample) => sample.shape === check.shape && sample.bytes === largest && sample.phase === phase)
        .map((sample) => sample.wallTimeMs));
      const ratio = large / small;
      console.log(`Smoke: ${check.shape} ${phase} growth ${smallest} → ${largest} bytes = ${ratio.toFixed(2)}x (input ${growth}x)`);
      if (ratio > SMOKE_GROWTH_RATIO_MAX) {
        throw new Error(
          `Smoke failed: ${check.shape} ${phase} grew ${ratio.toFixed(2)}x on a ${growth}x input `
          + `(budget ${SMOKE_GROWTH_RATIO_MAX}x).`,
        );
      }
    }
  }
}

if (process.env.BENCH_PARSE_CHILD === '1')
  await runChild();
else if (process.env.BENCH_PARSE_PARITY === '1')
  await runParity();
else
  await main();
