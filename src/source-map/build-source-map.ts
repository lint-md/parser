import { fromMarkdown } from 'mdast-util-from-markdown';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import type { Root } from 'mdast';
import type {
  MarkdownInlineCodeNode,
  MarkdownNode,
  MarkdownTextNode,
  ParsedPoint,
  ParsedPosition,
  PositionedMarkdownRoot,
} from '../types';
import { getParserExtensions } from '../remark-config';
import {
  SourceMapConsistencyError,
  SourceMapUnavailableError,
} from './errors';
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
  /** Text node currently being appended to. */
  current: object | null
  /** Length of `current.value` at the start of the active segment. */
  len: number
  /** Kind to assign to the next `data`/`characterEscapeValue` segment. */
  kind: MarkdownSourceMapSegment['kind']
  /** Source start of the active escape/character-reference construct. */
  activeStart: number
  /** Source end of the active escape/character-reference construct. */
  activeEnd: number
  /** When true, the next `onexitdata` records the full construct span. */
  fullSpan: boolean
  /** node -> ordered, gap-free, non-overlapping segments. */
  segments: WeakMap<object, MarkdownSourceMapSegment[]>
  /** inlineCode node -> value segments (see buildInlineCodeSegments). */
  inlineCodeSegments: WeakMap<object, MarkdownSourceMapSegment[]>
}

const REPLACEMENT_CHARACTER = '�';

const point = (d: { line: number; column: number; offset: number }): ParsedPoint => ({
  line: d.line,
  column: d.column,
  offset: d.offset,
});

const createText = () => ({ type: 'text', value: '' });

interface CompileContext {
  stack: Array<any>
  config: { canContainEols: string[] }
  getData: (key: string) => unknown
  setData: (key: string, value?: unknown) => void
  sliceSerialize: (token: any) => string
}

/**
 * Build a `mdast`-extension whose `text`-building handlers record, alongside
 * the normal AST construction, the mapping from each `text` node's normalized
 * `value` back to the raw Markdown source.
 *
 * ⚠️ This couples to `mdast-util-from-markdown` / micromark INTERNALS, not the
 * public remark API. Upgrading any parser-sensitive dependency is a parser
 * behavior upgrade — see CONTRIBUTING.md. The undocumented upstream contracts
 * this relies on are:
 *
 * - token event handler names (enter/exit): `data`, `characterEscape` /
 *   `characterEscapeValue`, `characterReference` / `characterReferenceValue`,
 *   `lineEnding`, `autolinkProtocol`, `autolinkEmail`.
 * - compile-context fields on `this` ({@link CompileContext}): `stack` (the AST
 *   build stack), `config.canContainEols` (whether a line ending is merged into
 *   text), `getData` / `setData` for the keys `characterReferenceType`,
 *   `atHardBreak`, `setextHeadingSlurpLineEnding`, and `sliceSerialize`.
 * - entity decoding must match remark's own: `decodeNumericCharacterReference` /
 *   `decodeNamedCharacterReference` are pinned to the versions remark uses so
 *   decoding does not drift.
 *
 * If any of the above changes upstream, this extension can silently produce a
 * wrong mapping; the parity + source-map test suites are the guardrail.
 */
