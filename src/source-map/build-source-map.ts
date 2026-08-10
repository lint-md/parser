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
import type {
  MarkdownSourceMap,
  MarkdownSourceMapSegment,
  ParsedMarkdownDocument,
} from './types';

// Use the exact same parser extensions as `parseMd` so the AST (and therefore
// the tokenizer / mdast-extension decisions) are identical. Only the mdast
// `text`-building handlers are swapped for recording ones; every other token
// is compiled by the real `mdast-util-from-markdown` handlers.
const { micromarkExtensions, fromMarkdownExtensions } = getParserExtensions();

interface RecordingState {
  /** node -> ordered, gap-free, non-overlapping segments. */
  segments: WeakMap<object, MarkdownSourceMapSegment[]>
  /** inlineCode node -> value segments (see buildInlineCodeSegments). */
  inlineCodeSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  /** code node -> value segments (see buildCodeSegments). */
  codeSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  /** code node -> source point for an empty value. */
  emptyCodeOffsets: WeakMap<object, number>
  /** link / definition node -> normalized URL segments. */
  urlSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  /** link / definition node -> source point for an empty URL. */
  emptyUrlOffsets: WeakMap<object, number>
  /** link / definition node -> parser-confirmed destination content span. */
  urlSourceSpans: WeakMap<object, SourceSpan>
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
  const hasData = [...interior].some(char => !isWhitespace(char.charCodeAt(0)));
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
  let value = '';
  let valueOffset = 0;
  const add = (sourceStart: number, sourceEnd: number, output: string, kind: MarkdownSourceMapSegment['kind']) => {
    segments.push({
      valueStart: valueOffset,
      valueEnd: valueOffset + output.length,
      sourceStart,
      sourceEnd,
      kind,
    });
    value += output;
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
  return value === node.url ? { segments } : undefined;
}

interface SourceSpan {
  start: number
  end: number
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
  segs: MarkdownSourceMapSegment[],
  valueIndex: number,
): number | undefined {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].valueStart <= valueIndex)
      lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  return seg && valueIndex >= seg.valueStart && valueIndex < seg.valueEnd
    ? lo
    : undefined;
}

function findSegmentAt(
  segs: MarkdownSourceMapSegment[],
  valueIndex: number,
): MarkdownSourceMapSegment | undefined {
  const index = findSegmentIndexAt(segs, valueIndex);
  return index === undefined ? undefined : segs[index];
}

