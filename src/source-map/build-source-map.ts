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

const REPLACEMENT_CHARACTER = '�';
// micromark limits named character references to 31 code units; numeric
// references are shorter. Include the leading `&` and trailing `;` so URL
// mapping only considers parser-valid candidates and never scans an entire
// destination for every literal ampersand.
const MAX_CHARACTER_REFERENCE_SOURCE_LENGTH = 33;

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
  buffer: () => void
  resume: () => string
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
 *   `lineEnding`, `autolinkProtocol`, `autolinkEmail`,
 *   `resourceDestinationString`, `definitionDestinationString`, their literal
 *   wrappers, and `resource`.
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

  const onenterUrlDestination = function (this: CompileContext) {
    this.buffer();
  };

  const onexitUrlDestination = function (this: CompileContext, token: any) {
    const url = this.resume();
    const node = this.stack[this.stack.length - 1];
    node.url = url;
    if (node.type === 'link' || node.type === 'definition') {
      state.urlSourceSpans.set(node, {
        start: token.start.offset,
        end: token.end.offset,
      });
    }
  };

  const onexitDestinationLiteral = function (this: CompileContext, token: any) {
    const node = this.stack[this.stack.length - 1];
    if (
      (node.type === 'link' || node.type === 'definition')
      && node.url === ''
      && !state.urlSourceSpans.has(node)
    ) {
      state.urlSourceSpans.set(node, {
        start: token.start.offset + 1,
        end: token.end.offset - 1,
      });
    }
  };

  // The parser emits no destination token for `[label]()`. The confirmed
  // resource token still gives us the accurate point immediately before its
  // closing `)`. Preserve the standard handler's `inReference` cleanup too.
  const onexitresource = function (this: CompileContext, token: any) {
    this.setData('inReference');
    const node = this.stack[this.stack.length - 1];
    if (
      node.type === 'link'
      && node.url === ''
      && !state.urlSourceSpans.has(node)
    ) {
      const emptyOffset = token.end.offset - 1;
      state.urlSourceSpans.set(node, {
        start: emptyOffset,
        end: emptyOffset,
      });
    }
  };

  return {
    enter: {
      data: onenterdata,
      characterEscape: onenterConstruct,
      characterReference: onenterConstruct,
      autolinkProtocol: onenterdata,
      autolinkEmail: onenterdata,
      definitionDestinationString: onenterUrlDestination,
      resourceDestinationString: onenterUrlDestination,
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
      definitionDestinationString: onexitUrlDestination,
      definitionDestinationLiteral: onexitDestinationLiteral,
      resourceDestinationString: onexitUrlDestination,
      resourceDestinationLiteral: onexitDestinationLiteral,
      resource: onexitresource,
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

interface CodeSegments {
  segments: MarkdownSourceMapSegment[]
  emptyOffset?: number
}

interface SourceSpan {
  start: number
  end: number
}

function lineEnd(md: string, start: number, limit: number): number {
  let offset = start;
  while (offset < limit) {
    const char = md.charCodeAt(offset);
    if (char === 13)
      return offset + (md.charCodeAt(offset + 1) === 10 ? 2 : 1);
    if (char === 10)
      return offset + 1;
    offset++;
  }
  return limit;
}

function lineStart(md: string, start: number, end: number): number {
  let offset = end;
  while (offset > start) {
    const char = md.charCodeAt(offset - 1);
    if (char === 10 || char === 13)
      break;
    offset--;
  }
  return offset;
}

function lineContentEnd(md: string, start: number, end: number): number {
  if (end <= start)
    return end;
  if (md.charCodeAt(end - 1) === 10) {
    return end - (md.charCodeAt(end - 2) === 13 ? 2 : 1);
  }
  return md.charCodeAt(end - 1) === 13 ? end - 1 : end;
}

function blockQuoteDepth(md: string, start: number, end: number): number {
  let depth = 0;
  for (let offset = start; offset < end; offset++) {
    if (md.charCodeAt(offset) === 62 /* > */)
      depth++;
  }
  return depth;
}

function skipBlockQuoteMarkers(
  md: string,
  start: number,
  end: number,
  depth: number,
): number | undefined {
  let offset = start;
  for (let index = 0; index < depth; index++) {
    while (offset < end && (md.charCodeAt(offset) === 32 || md.charCodeAt(offset) === 9)) {
      offset++;
    }
    if (md.charCodeAt(offset) !== 62)
      return undefined;
    offset++;
    if (md.charCodeAt(offset) === 32 || md.charCodeAt(offset) === 9)
      offset++;
  }
  return offset;
}

function skipIndentation(
  md: string,
  start: number,
  end: number,
  columns: number,
): number {
  let offset = start;
  let removed = 0;
  while (offset < end && removed < columns) {
    const char = md.charCodeAt(offset);
    if (char === 32) {
      offset++;
      removed++;
    }
    else if (char === 9) {
      offset++;
      removed += 4 - (removed % 4);
    }
    else {
      break;
    }
  }
  return offset;
}

function fencedIndentation(
  md: string,
  lineStartOffset: number,
  fenceStart: number,
  quoteDepth: number,
): number {
  let offset = lineStartOffset;
  if (quoteDepth > 0) {
    const afterMarkers = skipBlockQuoteMarkers(
      md,
      lineStartOffset,
      fenceStart,
      quoteDepth,
    );
    if (afterMarkers === undefined)
      return -1;
    offset = afterMarkers;
  }
  let indentation = 0;
  while (offset < fenceStart) {
    const char = md.charCodeAt(offset);
    if (char === 32) {
      offset++;
      indentation++;
    }
    else if (char === 9) {
      offset++;
      indentation += 4 - (indentation % 4);
    }
    else {
      return -1;
    }
  }
  return indentation;
}

function trimTrailingLineEnding(md: string, spans: SourceSpan[]): void {
  const last = spans[spans.length - 1];
  if (!last)
    return;
  if (md.charCodeAt(last.end - 1) === 10) {
    last.end -= md.charCodeAt(last.end - 2) === 13 ? 2 : 1;
  }
  else if (md.charCodeAt(last.end - 1) === 13) {
    last.end--;
  }
  if (last.start === last.end)
    spans.pop();
}

function segmentsFromSpans(
  md: string,
  spans: SourceSpan[],
  value: string,
): MarkdownSourceMapSegment[] | undefined {
  const segments: MarkdownSourceMapSegment[] = [];
  let valueOffset = 0;
  let sourceValue = '';
  for (const span of spans) {
    if (span.start >= span.end)
      continue;
    const length = span.end - span.start;
    sourceValue += md.slice(span.start, span.end);
    const previous = segments[segments.length - 1];
    if (previous && previous.sourceEnd === span.start && previous.valueEnd === valueOffset) {
      previous.sourceEnd = span.end;
      previous.valueEnd += length;
    }
    else {
      segments.push({
        valueStart: valueOffset,
        valueEnd: valueOffset + length,
        sourceStart: span.start,
        sourceEnd: span.end,
        kind: 'literal',
      });
    }
    valueOffset += length;
  }
  return valueOffset === value.length && sourceValue === value
    ? segments
    : undefined;
}

function buildFencedCodeSegments(
  md: string,
  node: { value: string; position?: ParsedPosition },
): CodeSegments | undefined {
  const position = node.position;
  if (!position)
    return undefined;
  const start = position.start.offset;
  const end = position.end.offset;
  const marker = md.charCodeAt(start);
  if (marker !== 96 && marker !== 126)
    return undefined;

  let fenceLength = 0;
  while (md.charCodeAt(start + fenceLength) === marker) fenceLength++;
  if (fenceLength < 3)
    return undefined;

  const physicalLineStart = lineStart(md, 0, start);
  const quoteDepth = blockQuoteDepth(md, physicalLineStart, start);
  const openingIndent = fencedIndentation(md, physicalLineStart, start, quoteDepth);
  if (openingIndent < 0)
    return undefined;
  // A blockquote code node can end before its final physical line ending, so
  // derive the opening line boundary from the complete Markdown rather than
  // the node's position span. This keeps an unclosed empty fence's insertion
  // point at the actual EOF.
  const openingLineEnd = lineEnd(md, start, md.length);
  let contentEnd = end;
  let hasClosingFence = false;
  const closingLineStart = lineStart(md, start, end);
  let closingFenceStart = openingLineEnd;
  if (closingLineStart >= openingLineEnd && closingLineStart < end) {
    const closingStart = quoteDepth === 0
      ? closingLineStart
      : skipBlockQuoteMarkers(md, closingLineStart, end, quoteDepth);
    if (closingStart === undefined)
      return undefined;
    closingFenceStart = closingStart;
    closingFenceStart = skipIndentation(
      md,
      closingFenceStart,
      end,
      openingIndent,
    );
    const closing = md.slice(closingFenceStart, end);
    const closingMatch = /^( {0,3})(`+|~+)[ \t]*$/.exec(closing);
    if (
      closingMatch
      && closingMatch[2].charCodeAt(0) === marker
      && closingMatch[2].length >= fenceLength
    ) {
      contentEnd = closingLineStart;
      hasClosingFence = true;
    }
  }

  const spans: SourceSpan[] = [];
  let offset = openingLineEnd;
  while (offset < contentEnd) {
    const endOfLine = lineEnd(md, offset, contentEnd);
    let contentStart = quoteDepth === 0
      ? offset
      : skipBlockQuoteMarkers(md, offset, endOfLine, quoteDepth);
    if (contentStart === undefined)
      return undefined;
    contentStart = skipIndentation(md, contentStart, endOfLine, openingIndent);
    spans.push({ start: contentStart, end: endOfLine });
    offset = endOfLine;
  }
  const emptyOffset = spans[0]?.start
    ?? (hasClosingFence ? closingFenceStart : openingLineEnd);
  trimTrailingLineEnding(md, spans);
  const segments = segmentsFromSpans(md, spans, node.value);
  if (!segments)
    return undefined;
  return {
    segments,
    emptyOffset,
  };
}

function buildIndentedCodeSegmentsFromIndentation(
  md: string,
  node: { value: string; position?: ParsedPosition },
): CodeSegments | undefined {
  const position = node.position;
  if (!position)
    return undefined;
  const start = position.start.offset;
  const end = position.end.offset;
  const physicalLineStart = lineStart(md, 0, start);
  const quoteDepth = blockQuoteDepth(md, physicalLineStart, start);
  const initialContentStart = quoteDepth === 0
    ? physicalLineStart
    : skipBlockQuoteMarkers(md, physicalLineStart, start, quoteDepth);
  if (initialContentStart === undefined)
    return undefined;
  const listContinuationIndent = start - initialContentStart;
  const spans: SourceSpan[] = [];
  let offset = start;
  let firstLine = true;
  while (offset < end) {
    const endOfLine = lineEnd(md, offset, end);
    let contentStart = offset;
    if (!firstLine && quoteDepth > 0) {
      const afterMarkers = skipBlockQuoteMarkers(md, offset, endOfLine, quoteDepth);
      if (afterMarkers === undefined)
        return undefined;
      contentStart = afterMarkers;
    }
    if (!firstLine && listContinuationIndent > 0) {
      let removedContinuation = 0;
      while (
        removedContinuation < listContinuationIndent
        && md.charCodeAt(contentStart) === 32
      ) {
        contentStart++;
        removedContinuation++;
      }
      if (
        removedContinuation !== listContinuationIndent
        && contentStart < lineContentEnd(md, offset, endOfLine)
      ) {
        return undefined;
      }
    }
    let indentation = 0;
    while (indentation < 4) {
      const char = md.charCodeAt(contentStart);
      if (char === 32) {
        contentStart++;
        indentation++;
      }
      else if (char === 9) {
        contentStart++;
        indentation += 4 - (indentation % 4);
      }
      else {
        break;
      }
    }
    // A non-blank line with fewer than four indentation columns needs
    // parser-specific virtual-space accounting. Do not fabricate it.
    if (indentation < 4 && contentStart < lineContentEnd(md, offset, endOfLine))
      return undefined;
    spans.push({ start: contentStart, end: endOfLine });
    offset = endOfLine;
    firstLine = false;
  }
  trimTrailingLineEnding(md, spans);
  const segments = segmentsFromSpans(md, spans, node.value);
  if (!segments)
    return undefined;
  return {
    segments,
    emptyOffset: start + Math.min(4, end - start),
  };
}

function buildIndentedCodeSegmentsFromValueLines(
  md: string,
  node: { value: string; position?: ParsedPosition },
): CodeSegments | undefined {
  const position = node.position;
  if (!position)
    return undefined;
  const start = position.start.offset;
  const end = position.end.offset;
  const physicalLineStart = lineStart(md, 0, start);
  const quoteDepth = blockQuoteDepth(md, physicalLineStart, start);
  const spans: SourceSpan[] = [];
  let offset = physicalLineStart;
  let valueOffset = 0;

  while (valueOffset < node.value.length) {
    if (offset >= end)
      return undefined;
    const valueLineEnd = lineEnd(node.value, valueOffset, node.value.length);
    const valueContentEnd = lineContentEnd(
      node.value,
      valueOffset,
      valueLineEnd,
    );
    const valueLine = node.value.slice(valueOffset, valueContentEnd);
    const endOfLine = lineEnd(md, offset, end);
    const contentStart = quoteDepth === 0
      ? offset
      : skipBlockQuoteMarkers(md, offset, endOfLine, quoteDepth);
    if (contentStart === undefined)
      return undefined;
    const contentEnd = lineContentEnd(md, contentStart, endOfLine);
    let sourceStart = contentStart;
    while (
      sourceStart <= contentEnd
      && md.slice(sourceStart, contentEnd) !== valueLine
    ) {
      const char = md.charCodeAt(sourceStart);
      if (char !== 32 && char !== 9)
        return undefined;
      sourceStart++;
    }
    if (sourceStart > contentEnd)
      return undefined;
    spans.push({ start: sourceStart, end: endOfLine });
    offset = endOfLine;
    valueOffset = valueLineEnd;
  }

  trimTrailingLineEnding(md, spans);
  const segments = segmentsFromSpans(md, spans, node.value);
  if (!segments)
    return undefined;
  return {
    segments,
    emptyOffset: spans[0]?.start ?? start,
  };
}

function buildIndentedCodeSegments(
  md: string,
  node: { value: string; position?: ParsedPosition },
): CodeSegments | undefined {
  return buildIndentedCodeSegmentsFromIndentation(md, node)
    // A list continuation can start inside a tab's virtual columns, so its
    // positioned node start is not sufficient to replay the physical prefix.
    // Recover only literal suffixes; normalization remains rejected below.
    ?? buildIndentedCodeSegmentsFromValueLines(md, node);
}

function buildCodeSegments(
  md: string,
  node: { value: string; position?: ParsedPosition },
): CodeSegments | undefined {
  const position = node.position;
  if (!position)
    return undefined;
  const start = position.start.offset;
  const marker = md.charCodeAt(start);
  return marker === 96 || marker === 126
    ? buildFencedCodeSegments(md, node)
    : buildIndentedCodeSegments(md, node);
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
    current: null,
    len: 0,
    kind: 'literal',
    activeStart: 0,
    activeEnd: 0,
    fullSpan: false,
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
  (function register(node: any) {
    owned.add(node);
    if (
      state.segments.has(node)
      || state.inlineCodeSegments.has(node)
      || state.codeSegments.has(node)
    ) {
      originalValues.set(node, node.value);
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
        const startSegment = findSegmentAt(segs, startIndex);
        const endSegment = findSegmentAt(segs, endIndex);
        if (!startSegment || !endSegment) {
          throw new RangeError(
            'getSourceRange: value range is not fully covered by the source map',
          );
        }
        const startSegmentIndex = segs.indexOf(startSegment);
        const endSegmentIndex = segs.indexOf(endSegment);
        for (let index = startSegmentIndex; index < endSegmentIndex; index++) {
          if (segs[index].sourceEnd !== segs[index + 1].sourceStart) {
            throw new RangeError(
              'getSourceRange: value range crosses non-contiguous source segments',
            );
          }
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
