import frontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { remark } from 'remark';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import type { Root } from 'mdast';
import type { MarkdownNode, MarkdownTextNode, ParsedPoint, ParsedPosition, PositionedMarkdownRoot } from '../types';
import type {
  MarkdownSourceMap,
  MarkdownSourceMapSegment,
  ParsedMarkdownDocument,
} from './types';

// Mirror the plugin stack used by `parseMd` so the source map is built by the
// exact same tokenizer / mdast-extension decision path. Only the mdast
// `text`-building handlers are swapped for recording ones; every other token
// is compiled by the real `mdast-util-from-markdown` handlers.
gfmAutolinkLiteralFromMarkdown.transforms = [];

// Freeze a copy to read the micromark + from-markdown extensions the plugins
// registered. These describe the real parser's decisions (including whether an
// `&amp;` inside an autolink is decoded or kept literal).
const frozen = remark()
  .use(frontmatter)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMath);
frozen.freeze();
const extensionsData = frozen.data();
const micromarkExtensions: unknown[]
  = (extensionsData.micromarkExtensions as unknown[]) || [];
const fromMarkdownExtensions: unknown[]
  = (extensionsData.fromMarkdownExtensions as unknown[]) || [];

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
}

const point = (d: { line: number; column: number; offset: number }): ParsedPoint => ({
  line: d.line,
  column: d.column,
  offset: d.offset,
});

const createText = () => ({ type: 'text', value: '' });

// Type aliases for the compile-context shape we touch.
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
    if (type) {
      value = decodeNumericCharacterReference(
        data,
        type === 'characterReferenceMarkerNumeric' ? 10 : 16,
      );
      this.setData('characterReferenceType');
    }
    else {
      const decoded = decodeNamedCharacterReference(data);
      value = decoded === false ? data : decoded;
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
        kind: 'character-reference',
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
  };

  const tree = fromMarkdown(md, {
    extensions: micromarkExtensions as any,
    mdastExtensions: [
      ...(fromMarkdownExtensions as any),
      recordingExtension(state),
    ],
  }) as unknown as Root;

  const ast = tree as unknown as PositionedMarkdownRoot;

  const sourceMap: MarkdownSourceMap = {
    getRaw(node: MarkdownNode): string {
      const segs = state.segments.get(node as object);
      if (!segs) {
        throw new RangeError(
          'getRaw: the given node has no source mapping; it is either '
            + 'not part of this document, or was synthesized without a source span',
        );
      }
      if (segs.length === 0) {
        return '';
      }
      return md.slice(segs[0].sourceStart, segs[segs.length - 1].sourceEnd);
    },

    getSourceRange(
      node: MarkdownTextNode,
      valueStart: number,
      valueEnd: number,
    ): ParsedPosition {
      const segs = state.segments.get(node as object);
      if (!segs) {
        throw new RangeError(
          'getSourceRange: the given node has no source mapping; it is '
            + 'either not part of this document, or was synthesized without a '
            + 'source span',
        );
      }
      if (valueStart < 0 || valueEnd > node.value.length || valueStart > valueEnd) {
        throw new RangeError(
          `getSourceRange: value range [${valueStart}, ${valueEnd}) is out of `
            + `bounds for a text node of length ${node.value.length}`,
        );
      }
      // Source offset for a given value index, interpolated within its
      // segment. Literal segments are 1:1; decoded segments map proportionally
      // so the result stays monotonic. A request at a segment boundary uses
      // that boundary's source offset.
      const sourceOffsetAt = (valueIndex: number): number => {
        const seg = findSegmentAt(segs, valueIndex);
        if (!seg) {
          // Boundary exactly at the end of the mapped value.
          if (valueIndex === node.value.length && segs.length > 0) {
            return segs[segs.length - 1].sourceEnd;
          }
          throw new RangeError(
            'getSourceRange: value range is not fully covered by the source map',
          );
        }
        const valueLen = seg.valueEnd - seg.valueStart;
        const sourceLen = seg.sourceEnd - seg.sourceStart;
        if (valueLen === 0)
          return seg.sourceStart;
        const ratio = (valueIndex - seg.valueStart) / valueLen;
        return seg.sourceStart + Math.round(ratio * sourceLen);
      };

      const start = pointAtOffset(md, sourceOffsetAt(valueStart));
      const end = pointAtOffset(md, sourceOffsetAt(valueEnd));
      return { start, end };
    },
  };

  return { ast, sourceMap };
};
/** Find the segment covering `valueIndex`, or undefined. */
function findSegmentAt(
  segs: MarkdownSourceMapSegment[],
  valueIndex: number,
): MarkdownSourceMapSegment | undefined {
  for (const seg of segs) {
    if (valueIndex >= seg.valueStart && valueIndex < seg.valueEnd) {
      return seg;
    }
  }
  return undefined;
}

/** Compute a {@link ParsedPoint} from an absolute offset into `md`. */
function pointAtOffset(md: string, offset: number): ParsedPoint {
  // `offset` is a UTF-16 code-unit offset from the start of `md`.
  const prefix = md.slice(0, offset);
  let line = 1;
  let column = 1;
  for (const ch of prefix) {
    if (ch === '\n') {
      line += 1;
      column = 1;
    }
    else {
      column += 1;
    }
  }
  return { line, column, offset };
}
