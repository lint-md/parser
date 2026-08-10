import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import type { ParsedPoint } from '../types';
import type { MarkdownSourceMapSegment } from './types';

interface SourceSpan {
  start: number
  end: number
}

interface RecordingState {
  segments: WeakMap<object, MarkdownSourceMapSegment[]>
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
export function recordingExtension(state: RecordingState) {
  let pendingConstruct: PendingConstruct | undefined;

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
    }
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
