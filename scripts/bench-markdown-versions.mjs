#!/usr/bin/env node
// Compare cold Markdown calls from two built parser packages.
// Run bench-parse.mjs in each checkout for warm parse and source-map costs.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT = fileURLToPath(import.meta.url);
const FIXTURE = '# 标题\n\n这是**粗体**和*斜体*混合的段落文字。\n\n- 列表项 [链接](https://example.com)\n\n';
const FORMATS = [
  { name: 'cjs', file: 'lint-md-parser.cjs' },
  { name: 'esm', file: 'lint-md-parser.mjs' },
];
const FUNCTIONS = ['parseMd', 'parseMdWithSourceMap'];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { runs: 7, bytes: 16 * 1024 };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help') {
      console.log('Usage: node scripts/bench-markdown-versions.mjs --baseline <root> --current <root> [--runs <n>] [--bytes <n>]');
      process.exit(0);
    }
    if (!['--baseline', '--current', '--runs', '--bytes'].includes(flag))
      throw new Error(`Unknown option: ${flag}`);
    options[flag.slice(2)] = args[++index];
  }
  options.runs = Number(options.runs);
  options.bytes = Number(options.bytes);
  if (!options.baseline || !options.current)
    throw new Error('Both --baseline and --current are required.');
  if (!Number.isSafeInteger(options.runs) || options.runs < 1)
    throw new Error('--runs must be a positive integer.');
  if (!Number.isSafeInteger(options.bytes) || options.bytes < 1)
    throw new Error('--bytes must be a positive integer.');
  return options;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function runChild() {
  const { BENCH_FILE, BENCH_FORMAT, BENCH_FUNCTION, BENCH_BYTES } = process.env;
  const targetBytes = Number(BENCH_BYTES);
  const fixtureBytes = Buffer.byteLength(FIXTURE);
  const input = FIXTURE.repeat(Math.floor(targetBytes / fixtureBytes))
    + 'a'.repeat(targetBytes % fixtureBytes);
  global.gc?.();
  const before = process.memoryUsage();
  const start = performance.now();
  const parser = BENCH_FORMAT === 'cjs'
    ? createRequire(import.meta.url)(BENCH_FILE)
    : await import(pathToFileURL(BENCH_FILE).href);
  const loadedAt = performance.now();
  const afterLoad = process.memoryUsage();
  const result = parser[BENCH_FUNCTION](input);
  const parsedAt = performance.now();
  const afterParse = process.memoryUsage();
  const ast = result.ast ?? result;
  if (ast.type !== 'root' || !ast.children?.length)
    throw new Error('The parser returned an empty tree.');
  process.stdout.write(`${JSON.stringify({
    loadMs: loadedAt - start,
    firstParseMs: parsedAt - loadedAt,
    coldTotalMs: parsedAt - start,
    loadHeapBytes: afterLoad.heapUsed - before.heapUsed,
    parseHeapBytes: afterParse.heapUsed - afterLoad.heapUsed,
    rssBytes: afterParse.rss,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
  })}\n`);
}

function runSample(root, format, functionName, bytes) {
  const file = path.resolve(root, 'dist', format.file);
  if (!fs.existsSync(file))
    throw new Error(`Build the package first: ${file}`);
  const child = spawnSync(process.execPath, ['--expose-gc', SCRIPT], {
    env: {
      ...process.env,
      BENCH_MARKDOWN_CHILD: '1',
      BENCH_FILE: file,
      BENCH_FORMAT: format.name,
      BENCH_FUNCTION: functionName,
      BENCH_BYTES: String(bytes),
    },
    encoding: 'utf8',
  });
  if (child.status !== 0)
    throw new Error(`Sample failed for ${file}: ${child.stderr}`);
  return JSON.parse(child.stdout.trim());
}

function printResults(options) {
  const samples = { baseline: {}, current: {} };
  for (const format of FORMATS) {
    for (const functionName of FUNCTIONS) {
      const key = `${format.name}/${functionName}`;
      samples.baseline[key] = [];
      samples.current[key] = [];
      for (let index = 0; index < options.runs; index += 1) {
        const order = index % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
        for (const version of order)
          samples[version][key].push(runSample(options[version], format, functionName, options.bytes));
      }
    }
  }
  const summary = {};
  for (const version of ['baseline', 'current']) {
    summary[version] = {};
    for (const format of FORMATS) {
      const file = path.resolve(options[version], 'dist', format.file);
      summary[version][`${format.name}Bytes`] = fs.statSync(file).size;
    }
    for (const [key, rows] of Object.entries(samples[version])) {
      summary[version][key] = {};
      for (const field of Object.keys(rows[0]))
        summary[version][key][field] = median(rows.map((row) => row[field]));
    }
  }
  console.log(JSON.stringify({
    node: process.version,
    bytes: options.bytes,
    runs: options.runs,
    summary,
  }, null, 2));
}

if (process.env.BENCH_MARKDOWN_CHILD === '1')
  await runChild();
else
  printResults(parseArgs());
