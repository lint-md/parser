import { fromMarkdown } from 'mdast-util-from-markdown';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import type { Root } from 'mdast';
import type {
  MarkdownCodeNode,
  MarkdownDefinitionNode,
  MarkdownInlineCodeNode,
  MarkdownLinkNode,
  MarkdownNode,
  MarkdownTextNode,
  ParsedPoint,
  ParsedPosition,
  PositionedMarkdownRoot,
} from '../types';
import { getParserExtensions } from '../remark-config';
import { buildCodeSegments } from './code-segments';
import {
  SourceMapConsistencyError,
  SourceMapUnavailableError,
} from './errors';
import { recordingExtension } from './recording-extension';
import { compactSegments, segmentAt, segmentCount } from './segment-mapping';
import type {
  MarkdownSourceMap,
  MarkdownSourceMapSegment,
  ParsedMarkdownDocument,
  SegmentMapping,
  SourceSpan,
} from './types';

// Use the exact same parser extensions as `parseMd` so the AST (and therefore
// the tokenizer / mdast-extension decisions) are identical. Only the mdast
// `text`-building handlers are swapped for recording ones; every other token
// is compiled by the real `mdast-util-from-markdown` handlers.
const { micromarkExtensions, fromMarkdownExtensions } = getParserExtensions();

interface RecordingState {
  /** node -> ordered, gap-free, non-overlapping segments. */
  segments: WeakMap<object, SegmentMapping>
  /** inlineCode node -> value segments (see buildInlineCodeSegments). */
  inlineCodeSegments: WeakMap<object, SegmentMapping>
  /** code node -> value segments (see buildCodeSegments). */
  codeSegments: WeakMap<object, SegmentMapping>
  /** code node -> source point for an empty value. */
  emptyCodeOffsets: WeakMap<object, number>
  /** link / definition node -> normalized URL segments. */
  urlSegments: WeakMap<object, SegmentMapping>
  /** link / definition node -> source point for an empty URL. */
  emptyUrlOffsets: WeakMap<object, number>
  /** link / definition node -> parser-confirmed destination content span. */
  urlSourceSpans: WeakMap<object, SourceSpan>
}

interface TraversableNode {
  type: string
  position?: ParsedPosition
  children?: TraversableNode[]
  value?: unknown
  url?: unknown
}

function hasStringField<Field extends 'value' | 'url'>(
  node: TraversableNode,
  field: Field,
): node is TraversableNode & Record<Field, string> {
  return field in node && typeof node[field] === 'string';
}

// micromark limits named character references to 31 code units; numeric
// references are shorter. Include the leading `&` and trailing `;` so URL
// mapping only considers parser-valid candidates and never scans an entire
// destination for every literal ampersand.
const MAX_CHARACTER_REFERENCE_SOURCE_LENGTH = 33;

/**
 * Offsets (UTF-16 code units) of the first code unit of every line in `md`.
 * Handles LF, CR, and CRLF line endings the same way micromark does.
 */
function computeLineStarts(md: string): number[] {
  const starts = [0];
  let i = 0;
  while (i < md.length) {
    const ch = md.charCodeAt(i);
    if (ch === 10 /* \n */) {
      starts.push(i + 1);
      i += 1;
    }
    else if (ch === 13 /* \r */) {
      if (md.charCodeAt(i + 1) === 10 /* \n */) {
        starts.push(i + 2);
        i += 2;
      }
      else {
        starts.push(i + 1);
        i += 1;
      }
    }
    else {
      i += 1;
    }
  }
  return starts;
}

/**
 * Build a {@link ParsedPoint} from an absolute UTF-16 code-unit `offset` into
 * `md`, using the same line/column convention as micromark (columns count
 * UTF-16 code units, CRLF/CR/LF all end a line).
 */
