import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import type { ParsedPoint } from '../types';
import type { MarkdownSourceMapSegment, SourceSpan } from './types';

interface RecordingState {
  source: string
  segments: WeakMap<object, MarkdownSourceMapSegment[]>
  inlineCodeSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  codeSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  emptyCodeOffsets: WeakMap<object, number>
  urlSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  emptyUrlOffsets: WeakMap<object, number>
  urlSourceSpans: WeakMap<object, SourceSpan>
}

interface SegmentMetadata {
  sourceStart: number
  sourceEnd: number
  kind: MarkdownSourceMapSegment['kind']
}

interface PendingConstruct {
  sourceStart: number
  sourceEnd: number
}

interface CodeValueRecording {
  segments: MarkdownSourceMapSegment[]
  valueLength: number
}

interface UrlRecording {
  segments: MarkdownSourceMapSegment[]
  valueLength: number
}

interface FencedCodeRecording extends CodeValueRecording {
  emptyOffset: number
  sawOpeningLineEnding: boolean
  sawContentAfterOpening: boolean
  sawClosingFence: boolean
  openingIndent: number
  closingFenceStart?: number
}

const REPLACEMENT_CHARACTER = '�';

const point = (d: { line: number; column: number; offset: number }): ParsedPoint => ({
  line: d.line,
  column: d.column,
  offset: d.offset,
});

const createText = () => ({ type: 'text', value: '' });

function sliceLiteralSegments(
  segments: MarkdownSourceMapSegment[],
  valueStart: number,
  valueEnd: number,
): MarkdownSourceMapSegment[] | undefined {
  const result: MarkdownSourceMapSegment[] = [];
  for (const segment of segments) {
    const start = Math.max(segment.valueStart, valueStart);
    const end = Math.min(segment.valueEnd, valueEnd);
    if (start >= end)
      continue;
    const sourceStart = segment.sourceStart + start - segment.valueStart;
    const sourceEnd = segment.sourceStart + end - segment.valueStart;
    const previous = result[result.length - 1];
    if (previous && previous.sourceEnd === sourceStart) {
      previous.valueEnd = end - valueStart;
      previous.sourceEnd = sourceEnd;
    }
    else {
      result.push({
        valueStart: start - valueStart,
        valueEnd: end - valueStart,
        sourceStart,
        sourceEnd,
        kind: 'literal',
      });
    }
  }
  let mappedLength = 0;
  for (const segment of result) {
    if (segment.valueStart !== mappedLength)
      return undefined;
    mappedLength = segment.valueEnd;
  }
  return mappedLength === valueEnd - valueStart ? result : undefined;
}

function indentationColumns(source: string, start: number, end: number): number {
  let columns = 0;
  for (let offset = start; offset < end; offset++) {
    const char = source.charCodeAt(offset);
    if (char === 32)
      columns++;
    else if (char === 9)
      columns += 4 - (columns % 4);
    else
      return 0;
  }
  return columns;
}

