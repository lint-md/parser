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

export function buildCodeSegments(
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