function pointAtOffset(lineStarts: number[], md: string, offset: number): ParsedPoint {
  // Find the last line whose start is <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset)
      lo = mid;
    else hi = mid - 1;
  }
  const lineStart = lineStarts[lo];
  return {
    line: lo + 1,
    column: offset - lineStart + 1,
    offset,
  };
}

/**
 * Build the source-map segments for an `inlineCode` node.
 *
 * `inlineCode.value` is NOT a contiguous slice of the source: the GFM code
 * span algorithm (micromark `codeText` + `mdast-util-from-markdown`) strips one
 * leading and one trailing whitespace unit from the content when it contains
 * non-whitespace data. A unit is one space, LF, CR, or CRLF. The parser keeps
 * all remaining source code units verbatim, so every surviving value code unit
 * maps 1:1 to exactly one source code unit.
 *
 * The mapping is computed from the node's `position` (the full source span
 * including the backtick delimiters) plus `value`, replicating the GFM
 * resolver: identify its delimiters, then apply its single leading/trailing
 * whitespace-unit rule. This couples to the same parser-sensitive behavior as
 * the text mapping (see CONTRIBUTING).
 *
 * @returns ordered, gap-free, 1:1 segments, or undefined if the node has no
 *   usable position.
 *
 * @internal Used by buildSourceMap; not part of the public API.
 */
function buildInlineCodeSegments(
  md: string,
  node: { value: string; position?: ParsedPosition },
): MarkdownSourceMapSegment[] | undefined {
  const position = node.position;
  if (!position || !position.start || !position.end)
    return undefined;
  const start = position.start.offset;
  const end = position.end.offset;
  if (start < 0 || end > md.length || start >= end)
    return undefined;

  // Full source span including the backtick delimiters.
  const full = md.slice(start, end);

  // Determine the opening / closing backtick run lengths (they must match).
  let openLen = 0;
  while (openLen < full.length && full.charCodeAt(openLen) === 96 /* ` */) openLen++;
  let closeLen = 0;
  while (closeLen < full.length && full.charCodeAt(full.length - 1 - closeLen) === 96) closeLen++;
  if (openLen === 0 || closeLen === 0 || openLen !== closeLen)
    return undefined;

  const interiorStart = start + openLen;
  const interiorEnd = end - closeLen;
  const interior = md.slice(interiorStart, interiorEnd);

  const isWhitespace = (char: number): boolean =>
    char === 32 || char === 10 || char === 13;
  const leadingWhitespaceEnd = (): number => {
    const first = interior.charCodeAt(0);
    if (first === 13 && interior.charCodeAt(1) === 10)
      return 2;
    return isWhitespace(first) ? 1 : 0;
  };
  const trailingWhitespaceStart = (): number => {
    const last = interior.charCodeAt(interior.length - 1);
    if (last === 10 && interior.charCodeAt(interior.length - 2) === 13) {
      return interior.length - 2;
    }
    return isWhitespace(last) ? interior.length - 1 : interior.length;
  };

  let valueSourceStart = 0;
  let valueSourceEnd = interior.length;
  const leadingEnd = leadingWhitespaceEnd();
  const trailingStart = trailingWhitespaceStart();
  let hasData = false;
  for (let i = 0; i < interior.length; i++) {
    if (!isWhitespace(interior.charCodeAt(i))) {
      hasData = true;
      break;
    }
  }
  if (leadingEnd > 0 && trailingStart < interior.length && hasData) {
    valueSourceStart = leadingEnd;
    valueSourceEnd = trailingStart;
  }

  // Confirm that the parser did not apply an unaccounted-for transformation.
  // Returning undefined is safer than fabricating a source range.
  const sourceValue = interior.slice(valueSourceStart, valueSourceEnd);
  if (sourceValue !== node.value || sourceValue.length === 0)
    return undefined;

  return [{
    valueStart: 0,
    valueEnd: sourceValue.length,
    sourceStart: interiorStart + valueSourceStart,
    sourceEnd: interiorStart + valueSourceEnd,
    kind: 'literal',
  }];
}

