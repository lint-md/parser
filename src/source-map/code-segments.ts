import type { ParsedPosition } from '../types';
import type { MarkdownSourceMapSegment, SourceSpan } from './types';

interface CodeSegments {
  segments: MarkdownSourceMapSegment[]
  emptyOffset?: number
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

function equalRange(
  left: string,
  leftStart: number,
  right: string,
  rightStart: number,
  length: number,
): boolean {
  for (let i = 0; i < length; i++) {
    if (left.charCodeAt(leftStart + i) !== right.charCodeAt(rightStart + i))
      return false;
  }
  return true;
}

function segmentsFromSpans(
  md: string,
  spans: SourceSpan[],
  value: string,
): MarkdownSourceMapSegment[] | undefined {
  const segments: MarkdownSourceMapSegment[] = [];
  let valueOffset = 0;
  for (const span of spans) {
    if (span.start >= span.end)
      continue;
    const length = span.end - span.start;
    if (!equalRange(md, span.start, value, valueOffset, length))
      return undefined;
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
  return valueOffset === value.length ? segments : undefined;
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
    const endOfLine = lineEnd(md, offset, end);
    const contentStart = quoteDepth === 0
      ? offset
      : skipBlockQuoteMarkers(md, offset, endOfLine, quoteDepth);
    if (contentStart === undefined)
      return undefined;
    const contentEnd = lineContentEnd(md, contentStart, endOfLine);
    // The parsed value line must be a literal suffix of the physical source line.
    const valueLength = valueContentEnd - valueOffset;
    const sourceStart = contentEnd - valueLength;
    if (sourceStart < contentStart)
      return undefined;
    for (let prefixOffset = contentStart; prefixOffset < sourceStart; prefixOffset++) {
      const char = md.charCodeAt(prefixOffset);
      if (char !== 32 && char !== 9)
        return undefined;
    }
    if (!equalRange(md, sourceStart, node.value, valueOffset, valueLength))
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

export function buildCodeSegments(
  md: string,
  node: { value: string; position?: ParsedPosition },
): CodeSegments | undefined {
  return buildIndentedCodeSegments(md, node);
}