/** Prefix count of source gaps before each segment. */
function buildSourceGapPrefix(segs: MarkdownSourceMapSegment[]): number[] {
  const prefix = [0];
  for (let index = 0; index + 1 < segs.length; index++) {
    prefix.push(
      prefix[index]
      + Number(segs[index].sourceEnd !== segs[index + 1].sourceStart),
    );
  }
  return prefix;
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
  const lineStarts = computeLineStarts(md);

  // Inline-code nodes are compiled by the standard mdast handler rather than
  // recordingExtension. Their positions and normalized values are nevertheless
  // enough to build a mapping after the tree is complete.
  (function recordInlineCodeSegments(node: any) {
    if (node.type === 'inlineCode' && typeof node.value === 'string') {
      const segments = buildInlineCodeSegments(md, node);
      if (segments)
        state.inlineCodeSegments.set(node, segments);
    }
    for (const child of node.children || []) recordInlineCodeSegments(child);
  })(ast);

  (function recordCodeSegments(node: any) {
    if (node.type === 'code' && typeof node.value === 'string') {
      const mapping = buildCodeSegments(md, node);
      if (mapping) {
        state.codeSegments.set(node, mapping.segments);
        if (mapping.emptyOffset !== undefined) {
          state.emptyCodeOffsets.set(node, mapping.emptyOffset);
        }
      }
    }
    for (const child of node.children || []) recordCodeSegments(child);
  })(ast);

  (function recordUrlSegments(node: any) {
    if (
      (node.type === 'link' || node.type === 'definition')
      && typeof node.url === 'string'
    ) {
      const bounds = state.urlSourceSpans.get(node);
      const segments = bounds ? buildUrlSegments(md, node, bounds) : undefined;
      if (segments) {
        state.urlSegments.set(node, segments.segments);
        if (segments.emptyOffset !== undefined)
          state.emptyUrlOffsets.set(node, segments.emptyOffset);
      }
    }
    for (const child of node.children || []) recordUrlSegments(child);
  })(ast);

  // Record every node that belongs to this document so `getRaw` /
  // `getSourceRange` can reject foreign nodes instead of silently slicing the
  // wrong Markdown with a stolen offset. For mapped text nodes, also snapshot
  // the parsed `value` reference: strings are immutable, so comparing against
  // this snapshot later detects any post-parse modification that would
  // invalidate the recorded mapping.
  //
  // Snapshot every node's original source offsets too: `getRaw` reports the raw
  // Markdown that *produced* the node, which is a historical fact fixed at
  // parse time. If a consumer later mutates `node.position` (e.g. a fixer
  // adjusting offsets), `getRaw` must still return the original source rather
  // than slice with the stolen offset.
  const owned = new WeakSet<object>();
  const originalValues = new WeakMap<object, string>();
  const originalUrls = new WeakMap<object, string>();
  const originalOffsets = new WeakMap<object, readonly [number, number]>();
  const sourceGapPrefixes = new WeakMap<MarkdownSourceMapSegment[], number[]>();
  (function register(node: any) {
    owned.add(node);
    const mappedSegments = state.segments.get(node)
      || state.inlineCodeSegments.get(node)
      || state.codeSegments.get(node);
    if (mappedSegments) {
      originalValues.set(node, node.value);
      sourceGapPrefixes.set(mappedSegments, buildSourceGapPrefix(mappedSegments));
    }
    if (state.urlSegments.has(node))
      originalUrls.set(node, node.url);
    const position = (node as { position?: ParsedPosition }).position;
    if (position && position.start && position.end) {
      originalOffsets.set(node, [position.start.offset, position.end.offset]);
    }
    for (const child of node.children || []) register(child);
  })(ast);

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
      if (segs && segs.length > 0) {
        assertUnmodified(node as object);
        // Text nodes with a source map: use the full recorded outer-token
        // span, which covers the complete raw source that produced the value
        // (e.g. '&#0;' includes the trailing ';' even though the parser
        // positions the text node one code unit earlier).
        return md.slice(segs[0].sourceStart, segs[segs.length - 1].sourceEnd);
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
      if (
        !Number.isInteger(valueStart)
        || !Number.isInteger(valueEnd)
        || !Number.isFinite(valueStart)
        || !Number.isFinite(valueEnd)
      ) {
        throw new RangeError(
          'getSourceRange: valueStart and valueEnd must be finite integers, '
            + `got [${valueStart}, ${valueEnd})`,
        );
      }
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
      if (
        valueStart < 0
        || valueEnd > node.value.length
        || valueStart > valueEnd
      ) {
        throw new RangeError(
          `getSourceRange: value range [${valueStart}, ${valueEnd}) is out of `
            + `bounds for a mapped node of length ${node.value.length}`,
        );
      }

      if (segs.length === 0) {
        const emptyOffset = state.emptyCodeOffsets.get(node as object);
        if (node.value.length === 0 && valueStart === 0 && valueEnd === 0 && emptyOffset !== undefined) {
          const sourcePoint = pointAtOffset(lineStarts, md, emptyOffset);
          return { start: sourcePoint, end: sourcePoint };
        }
        throw new RangeError(
          'getSourceRange: value range is not fully covered by the source map',
        );
      }

      // Escapes / character references / normalizations are atomic: the parser
      // produced them as a single unit, so any value range intersecting such a
      // segment must map back to that segment's *complete* source span. Only
      // `literal` segments support per-code-unit boundaries (they are 1:1).
      //
      // The start boundary is the segment containing `valueStart`; the end
      // boundary is the segment containing `valueEnd - 1` (the last value unit
      // included), so a range that stops exactly at an atomic segment's start
      // does NOT pull that segment in. An empty range is valid at the document
      // value boundaries, at any exact segment boundary, and inside literal
      // segments. It throws only when it falls inside a multi-code-unit atomic
      // segment.
      //
      // `pastUnit` distinguishes the start of a unit (false) from the offset
      // just *after* the unit (true). For a literal segment the source offset
      // is `sourceStart + unitsConsumed`, where `unitsConsumed` counts value
      // units from the segment's own start.
      const sourceOffsetAt = (
        valueIndex: number,
        pastUnit: boolean,
      ): number => {
        const seg = findSegmentAt(segs, valueIndex);
        if (!seg) {
          // A range end exactly at the mapped value boundary.
          if (valueIndex === node.value.length && segs.length > 0) {
            return segs[segs.length - 1].sourceEnd;
          }
          throw new RangeError(
            'getSourceRange: value range is not fully covered by the source map',
          );
        }
        if (seg.kind !== 'literal') {
          return pastUnit ? seg.sourceEnd : seg.sourceStart;
        }
        // Literal: 1:1 UTF-16 mapping. `units` counts value units from the
        // segment's own start; `pastUnit` makes it count one extra (the offset
        // just *after* the unit), so a range ending at `valueEnd` maps to
        // `sourceStart + (valueEnd - seg.valueStart)`.
        const units = (pastUnit ? valueIndex + 1 : valueIndex) - seg.valueStart;
        return seg.sourceStart + units;
      };

      const assertContiguousSourceRange = (
        startIndex: number,
        endIndex: number,
      ): void => {
        const startSegmentIndex = findSegmentIndexAt(segs, startIndex);
        const endSegmentIndex = findSegmentIndexAt(segs, endIndex);
        if (startSegmentIndex === undefined || endSegmentIndex === undefined) {
          throw new RangeError(
            'getSourceRange: value range is not fully covered by the source map',
          );
        }
        const gapPrefix = sourceGapPrefixes.get(segs);
        if (
          !gapPrefix
          || gapPrefix[endSegmentIndex] !== gapPrefix[startSegmentIndex]
        ) {
          throw new RangeError(
            'getSourceRange: value range crosses non-contiguous source segments',
          );
        }
      };

      // An empty range [i, i) denotes a single source point. Resolve it
      // directly: only a multi-code-unit atomic construct (escape / character
      // reference / normalization) has no accurate boundary inside it.
      if (valueStart === valueEnd) {
        const index = valueStart;
        const pointRange = (offset: number): ParsedPosition => ({
          start: pointAtOffset(lineStarts, md, offset),
          end: pointAtOffset(lineStarts, md, offset),
        });
        if (index === 0) {
          return pointRange(segs[0].sourceStart);
        }
        if (index === node.value.length) {
          return pointRange(segs[segs.length - 1].sourceEnd);
        }
        const seg = findSegmentAt(segs, index);
        // Exactly at a segment's start: accurate boundary.
        if (seg && index === seg.valueStart) {
          return pointRange(seg.sourceStart);
        }
        // A boundary inside a literal segment is 1:1 accurate.
        if (seg?.kind === 'literal') {
          return pointRange(seg.sourceStart + index - seg.valueStart);
        }
        // Inside a multi-code-unit atomic segment: no accurate boundary.
        throw new RangeError(
          'getSourceRange: empty range falls inside an atomic construct '
            + '(escape / character reference / normalization) where no '
            + 'accurate source boundary exists',
        );
      }

      const startOffset = sourceOffsetAt(valueStart, false);
      const endOffset = sourceOffsetAt(valueEnd === 0 ? 0 : valueEnd - 1, true);
      assertContiguousSourceRange(valueStart, valueEnd - 1);
      return {
        start: pointAtOffset(lineStarts, md, startOffset),
        end: pointAtOffset(lineStarts, md, endOffset),
      };
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
      if (!Number.isInteger(valueStart) || !Number.isInteger(valueEnd)) {
        throw new RangeError(
          'getFieldSourceRange: valueStart and valueEnd must be finite integers',
        );
      }
      const segs = state.urlSegments.get(node as object);
      if (!segs) {
        throw new SourceMapUnavailableError(
          'getFieldSourceRange: no URL source mapping is available for the given node',
        );
      }
      assertUrlUnmodified(node as object);
      if (valueStart < 0 || valueEnd > node.url.length || valueStart > valueEnd) {
        throw new RangeError(
          `getFieldSourceRange: value range [${valueStart}, ${valueEnd}) is out of bounds`,
        );
      }
      const sourceOffsetAt = (valueIndex: number, pastUnit: boolean): number => {
        const seg = findSegmentAt(segs, valueIndex);
        if (!seg) {
          if (valueIndex === node.url.length)
            return segs[segs.length - 1].sourceEnd;
          throw new RangeError('getFieldSourceRange: range is not fully mapped');
        }
        if (seg.kind !== 'literal')
          return pastUnit ? seg.sourceEnd : seg.sourceStart;
        return seg.sourceStart + (pastUnit ? valueIndex + 1 : valueIndex) - seg.valueStart;
      };
      if (valueStart === valueEnd) {
        const pointRange = (offset: number): ParsedPosition => {
          const sourcePoint = pointAtOffset(lineStarts, md, offset);
          return { start: sourcePoint, end: sourcePoint };
        };
        if (segs.length === 0) {
          const emptyOffset = state.emptyUrlOffsets.get(node as object);
          if (node.url.length === 0 && valueStart === 0 && emptyOffset !== undefined) {
            return pointRange(emptyOffset);
          }
          throw new RangeError('getFieldSourceRange: range is not fully mapped');
        }
        if (valueStart === 0)
          return pointRange(segs[0].sourceStart);
        if (valueStart === node.url.length)
          return pointRange(segs[segs.length - 1].sourceEnd);
        const seg = findSegmentAt(segs, valueStart);
        if (seg && valueStart === seg.valueStart)
          return pointRange(seg.sourceStart);
        if (seg?.kind === 'literal') {
          return pointRange(seg.sourceStart + valueStart - seg.valueStart);
        }
        throw new RangeError('getFieldSourceRange: empty range falls inside an atomic construct');
      }
      return {
        start: pointAtOffset(lineStarts, md, sourceOffsetAt(valueStart, false)),
        end: pointAtOffset(lineStarts, md, sourceOffsetAt(valueEnd - 1, true)),
      };
    },
  };

  return { ast, sourceMap };
};
