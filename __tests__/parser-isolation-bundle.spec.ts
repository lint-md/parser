import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { buildSync } from 'esbuild';

/**
 * These tests build the parser with its runtime dependencies kept EXTERNAL, so
 * the temporary artifact and the child-process test script resolve to the SAME
 * `node_modules` copy of `mdast-util-gfm-autolink-literal`. The shipped bundle
 * inlines its dependencies, so a test that `require`s the dependency directly
 * would inspect a different object than the bundle mutates — and would pass
 * even for the old, singleton-mutating implementation. Externalizing closes
 * that gap: these assertions fail on the old implementation and pass on the
 * new one.
 */
const repoRoot = path.resolve(__dirname, '..');
let tmpDir: string;
let publicEntry: string;
let internalEntry: string;

beforeAll(() => {
  // Build inside the repo tree so the externalized dependency imports in the
  // artifact resolve up into the repo's own node_modules (a /tmp location
  // would not find them).
  tmpDir = fs.mkdtempSync(
    path.join(repoRoot, 'node_modules', '.lint-md-parser-ext-'),
  );

  // Public entry: only the shipped API, deps external.
  publicEntry = path.join(tmpDir, 'public.mjs');
  buildSync({
    entryPoints: [path.join(repoRoot, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: publicEntry,
  });

  // Internal entry: additionally re-exports createParserProcessor so we can
  // inspect each processor's own extension data (clone identity + emptiness).
  const internalSrc = path.join(tmpDir, 'internal-entry.ts');
  fs.writeFileSync(
    internalSrc,
    "export { createParserProcessor } from "
      + `${JSON.stringify(path.join(repoRoot, 'src/remark-config.ts'))};\n`,
  );
  internalEntry = path.join(tmpDir, 'internal.mjs');
  buildSync({
    entryPoints: [internalSrc],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: internalEntry,
  });
}, 60000);

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runNode(source: string): string {
  return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

const findExt = `
const findAutolinkExtension = (value) => {
  if (value && typeof value === 'object' && 'transforms' in value && 'enter' in value && 'exit' in value) return value;
  if (Array.isArray(value)) { for (const item of value) { const f = findAutolinkExtension(item); if (f) return f; } }
  return undefined;
};
`;

describe('bundle does not mutate the shared GFM autolink singleton (deps external)', () => {
  test('singleton reference and content survive parser use', () => {
    const out = runNode(`
      import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
      const beforeRef = gfmAutolinkLiteralFromMarkdown.transforms;
      const beforeContent = [...beforeRef];
      const { parseMd, parseMdWithSourceMap } = await import(${JSON.stringify(publicEntry)});
      parseMd('www.example.com');
      parseMdWithSourceMap('"www.google.com"');
      parseMd('<https://ex.com>');
      const after = gfmAutolinkLiteralFromMarkdown.transforms;
      const sameRef = after === beforeRef;
      const sameContent = after.length === beforeContent.length && after.every((t, i) => t === beforeContent[i]);
      process.stdout.write(JSON.stringify({ sameRef, sameContent, len: after.length }));
    `);
    expect(JSON.parse(out)).toEqual({ sameRef: true, sameContent: true, len: 1 });
  });

  test('singleton unchanged for both import orders', () => {
    // extension imported before parser
    const a = runNode(`
      import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
      const ref = gfmAutolinkLiteralFromMarkdown.transforms;
      const { parseMd } = await import(${JSON.stringify(publicEntry)});
      parseMd('www.example.com');
      process.stdout.write(String(gfmAutolinkLiteralFromMarkdown.transforms === ref && ref.length === 1));
    `);
    expect(a).toBe('true');

    // parser used before extension inspected
    const b = runNode(`
      const { parseMd } = await import(${JSON.stringify(publicEntry)});
      parseMd('www.example.com');
      const { gfmAutolinkLiteralFromMarkdown } = await import('mdast-util-gfm-autolink-literal');
      process.stdout.write(String(gfmAutolinkLiteralFromMarkdown.transforms.length === 1));
    `);
    expect(b).toBe('true');
  });
});

describe('each processor owns an independent, emptied autolink clone', () => {
  test('two processors hold distinct clones; singleton keeps its transform', () => {
    const out = runNode(`
      import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
      ${findExt}
      const { createParserProcessor } = await import(${JSON.stringify(internalEntry)});
      const first = createParserProcessor(); first.freeze();
      const second = createParserProcessor(); second.freeze();
      const a = findAutolinkExtension(first.data().fromMarkdownExtensions);
      const b = findAutolinkExtension(second.data().fromMarkdownExtensions);
      process.stdout.write(JSON.stringify({
        found: Boolean(a && b),
        aIsSingleton: a === gfmAutolinkLiteralFromMarkdown,
        bIsSingleton: b === gfmAutolinkLiteralFromMarkdown,
        clonesDiffer: a !== b,
        aEmpty: a.transforms.length === 0,
        bEmpty: b.transforms.length === 0,
        sharedEnter: a.enter === gfmAutolinkLiteralFromMarkdown.enter && b.enter === gfmAutolinkLiteralFromMarkdown.enter,
        singletonLen: gfmAutolinkLiteralFromMarkdown.transforms.length,
      }));
    `);
    expect(JSON.parse(out)).toEqual({
      found: true,
      aIsSingleton: false,
      bIsSingleton: false,
      clonesDiffer: true,
      aEmpty: true,
      bEmpty: true,
      sharedEnter: true,
      singletonLen: 1,
    });
  });
});