function isEscapableUrlCharacter(char: number): boolean {
  return (char >= 33 && char <= 47)
    || (char >= 58 && char <= 64)
    || (char >= 91 && char <= 96)
    || (char >= 123 && char <= 126);
}

function characterReferenceEnd(
  md: string,
  start: number,
  end: number,
): number | undefined {
  const limit = Math.min(end, start + MAX_CHARACTER_REFERENCE_SOURCE_LENGTH);
  for (let offset = start + 1; offset < limit; offset++) {
    if (md.charCodeAt(offset) === 59)
      return offset;
  }
  return undefined;
}

interface UrlSegments {
  segments: MarkdownSourceMapSegment[]
  emptyOffset?: number
}

function buildUrlSegments(
  md: string,
  node: { url: string },
  bounds: SourceSpan,
): UrlSegments | undefined {
  if (bounds.start === bounds.end) {
    return node.url === ''
      ? { segments: [], emptyOffset: bounds.start }
      : undefined;
  }
  const segments: MarkdownSourceMapSegment[] = [];
  let valueOffset = 0;
  let valueMatch = true;
  const add = (sourceStart: number, sourceEnd: number, output: string, kind: MarkdownSourceMapSegment['kind']) => {
    segments.push({
      valueStart: valueOffset,
      valueEnd: valueOffset + output.length,
      sourceStart,
      sourceEnd,
      kind,
    });
    if (valueMatch && !node.url.startsWith(output, valueOffset))
      valueMatch = false;
    valueOffset += output.length;
  };
  let literalStart = bounds.start;
  const flushLiteral = (end: number): void => {
    if (literalStart < end)
      add(literalStart, end, md.slice(literalStart, end), 'literal');
  };

  for (let offset = bounds.start; offset < bounds.end;) {
    const char = md.charCodeAt(offset);
    if (char === 92 && offset + 1 < bounds.end && isEscapableUrlCharacter(md.charCodeAt(offset + 1))) {
      flushLiteral(offset);
      add(offset, offset + 2, md[offset + 1], 'escape');
      offset += 2;
      literalStart = offset;
      continue;
    }
    if (char === 38) {
      const semi = characterReferenceEnd(md, offset, bounds.end);
      if (semi !== undefined) {
        const body = md.slice(offset + 1, semi);
        let decoded: string | false;
        if (body.startsWith('#')) {
          const numeric = body.slice(1);
          const radix = numeric.startsWith('x') || numeric.startsWith('X') ? 16 : 10;
          decoded = decodeNumericCharacterReference(
            radix === 16 ? numeric.slice(1) : numeric,
            radix,
          );
        }
        else {
          decoded = decodeNamedCharacterReference(body);
        }
        if (decoded !== false) {
          flushLiteral(offset);
          add(offset, semi + 1, decoded, 'character-reference');
          offset = semi + 1;
          literalStart = offset;
          continue;
        }
      }
    }
    offset++;
  }
  flushLiteral(bounds.end);
  return valueMatch && valueOffset === node.url.length ? { segments } : undefined;
}

/**
 * Find the segment covering `valueIndex`, or undefined.
 *
 * Segments are ordered, gap-free, and non-overlapping (see {@link
 * RecordingState.segments}), so this binary-searches for the last segment whose
 * `valueStart <= valueIndex`, then confirms `valueIndex < valueEnd`. This keeps
 * each lookup at O(log segments) instead of O(segments), which matters for
 * pathological text nodes with many alternating entity/escape segments queried
 * repeatedly.
 */
function findSegmentIndexAt(
  segs: SegmentMapping,
  valueIndex: number,
): number | undefined {
  let lo = 0;
  let hi = segmentCount(segs) - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segmentAt(segs, mid)!.valueStart <= valueIndex)
      lo = mid;
    else hi = mid - 1;
  }
  const seg = segmentAt(segs, lo);
  return seg && valueIndex >= seg.valueStart && valueIndex < seg.valueEnd
    ? lo
    : undefined;
}

