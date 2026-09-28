import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import type { ParsedPoint } from '../types';
import type { MarkdownSourceMapSegment, SourceSpan } from './types';

interface RecordingState {
  segments: WeakMap<object, MarkdownSourceMapSegment[]>
  inlineCodeSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  codeSegments: WeakMap<object, MarkdownSourceMapSegment[]>
  emptyCodeOffsets: WeakMap<object, number>
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

interface FencedCodeRecording {
  segments: MarkdownSourceMapSegment[]
  valueLength: number
  emptyOffset: number
  sawOpeningLineEnding: boolean
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
 * Its handlers record mappings for `text`, `inlineCode`, and fenced `code` values.
 *
 * ⚠️ This couples to `mdast-util-from-markdown` / micromark INTERNALS, not the
 * public remark API. Upgrading any parser-sensitive dependency is a parser
 * behavior upgrade — see CONTRIBUTING.md. The undocumented upstream contracts
 * this relies on are:
 *
 * - token event handler names (enter/exit): `data`, `codeText`, `codeTextData`,
 *   `codeFenced`, `codeFencedFence`, `codeFlowValue`, `characterEscape` /
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
  ) {
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

  const recordFencedCodeSegment = function (this: CompileContext, token: any) {
    const recording = fencedCodeRecording;
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
          fencedCodeRecording.emptyOffset = token.end.offset;
          fencedCodeRecording.sawOpeningLineEnding = true;
        }
        recordFencedCodeSegment.call(this, token);
      }
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
    };
  };

  const onexitcodefencedfence = function (this: CompileContext, token: any) {
    if (this.getData('flowCodeInside'))
      return;
    this.buffer();
    this.setData('flowCodeInside', true);
    if (fencedCodeRecording)
      fencedCodeRecording.emptyOffset = token.end.offset;
  };

  const onexitcodeflowvalue = function (this: CompileContext, token: any) {
    onexitdata.call(this, token, {
      sourceStart: token.start.offset,
      sourceEnd: token.end.offset,
      kind: 'literal',
    });
    recordFencedCodeSegment.call(this, token);
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
    this.setData('flowCodeInside');
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
      codeFenced: onentercodefenced,
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
      codeFlowValue: onexitcodeflowvalue,
      codeText: onexitcodetext,
      codeTextData: onexitcodetextdata,
      data(this: CompileContext, token: any) {
        onexitdata.call(this, token, {
          sourceStart: token.start.offset,
          sourceEnd: token.end.offset,
          kind: 'literal',
        });
      },
      characterEscapeValue(this: CompileContext, token: any) {
        const construct = takePendingConstruct();
        onexitdata.call(this, token, {
          ...construct,
          kind: 'escape',
        });
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