function recordingExtension(state: RecordingState) {
  const onenterdata = function (this: CompileContext, token: any) {
    const node = this.stack[this.stack.length - 1];
    let tail = node.children[node.children.length - 1];
    if (!tail || tail.type !== 'text') {
      tail = createText();
      tail.position = { start: point(token.start) };
      node.children.push(tail);
    }
    this.stack.push(tail);
    if (state.current !== tail) {
      state.current = tail;
      state.segments.set(tail, []);
      state.len = 0;
    }
  };

  // For escapes and character references the decoded value is appended by the
  // *value* sub-token, but the source span we must record is the whole
  // construct (backslash + escaped char, or `&`...`;`). Capture the outer
  // token's boundaries on enter so the value-exit can record the full range.
  const onenterConstruct = function (this: CompileContext, token: any) {
    state.activeStart = token.start.offset;
    state.activeEnd = token.end.offset;
    onenterdata.call(this, token);
  };

  const onexitdata = function (this: CompileContext, token: any) {
    const tail = this.stack.pop();
    const slice = this.sliceSerialize(token);
    tail.value += slice;
    tail.position.end = point(token.end);
    const segs = state.segments.get(tail);
    if (segs) {
      const sourceStart = state.fullSpan ? state.activeStart : token.start.offset;
      const sourceEnd = state.fullSpan ? state.activeEnd : token.end.offset;
      segs.push({
        valueStart: state.len,
        valueEnd: state.len + slice.length,
        sourceStart,
        sourceEnd,
        kind: state.kind,
      });
      state.len += slice.length;
      state.fullSpan = false;
    }
  };

  const onexitcharacterreferencevalue = function (this: CompileContext, token: any) {
    const data = this.sliceSerialize(token);
    const type = this.getData('characterReferenceType') as string | undefined;
    let value: string;
    let kind: MarkdownSourceMapSegment['kind'];
    if (type) {
      value = decodeNumericCharacterReference(
        data,
        type === 'characterReferenceMarkerNumeric' ? 10 : 16,
      );
      this.setData('characterReferenceType');
      // Illegal / null / noncharacter numeric references are normalized by the
      // parser to the Unicode replacement character rather than decoded.
      kind = value === REPLACEMENT_CHARACTER ? 'normalization' : 'character-reference';
    }
    else {
      const decoded = decodeNamedCharacterReference(data);
      value = decoded === false ? data : decoded;
      kind = 'character-reference';
    }
    const tail = this.stack.pop();
    tail.value += value;
    tail.position.end = point(token.end);
    const segs = state.segments.get(tail);
    if (segs) {
      segs.push({
        valueStart: state.len,
        valueEnd: state.len + value.length,
        sourceStart: state.activeStart,
        sourceEnd: state.activeEnd,
        kind,
      });
      state.len += value.length;
    }
  };

  const onexitlineending = function (this: CompileContext, token: any) {
    if (this.getData('atHardBreak')) {
      const tail = this.stack[this.stack.length - 1].children.slice(-1)[0];
      tail.position.end = point(token.end);
      this.setData('atHardBreak');
      return;
    }
    const context = this.stack[this.stack.length - 1];
    if (
      !this.getData('setextHeadingSlurpLineEnding')
      && this.config.canContainEols.includes(context.type)
    ) {
      onenterdata.call(this, token);
      // A line ending is verbatim source (1:1). Reset `kind` to 'literal' so it
      // does not inherit the previous construct's kind (e.g. 'escape' left by a
      // preceding `\(`), which would wrongly mark the CRLF as an atomic segment
      // and break per-code-unit mapping of `\r` / `\n`.
      state.kind = 'literal';
      onexitdata.call(this, token);
    }
  };

  const onexitautolinkprotocol = function (this: CompileContext, token: any) {
    state.kind = 'literal';
    onexitdata.call(this, token);
    const node = this.stack[this.stack.length - 1];
    node.url = this.sliceSerialize(token);
  };

  const onexitautolinkemail = function (this: CompileContext, token: any) {
    state.kind = 'literal';
    onexitdata.call(this, token);
    const node = this.stack[this.stack.length - 1];
    node.url = `mailto:${this.sliceSerialize(token)}`;
  };

  return {
    enter: {
      data: onenterdata,
      characterEscape: onenterConstruct,
      characterReference: onenterConstruct,
      autolinkProtocol: onenterdata,
      autolinkEmail: onenterdata,
    },
    exit: {
      data(this: CompileContext, token: any) {
        state.kind = 'literal';
        onexitdata.call(this, token);
      },
      characterEscapeValue(this: CompileContext, token: any) {
        state.kind = 'escape';
        state.fullSpan = true;
        onexitdata.call(this, token);
      },
      characterReferenceValue: onexitcharacterreferencevalue,
      lineEnding: onexitlineending,
      autolinkProtocol: onexitautolinkprotocol,
      autolinkEmail: onexitautolinkemail,
    },
  };
}

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
function findSegmentAt(
  segs: MarkdownSourceMapSegment[],
  valueIndex: number,
): MarkdownSourceMapSegment | undefined {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].valueStart <= valueIndex)
      lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  if (seg && valueIndex >= seg.valueStart && valueIndex < seg.valueEnd) {
    return seg;
  }
  return undefined;
}

/**
 * Parse Markdown and additionally produce a sidecar source map that resolves
 * each `text` node's normalized `value` back to the raw Markdown source.
 *
 * The AST is identical to {@link parseMd}; only `text` nodes carry a mapping
 * in the first version.
 *
 * @param md - Markdown text.
 * @returns The positioned AST plus a source map.
 *
 * @public
 */
export const parseMdWithSourceMap = (md: string): ParsedMarkdownDocument => {
  const state: RecordingState = {
    current: null,
    len: 0,
    kind: 'literal',
    activeStart: 0,
    activeEnd: 0,
    fullSpan: false,
    segments: new WeakMap(),
    inlineCodeSegments: new WeakMap(),
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
  const originalOffsets = new WeakMap<object, readonly [number, number]>();
  (function register(node: any) {
    owned.add(node);
    if (state.segments.has(node) || state.inlineCodeSegments.has(node)) {
      originalValues.set(node, node.value);
    }
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

  const sourceMap: MarkdownSourceMap = {
    getRaw(node: MarkdownNode): string {
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
      if (state.inlineCodeSegments.has(node as object)) {
        assertUnmodified(node as object);
      }
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
      node: MarkdownTextNode | MarkdownInlineCodeNode,
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
        || state.inlineCodeSegments.get(node as object);
      if (!segs) {
        throw new SourceMapUnavailableError(
          'getSourceRange: no source mapping is available for the given '
            + 'node; it was generated, added after parsing, or is not a '
            + 'supported text or inlineCode node',
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
      return {
        start: pointAtOffset(lineStarts, md, startOffset),
        end: pointAtOffset(lineStarts, md, endOffset),
      };
    },
  };

  return { ast, sourceMap };
};