function findSegmentAt(
  segs: SegmentMapping,
  valueIndex: number,
): MarkdownSourceMapSegment | undefined {
  const index = findSegmentIndexAt(segs, valueIndex);
  return index === undefined ? undefined : segmentAt(segs, index);
}

/** Prefix count of source gaps before each segment. */
function buildSourceGapPrefix(segs: SegmentMapping): number[] {
  const prefix = [0];
  for (let index = 0; index + 1 < segmentCount(segs); index++) {
    const current = segmentAt(segs, index)!;
    const next = segmentAt(segs, index + 1)!;
    prefix.push(
      prefix[index]
      + Number(current.sourceEnd !== next.sourceStart),
    );
  }
  return prefix;
}

interface RangeResolutionMessages {
  invalidIndices: (valueStart: number, valueEnd: number) => string
  outOfBounds: (valueStart: number, valueEnd: number, valueLength: number) => string
  incomplete: string
  atomicEmpty: string
  nonContiguous: string
}

interface SegmentRangeOptions {
  segments: SegmentMapping
  valueLength: number
  valueStart: number
  valueEnd: number
  emptyOffset?: number
  getSourceGapPrefix?: () => number[]
  requireContiguousSource?: boolean
  messages: RangeResolutionMessages
  lineStarts: number[]
  source: string
}

const sourceRangeMessages: RangeResolutionMessages = {
  invalidIndices: (valueStart, valueEnd) =>
    'getSourceRange: valueStart and valueEnd must be finite integers, '
    + `got [${valueStart}, ${valueEnd})`,
  outOfBounds: (valueStart, valueEnd, valueLength) =>
    `getSourceRange: value range [${valueStart}, ${valueEnd}) is out of `
    + `bounds for a mapped node of length ${valueLength}`,
  incomplete: 'getSourceRange: value range is not fully covered by the source map',
  atomicEmpty: 'getSourceRange: empty range falls inside an atomic construct '
    + '(escape / character reference / normalization) where no accurate '
    + 'source boundary exists',
  nonContiguous: 'getSourceRange: value range crosses non-contiguous source segments',
};

const fieldRangeMessages: RangeResolutionMessages = {
  invalidIndices: () =>
    'getFieldSourceRange: valueStart and valueEnd must be finite integers',
  outOfBounds: (valueStart, valueEnd) =>
    `getFieldSourceRange: value range [${valueStart}, ${valueEnd}) is out of bounds`,
  incomplete: 'getFieldSourceRange: range is not fully mapped',
  atomicEmpty: 'getFieldSourceRange: empty range falls inside an atomic construct',
  nonContiguous: 'getFieldSourceRange: range crosses non-contiguous source segments',
};

function validateValueRange(
  valueStart: number,
  valueEnd: number,
  messages: RangeResolutionMessages,
): (valueLength: number) => void {
  if (
    !Number.isInteger(valueStart)
    || !Number.isInteger(valueEnd)
    || !Number.isFinite(valueStart)
    || !Number.isFinite(valueEnd)
  ) {
    throw new RangeError(messages.invalidIndices(valueStart, valueEnd));
  }
  // The caller first confirms that the field has a mapping.
  return (valueLength: number) => {
    if (valueStart < 0 || valueEnd > valueLength || valueStart > valueEnd) {
      throw new RangeError(
        messages.outOfBounds(valueStart, valueEnd, valueLength),
      );
    }
  };
}