function skipIndentationColumns(
  source: string,
  start: number,
  end: number,
  columns: number,
): number {
  let offset = start;
  let removed = 0;
  while (offset < end && removed < columns) {
    const char = source.charCodeAt(offset);
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

interface CompileContext {
  stack: Array<any>
  config: { canContainEols: string[] }
  enter: (node: any, token: any) => void
  exit: (token: any) => void
  getData: (key: string) => unknown
  setData: (key: string, value?: unknown) => void
  sliceSerialize: (token: any) => string
  buffer: () => void
  resume: () => string
}

/**
 * Build a `mdast` extension that records source mappings during compilation.
 * Its handlers record mappings for `text` and `inlineCode` values.
 * They also record block `code` values.
 * They record link and definition URL destinations.
 *
 * ⚠️ This couples to `mdast-util-from-markdown` / micromark INTERNALS, not the
 * public remark API. Upgrading any parser-sensitive dependency is a parser
 * behavior upgrade — see CONTRIBUTING.md. The undocumented upstream contracts
 * this relies on are:
 *
 * - token event handler names (enter/exit): `data`, `codeText`, `codeTextData`,
 *   `codeFenced`, `codeFencedFence`, `codeFencedFenceSequence`, `codeIndented`,
 *   `codeFlowValue`, `blockQuotePrefix`, `characterEscape` /
 *   `characterEscapeValue`, `characterReference` / `characterReferenceValue`,
 *   `lineEnding`, `autolinkProtocol`, `autolinkEmail`,
 *   `resourceDestinationString`, `definitionDestinationString`, their literal
 *   wrappers, and `resource`.
 * - compile-context fields on `this` ({@link CompileContext}): `stack` (the AST
 *   build stack), `enter` / `exit`, `config.canContainEols` (whether a line
 *   ending is merged into text), and `getData` / `setData`.
 *   The handlers use the `characterReferenceType`, `atHardBreak`, and
 *   `setextHeadingSlurpLineEnding` data keys. They also use `sliceSerialize`.
 * - entity decoding must match remark's own: `decodeNumericCharacterReference` /
 *   `decodeNamedCharacterReference` are pinned to the versions remark uses so
 *   decoding does not drift.
 *
 * If any of the above changes upstream, this extension can silently produce a
 * wrong mapping; the parity + source-map test suites are the guardrail.
 */
export function recordingExtension(state: RecordingState) {
  let pendingConstruct: PendingConstruct | undefined;
  let inlineCodeSegments: MarkdownSourceMapSegment[] | undefined;
  let fencedCodeRecording: FencedCodeRecording | undefined;
  let indentedCodeRecording: CodeValueRecording | undefined;
  let urlRecording: UrlRecording | undefined;
  let pendingEmptyFencedCode: object | undefined;
  let lineIndentStart = 0;

  const takePendingConstruct = (): PendingConstruct => {
    if (!pendingConstruct) {
      throw new Error('Missing pending source-map construct');
    }
    const construct = pendingConstruct;
    pendingConstruct = undefined;
    return construct;
  };

  const onenterdata = function (this: CompileContext, token: any) {
    const node = this.stack[this.stack.length - 1];
    let tail = node.children[node.children.length - 1];
    if (!tail || tail.type !== 'text') {
      tail = createText();
      tail.position = { start: point(token.start) };
      node.children.push(tail);
    }
    this.stack.push(tail);
    if (!state.segments.has(tail)) {
      state.segments.set(tail, []);
    }
  };

  // For escapes and character references the decoded value is appended by the
  // *value* sub-token, but the source span we must record is the whole
  // construct (backslash + escaped char, or `&`...`;`). Capture the outer
  // token's boundaries on enter so the value-exit can record the full range.
  const onenterConstruct = function (this: CompileContext, token: any) {
    if (pendingConstruct) {
      throw new Error('A source-map construct is already pending');
    }
    pendingConstruct = {
      sourceStart: token.start.offset,
      sourceEnd: token.end.offset,
    };
    onenterdata.call(this, token);
  };

  const onexitdata = function (
    this: CompileContext,
    token: any,
    metadata: SegmentMetadata,
  ): string {
    const tail = this.stack.pop();
    const slice = this.sliceSerialize(token);
    const valueStart = tail.value.length;
    tail.value += slice;
    tail.position.end = point(token.end);
    const segs = state.segments.get(tail);
    if (segs) {
      segs.push({
        valueStart,
        valueEnd: valueStart + slice.length,
        ...metadata,
      });
    }
    return slice;
  };

  const recordUrlSegment = (
    metadata: SegmentMetadata,
    valueLength: number,
  ): void => {
    if (!urlRecording)
      return;
    const previous = urlRecording.segments[urlRecording.segments.length - 1];
    if (
      metadata.kind === 'literal'
      && previous?.kind === 'literal'
      && previous.sourceEnd === metadata.sourceStart
      && previous.valueEnd === urlRecording.valueLength
    ) {
      previous.valueEnd += valueLength;
      previous.sourceEnd = metadata.sourceEnd;
    }
    else {
      urlRecording.segments.push({
        valueStart: urlRecording.valueLength,
        valueEnd: urlRecording.valueLength + valueLength,
        ...metadata,
      });
    }
    urlRecording.valueLength += valueLength;
  };

  const onexitcharacterreferencevalue = function (this: CompileContext, token: any) {
    const construct = takePendingConstruct();
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
    const valueStart = tail.value.length;
    tail.value += value;
    tail.position.end = point(token.end);
    const segs = state.segments.get(tail);
    if (segs) {
      segs.push({
        valueStart,
        valueEnd: valueStart + value.length,
        ...construct,
        kind,
      });
    }
    recordUrlSegment({ ...construct, kind }, value.length);
  };

  const inlineCodeValueLength = (): number => {
    const tail = inlineCodeSegments?.[inlineCodeSegments.length - 1];
    return tail?.valueEnd ?? 0;
  };

  const recordInlineCodeSegment = function (this: CompileContext, token: any) {
    if (!inlineCodeSegments)
      return;
    const valueLength = this.sliceSerialize(token).length;
    const previous = inlineCodeSegments[inlineCodeSegments.length - 1];
    if (
      previous
      && previous.sourceEnd === token.start.offset
    ) {
      previous.valueEnd += valueLength;
      previous.sourceEnd = token.end.offset;
      return;
    }
    const valueStart = inlineCodeValueLength();
    inlineCodeSegments.push({
      valueStart,
      valueEnd: valueStart + valueLength,
      sourceStart: token.start.offset,
      sourceEnd: token.end.offset,
      kind: 'literal',
    });
  };

  const recordCodeSegment = function (
    this: CompileContext,
    recording: CodeValueRecording | undefined,
    token: any,
  ) {
    if (!recording)
      return;
    const valueLength = this.sliceSerialize(token).length;
    const sourceStart = token.start.offset;
    // A line-ending token can include the next container prefix in its bounds.
    // `sliceSerialize` excludes that prefix from the compiled value.
    const sourceEnd = sourceStart + valueLength;
    const previous = recording.segments[recording.segments.length - 1];
    if (previous && previous.sourceEnd === sourceStart) {
      previous.valueEnd += valueLength;
      previous.sourceEnd = sourceEnd;
    }
    else {
      recording.segments.push({
        valueStart: recording.valueLength,
        valueEnd: recording.valueLength + valueLength,
        sourceStart,
        sourceEnd,
        kind: 'literal',
      });
    }
    recording.valueLength += valueLength;
  };

  const onexitlineending = function (this: CompileContext, token: any) {
    const lineEndingLength = this.sliceSerialize(token).length;
    if (pendingEmptyFencedCode) {
      const emptyOffset = token.start.offset + lineEndingLength;
      state.emptyCodeOffsets.set(pendingEmptyFencedCode, emptyOffset);
      pendingEmptyFencedCode = undefined;
    }
    lineIndentStart = token.start.offset + lineEndingLength;
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
      onexitdata.call(this, token, {
        sourceStart: token.start.offset,
        sourceEnd: token.end.offset,
        kind: 'literal',
      });
      recordInlineCodeSegment.call(this, token);
      if (fencedCodeRecording) {
        if (!fencedCodeRecording.sawOpeningLineEnding) {
          const lineEndingEnd = token.start.offset
            + lineEndingLength;
          fencedCodeRecording.emptyOffset = Math.max(
            token.end.offset,
            lineEndingEnd,
          );
          fencedCodeRecording.sawOpeningLineEnding = true;
        }
        else {
          fencedCodeRecording.sawContentAfterOpening = true;
        }
        recordCodeSegment.call(this, fencedCodeRecording, token);
      }
      recordCodeSegment.call(this, indentedCodeRecording, token);
    }
  };

  const onentercodetext = function (this: CompileContext, token: any) {
    if (inlineCodeSegments) {
      throw new Error('An inline code source map is already being recorded');
    }
    this.enter({ type: 'inlineCode', value: '' }, token);
    this.buffer();
    inlineCodeSegments = [];
  };

  const onentercodetextdata = function (this: CompileContext, token: any) {
    const node = this.stack[this.stack.length - 1];
    let tail = node.children[node.children.length - 1];
    if (!tail || tail.type !== 'text') {
      tail = createText();
      tail.position = { start: point(token.start) };
      node.children.push(tail);
    }
    this.stack.push(tail);
  };

  const onexitcodetextdata = function (this: CompileContext, token: any) {
    const tail = this.stack.pop();
    const slice = this.sliceSerialize(token);
    tail.value += slice;
    tail.position.end = point(token.end);
    recordInlineCodeSegment.call(this, token);
  };

  const onexitcodetext = function (this: CompileContext, token: any) {
    const value = this.resume();
    const node = this.stack[this.stack.length - 1];
    node.value = value;
    const segments = inlineCodeSegments;
    const mappedValueLength = inlineCodeValueLength();
    inlineCodeSegments = undefined;
    if (segments && mappedValueLength === value.length) {
      state.inlineCodeSegments.set(node, segments);
    }
    this.exit(token);
  };

  const onentercodefenced = function (this: CompileContext, token: any) {
    if (fencedCodeRecording) {
      throw new Error('A fenced code source map is already being recorded');
    }
    this.enter({ type: 'code', lang: null, meta: null, value: '' }, token);
    fencedCodeRecording = {
      segments: [],
      valueLength: 0,
      emptyOffset: token.start.offset,
      sawOpeningLineEnding: false,
      sawContentAfterOpening: false,
      sawClosingFence: false,
      openingIndent: indentationColumns(
        state.source,
        lineIndentStart,
        token.start.offset,
      ),
    };
  };

  const onentercodefencedfence = function (
    this: CompileContext,
    token: any,
  ) {
    if (this.getData('flowCodeInside') && fencedCodeRecording)
      fencedCodeRecording.closingFenceStart = token.start.offset;
  };

  const onexitcodefencedfence = function (this: CompileContext, token: any) {
    if (this.getData('flowCodeInside')) {
      if (fencedCodeRecording)
        fencedCodeRecording.sawClosingFence = true;
      return;
    }
    this.buffer();
    this.setData('flowCodeInside', true);
    if (fencedCodeRecording)
      fencedCodeRecording.emptyOffset = token.end.offset;
  };

  const onexitcodefencedfencesequence = function (
    this: CompileContext,
    token: any,
  ) {
    if (
      this.getData('flowCodeInside')
      && fencedCodeRecording
      && !fencedCodeRecording.sawContentAfterOpening
    ) {
      const closingStart = fencedCodeRecording.closingFenceStart
        ?? token.start.offset;
      fencedCodeRecording.emptyOffset = skipIndentationColumns(
        state.source,
        closingStart,
        token.start.offset,
        fencedCodeRecording.openingIndent,
      );
    }
  };

  const onexitcodeflowvalue = function (this: CompileContext, token: any) {
    onexitdata.call(this, token, {
      sourceStart: token.start.offset,
      sourceEnd: token.end.offset,
      kind: 'literal',
    });
    if (fencedCodeRecording)
      fencedCodeRecording.sawContentAfterOpening = true;
    recordCodeSegment.call(this, fencedCodeRecording, token);
    recordCodeSegment.call(this, indentedCodeRecording, token);
  };

  const onexitcodefenced = function (this: CompileContext, token: any) {
    const data = this.resume();
    const node = this.stack[this.stack.length - 1];
    if (!node || node.type !== 'code') {
      throw new Error('Expected code node while recording fenced code');
    }
    const value = data.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, '');
    node.value = value;
    const recording = fencedCodeRecording;
    fencedCodeRecording = undefined;
    if (!recording) {
      throw new Error('Missing fenced code source-map recording');
    }
    const leadingLineEnding = /^(\r?\n|\r)/.exec(data)?.[0].length ?? 0;
    const segments = sliceLiteralSegments(
      recording.segments,
      leadingLineEnding,
      leadingLineEnding + value.length,
    );
    if (segments) {
      state.codeSegments.set(node, segments);
      state.emptyCodeOffsets.set(node, recording.emptyOffset);
    }
    if (
      value.length === 0
      && !recording.sawOpeningLineEnding
      && !recording.sawClosingFence
    ) {
      pendingEmptyFencedCode = node;
    }
    this.setData('flowCodeInside');
    this.exit(token);
  };

  const onentercodeindented = function (this: CompileContext, token: any) {
    if (indentedCodeRecording) {
      throw new Error('An indented code source map is already being recorded');
    }
    this.enter({ type: 'code', lang: null, meta: null, value: '' }, token);
    this.buffer();
    indentedCodeRecording = {
      segments: [],
      valueLength: 0,
    };
  };

  const onexitcodeindented = function (this: CompileContext, token: any) {
    const data = this.resume();
    const node = this.stack[this.stack.length - 1];
    if (!node || node.type !== 'code') {
      throw new Error('Expected code node while recording indented code');
    }
    const value = data.replace(/(\r?\n|\r)$/g, '');
    node.value = value;
    const recording = indentedCodeRecording;
    indentedCodeRecording = undefined;
    if (!recording) {
      throw new Error('Missing indented code source-map recording');
    }
    const segments = sliceLiteralSegments(
      recording.segments,
      0,
      value.length,
    );
    if (segments)
      state.codeSegments.set(node, segments);
    this.exit(token);
  };

  const onexitautolinkprotocol = function (this: CompileContext, token: any) {
    onexitdata.call(this, token, {
      sourceStart: token.start.offset,
      sourceEnd: token.end.offset,
      kind: 'literal',
    });
    const node = this.stack[this.stack.length - 1];
    node.url = this.sliceSerialize(token);
  };

  const onexitautolinkemail = function (this: CompileContext, token: any) {
    onexitdata.call(this, token, {
      sourceStart: token.start.offset,
      sourceEnd: token.end.offset,
      kind: 'literal',
    });
    const node = this.stack[this.stack.length - 1];
    node.url = `mailto:${this.sliceSerialize(token)}`;
  };

  const onenterUrlDestination = function (this: CompileContext) {
    if (urlRecording) {
      throw new Error('A URL source map is already being recorded');
    }
    this.buffer();
    urlRecording = {
      segments: [],
      valueLength: 0,
    };
  };

  const onexitUrlDestination = function (this: CompileContext, token: any) {
    const url = this.resume();
    const node = this.stack[this.stack.length - 1];
    node.url = url;
    const recording = urlRecording;
    urlRecording = undefined;
    if (!recording) {
      throw new Error('Missing URL source-map recording');
    }
    if (node.type === 'link' || node.type === 'definition') {
      state.urlSourceSpans.set(node, {
        start: token.start.offset,
        end: token.end.offset,
      });
      if (recording.valueLength === url.length) {
        state.urlSegments.set(node, recording.segments);
        if (url.length === 0)
          state.emptyUrlOffsets.set(node, token.start.offset);
      }
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
      state.urlSegments.set(node, []);
      state.emptyUrlOffsets.set(node, token.start.offset + 1);
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
      state.urlSegments.set(node, []);
      state.emptyUrlOffsets.set(node, emptyOffset);
    }
  };

  return {
    enter: {
      codeFenced: onentercodefenced,
      codeFencedFence: onentercodefencedfence,
      codeIndented: onentercodeindented,
      codeFlowValue: onenterdata,
      codeText: onentercodetext,
      codeTextData: onentercodetextdata,
      data: onenterdata,
      characterEscape: onenterConstruct,
      characterReference: onenterConstruct,
      autolinkProtocol: onenterdata,
      autolinkEmail: onenterdata,
      definitionDestinationString: onenterUrlDestination,
      resourceDestinationString: onenterUrlDestination,
    },
    exit: {
      codeFenced: onexitcodefenced,
      codeFencedFence: onexitcodefencedfence,
      codeFencedFenceSequence: onexitcodefencedfencesequence,
      codeIndented: onexitcodeindented,
      codeFlowValue: onexitcodeflowvalue,
      codeText: onexitcodetext,
      codeTextData: onexitcodetextdata,
      data(this: CompileContext, token: any) {
        const metadata: SegmentMetadata = {
          sourceStart: token.start.offset,
          sourceEnd: token.end.offset,
          kind: 'literal',
        };
        const value = onexitdata.call(this, token, metadata);
        recordUrlSegment(metadata, value.length);
      },
      characterEscapeValue(this: CompileContext, token: any) {
        const construct = takePendingConstruct();
        const metadata: SegmentMetadata = {
          ...construct,
          kind: 'escape',
        };
        const value = onexitdata.call(this, token, metadata);
        recordUrlSegment(metadata, value.length);
      },
      characterReferenceValue: onexitcharacterreferencevalue,
      blockQuotePrefix(this: CompileContext, token: any) {
        lineIndentStart = token.end.offset;
      },
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
