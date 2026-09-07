// Heap-profile source-map retained structures.
//
// Run:  pnpm run profile:source-map -- <fixture> <phase>
// e.g. pnpm run profile:source-map -- segments build
//
// Fixtures:
//   many-nodes   – 10k small text nodes (flat list)
//   segments     – 256 KiB high segment-density (&amp;\( repeats)
//   fenced-code  – 1 MiB fenced code block (single code node with segments)
//   urls         – 1000 link definitions
//
// Phases:
//   build  – parse only (no lazy indexes should exist)
//   raw    – parse + getRaw on every mapped node
//   range  – parse + getSourceRange on every mapped node
//
// Outputs a .heapsnapshot to temp/heap-profile/.
// Requires Node >= 19 with --expose-gc.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import v8 from 'node:v8';

const require = createRequire(import.meta.url);
const { parseMdWithSourceMap } = require('../dist/lint-md-parser.cjs');

// ── Fixtures ────────────────────────────────────────────────────────────

function fixtureManyNodes() {
  // 10k short paragraphs, each becomes a text node.
  // Blank lines required — consecutive lines merge into one paragraph.
  const lines = [];
  for (let i = 0; i < 10_000; i++) lines.push(`node ${i}`, '');
  return lines.join('\n');
}

function fixtureSegments() {
  // 256 KiB of alternating &amp; \( — maximizes segment count per node.
  const unit = '&amp;\\(';
  const count = Math.round((256 * 1024) / unit.length);
  return unit.repeat(count);
}

function fixtureFencedCode() {
  // 1 MiB code inside a fenced block — one large code node with
  // code-value source mapping.
  const line = 'x'.repeat(80);
  const target = 1024 * 1024;
  const count = Math.ceil(target / (line.length + 1));
  return '```\n' + `${line}\n`.repeat(count) + '```';
}

function fixtureUrls() {
  // 1000 link definitions with short URLs.
  const defs = [];
  for (let i = 0; i < 1000; i++) {
    defs.push(`[text${i}]: /path/to/resource-${i}?q=${i} "title ${i}"`);
  }
  return defs.join('\n');
}

const FIXTURES = {
  'many-nodes': fixtureManyNodes,
  segments: fixtureSegments,
  'fenced-code': fixtureFencedCode,
  urls: fixtureUrls,
};

// ── Helpers ─────────────────────────────────────────────────────────────

/** Collect all leaf nodes of a given type from the AST. */
function collectNodes(root, type) {
  const out = [];
  (function walk(n) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

/** Collect all mapped text/inlineCode/code/link/definition nodes. */
function collectMappedNodes(root) {
  const out = [];
  (function walk(n) {
    if (
      n.type === 'text'
      || n.type === 'inlineCode'
      || n.type === 'code'
      || n.type === 'link'
      || n.type === 'definition'
    ) {
      out.push(n);
    }
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────

const [, , fixtureName, phase] = process.argv;

if (!fixtureName || !phase || !FIXTURES[fixtureName] || !['build', 'raw', 'range'].includes(phase)) {
  console.error(
    'Usage: node --expose-gc scripts/profile-source-map-heap.mjs'
    + ` <fixture> <phase>\n`
    + `  fixtures: ${Object.keys(FIXTURES).join(', ')}\n`
    + `  phases:   build, raw, range`,
  );
  process.exit(1);
}

const md = FIXTURES[fixtureName]();

// Phase 1: build (parse only)
const { ast, sourceMap } = parseMdWithSourceMap(md);

// Phase 2 or 3: exercise the source map
if (phase === 'raw') {
  const nodes = collectMappedNodes(ast);
  for (const n of nodes) {
    sourceMap.getRaw(n);
  }
} else if (phase === 'range') {
  const nodes = collectMappedNodes(ast).filter(
    n => n.type === 'text' || n.type === 'inlineCode' || n.type === 'code',
  );
  for (const n of nodes) {
    if (!n.value) continue;
    try {
      sourceMap.getSourceRange(n, 0, n.value.length);
    } catch (error) {
      // Only non-contiguous ranges (e.g. across blockquote boundaries)
      // are expected to fail. Anything else is a real bug.
      if (!(error instanceof RangeError)) throw error;
    }
  }
}

// Force GC before snapshot.
if (global.gc) global.gc();

// Write snapshot.
const outDir = join(process.cwd(), 'temp', 'heap-profile');
mkdirSync(outDir, { recursive: true });
const filename = `${fixtureName}-${phase}-${Date.now()}.heapsnapshot`;
const snapshotPath = join(outDir, filename);
v8.writeHeapSnapshot(snapshotPath);

console.log(`Snapshot written to ${snapshotPath}`);
console.log(`  fixture: ${fixtureName}`);
console.log(`  phase:   ${phase}`);
console.log(`  md size: ${(md.length / 1024).toFixed(1)} KiB (${md.length} chars)`);
console.log(`  nodes:   ${collectMappedNodes(ast).length} mapped`);