function resolveEmptyRange(
  options: SegmentRangeOptions,
): number {
  const {
    segments,
    valueLength,
    valueStart,
    emptyOffset,
    messages,
  } = options;
  const count = segmentCount(segments);
  if (count === 0) {
    if (valueLength === 0 && valueStart === 0 && emptyOffset !== undefined)
      return emptyOffset;
    throw new RangeError(messages.incomplete);
  }
  if (valueStart === 0)
    return segmentAt(segments, 0)!.sourceStart;
  if (valueStart === valueLength)
    return segmentAt(segments, count - 1)!.sourceEnd;
  const segment = findSegmentAt(segments, valueStart);
  if (segment && valueStart === segment.valueStart)
    return segment.sourceStart;
  if (segment?.kind === 'literal')
    return segment.sourceStart + valueStart - segment.valueStart;
  throw new RangeError(messages.atomicEmpty);
}

function resolveSegmentRange(options: SegmentRangeOptions): ParsedPosition {
  const {
    segments,
    valueStart,
    valueEnd,
    getSourceGapPrefix,
    requireContiguousSource,
    messages,
    lineStarts,
    source,
  } = options;
  const pointRange = (offset: number): ParsedPosition => {
    const point = pointAtOffset(lineStarts, source, offset);
    return { start: point, end: point };
  };

  if (valueStart === valueEnd)
    return pointRange(resolveEmptyRange(options));
  if (segmentCount(segments) === 0)
    throw new RangeError(messages.incomplete);

  const startSegmentIndex = findSegmentIndexAt(segments, valueStart);
  const endSegmentIndex = findSegmentIndexAt(segments, valueEnd - 1);
  if (startSegmentIndex === undefined || endSegmentIndex === undefined)
    throw new RangeError(messages.incomplete);
  if (requireContiguousSource && startSegmentIndex !== endSegmentIndex) {
    const prefix = getSourceGapPrefix?.();
    if (!prefix || prefix[endSegmentIndex] !== prefix[startSegmentIndex])
      throw new RangeError(messages.nonContiguous);
  }

  const startSegment = segmentAt(segments, startSegmentIndex)!;
  const endSegment = segmentAt(segments, endSegmentIndex)!;

  let startOffset: number;
  if (startSegment.kind !== 'literal')
    startOffset = startSegment.sourceStart;
  else
    startOffset = startSegment.sourceStart + valueStart - startSegment.valueStart;

  let endOffset: number;
  if (endSegment.kind !== 'literal')
    endOffset = endSegment.sourceEnd;
  else
    endOffset = endSegment.sourceStart + (valueEnd - 1) + 1 - endSegment.valueStart;

  return {
    start: pointAtOffset(lineStarts, source, startOffset),
    end: pointAtOffset(lineStarts, source, endOffset),
  };
}

/**
 * Parse Markdown and additionally produce a sidecar source map that resolves
 * supported normalized-value fields back to the raw Markdown source.
 *
 * The AST is identical to {@link parseMd}. The current version maps
 * `text.value`, `inlineCode.value`, block `code.value`, and the `url` field
 * of `link` and `definition` nodes.
 *
 * @param md - Markdown text.
 * @returns The positioned AST plus a source map.
 *
 * @public
 */
export const parseMdWithSourceMap = (md: string): ParsedMarkdownDocument => {
  const state: RecordingState = {
    segments: new WeakMap(),
    inlineCodeSegments: new WeakMap(),
    codeSegments: new WeakMap(),
    emptyCodeOffsets: new WeakMap(),
    urlSegments: new WeakMap(),
    emptyUrlOffsets: new WeakMap(),
    urlSourceSpans: new WeakMap(),
  };

  const tree = fromMarkdown(md, {
    extensions: micromarkExtensions as any,
    mdastExtensions: [
      ...(fromMarkdownExtensions as any),
      recordingExtension(state),
    ],
  }) as unknown as Root;

  const ast = tree as unknown as PositionedMarkdownRoot;
  let lineStarts: number[] | undefined;

  // The index records ownership and parse-time state for all nodes.
  // It also builds mappings that the parser extension cannot produce.
  const owned = new WeakSet<object>();
  const originalValues = new WeakMap<object, string>();
  const originalUrls = new WeakMap<object, string>();
  // Snapshot offsets before consumers can mutate positions.
  // getRaw() must describe the source that originally produced each node.
  const originalOffsets = new WeakMap<object, readonly [number, number]>();
  const sourceGapPrefixes = new WeakMap<SegmentMapping, number[]>();

  function indexNode(node: TraversableNode): void {
    // The standard mdast handler compiles inline code.
    // The completed node contains enough data to build its mapping.
    if (
      node.type === 'inlineCode'
      && hasStringField(node, 'value')
    ) {
      const segments = buildInlineCodeSegments(md, node);
      if (segments)
        state.inlineCodeSegments.set(node, compactSegments(segments));
    }

    if (
      node.type === 'code'
      && hasStringField(node, 'value')
    ) {
      const mapping = buildCodeSegments(md, node);
      if (mapping) {
        state.codeSegments.set(node, compactSegments(mapping.segments));
        if (mapping.emptyOffset !== undefined) {
          state.emptyCodeOffsets.set(node, mapping.emptyOffset);
        }
      }
    }

    if (
      (node.type === 'link' || node.type === 'definition')
      && hasStringField(node, 'url')
    ) {
      const bounds = state.urlSourceSpans.get(node);
      const segments = bounds ? buildUrlSegments(md, node, bounds) : undefined;
      if (segments) {
        state.urlSegments.set(node, compactSegments(segments.segments));
        if (segments.emptyOffset !== undefined)
          state.emptyUrlOffsets.set(node, segments.emptyOffset);
      }
    }

    owned.add(node);
    const mappedSegments = state.segments.get(node)
      || state.inlineCodeSegments.get(node)
      || state.codeSegments.get(node);
    if (mappedSegments) {
      if (hasStringField(node, 'value'))
        originalValues.set(node, node.value);
    }
    if (
      state.urlSegments.has(node)
      && hasStringField(node, 'url')
    ) {
      originalUrls.set(node, node.url);
    }
    const position = node.position;
    if (position && position.start && position.end) {
      originalOffsets.set(node, [position.start.offset, position.end.offset]);
    }
    for (const child of node.children || []) indexNode(child);
  }

  indexNode(ast);

  // The recorded mapping only describes the parsed value. If a consumer
  // modified `node.value` after parsing, any answer would be fabricated —
  // throw a dedicated consistency error instead.
  const assertUnmodified = (node: object): void => {
    const original = originalValues.get(node);
    if (original !== undefined && (node as { value?: string }).value !== original) {
      throw new SourceMapConsistencyError(
        'the mapped node has been modified since parsing; the source '
        + 'map only covers the original parsed value',
      );
    }
  };

  const assertUrlUnmodified = (node: object): void => {
    const original = originalUrls.get(node);
    if (original !== undefined && (node as { url?: string }).url !== original) {
      throw new SourceMapConsistencyError(
        'the mapped url field has been modified since parsing; the source '
        + 'map only covers the original parsed URL',
      );
    }
  };

  const sourceMap: MarkdownSourceMap = {
    getRaw(
      node: MarkdownNode | MarkdownTextNode | MarkdownInlineCodeNode | MarkdownCodeNode
      | MarkdownLinkNode | MarkdownDefinitionNode,
    ): string {
      if (!owned.has(node as object)) {
        throw new SourceMapUnavailableError(
          'getRaw: the given node does not belong to this document; pass a '
            + 'node from the tree returned by the same parseMdWithSourceMap() call',
        );
      }
      const segs = state.segments.get(node as object);
      if (segs && segmentCount(segs) > 0) {
        assertUnmodified(node as object);
        // Text nodes with a source map: use the full recorded outer-token
        // span, which covers the complete raw source that produced the value
        // (e.g. '&#0;' includes the trailing ';' even though the parser
        // positions the text node one code unit earlier).
        const last = segmentCount(segs) - 1;
        return md.slice(segmentAt(segs, 0)!.sourceStart, segmentAt(segs, last)!.sourceEnd);
      }
      if (
        state.inlineCodeSegments.has(node as object)
        || state.codeSegments.has(node as object)
      ) {
        assertUnmodified(node as object);
      }
      if (state.urlSegments.has(node as object))
        assertUrlUnmodified(node as object);
      // Non-mapped nodes: slice with the offsets snapshotted at parse time, so
      // post-parse mutation of `node.position` can't make `getRaw` return the
      // wrong source. A node with no snapshot never had a real source position.
      const offsets = originalOffsets.get(node as object);
      if (!offsets) {
        throw new SourceMapUnavailableError(
          'getRaw: the given node has no source position; it may have been '
            + 'generated by a plugin or added after parsing',
        );
      }
      return md.slice(offsets[0], offsets[1]);
    },

    getSourceRange(
      node: MarkdownTextNode | MarkdownInlineCodeNode | MarkdownCodeNode,
      valueStart: number,
      valueEnd: number,
    ): ParsedPosition {
      if (!owned.has(node as object)) {
        throw new SourceMapUnavailableError(
          'getSourceRange: the given node does not belong to this document; '
            + 'pass a node from the tree returned by the same '
            + 'parseMdWithSourceMap() call',
        );
      }
      const validateBounds = validateValueRange(
        valueStart,
        valueEnd,
        sourceRangeMessages,
      );
      const segs = state.segments.get(node as object)
        || state.inlineCodeSegments.get(node as object)
        || state.codeSegments.get(node as object);
      if (!segs) {
        throw new SourceMapUnavailableError(
          'getSourceRange: no source mapping is available for the given '
            + 'node; it was generated, added after parsing, or is not a '
            + 'supported text, inlineCode, or code node',
        );
      }
      assertUnmodified(node as object);
      validateBounds(node.value.length);
      lineStarts ??= computeLineStarts(md);
      return resolveSegmentRange({
        segments: segs,
        valueLength: node.value.length,
        valueStart,
        valueEnd,
        emptyOffset: state.emptyCodeOffsets.get(node as object),
        getSourceGapPrefix: () => {
          let prefix = sourceGapPrefixes.get(segs);
          if (!prefix) {
            prefix = buildSourceGapPrefix(segs);
            sourceGapPrefixes.set(segs, prefix);
          }
          return prefix;
        },
        requireContiguousSource: true,
        messages: sourceRangeMessages,
        lineStarts,
        source: md,
      });
    },

    getFieldSourceRange(
      node: MarkdownLinkNode | MarkdownDefinitionNode,
      field: 'url',
      valueStart: number,
      valueEnd: number,
    ): ParsedPosition {
      if (!owned.has(node as object)) {
        throw new SourceMapUnavailableError(
          'getFieldSourceRange: the given node does not belong to this document',
        );
      }
      if (field !== 'url') {
        throw new SourceMapUnavailableError(
          `getFieldSourceRange: no source mapping is available for field ${field}`,
        );
      }
      const validateBounds = validateValueRange(
        valueStart,
        valueEnd,
        fieldRangeMessages,
      );
      const segs = state.urlSegments.get(node as object);
      if (!segs) {
        throw new SourceMapUnavailableError(
          'getFieldSourceRange: no URL source mapping is available for the given node',
        );
      }
      assertUrlUnmodified(node as object);
      validateBounds(node.url.length);
      lineStarts ??= computeLineStarts(md);
      return resolveSegmentRange({
        segments: segs,
        valueLength: node.url.length,
        valueStart,
        valueEnd,
        emptyOffset: state.emptyUrlOffsets.get(node as object),
        messages: fieldRangeMessages,
        lineStarts,
        source: md,
      });
    },
  };

  return { ast, sourceMap };
};
