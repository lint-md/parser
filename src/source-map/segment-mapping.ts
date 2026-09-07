import type { MarkdownSourceMapSegment, SegmentMapping } from './types';

export function appendSegment(
  mappings: WeakMap<object, SegmentMapping>,
  node: object,
  segment: MarkdownSourceMapSegment,
): void {
  const current = mappings.get(node);
  if (!current) {
    mappings.set(node, segment);
  }
  else if (Array.isArray(current)) {
    current.push(segment);
  }
  else {
    mappings.set(node, [current, segment]);
  }
}

export function compactSegments(segments: MarkdownSourceMapSegment[]): SegmentMapping {
  return segments.length === 1 ? segments[0] : segments;
}

export function segmentCount(mapping: SegmentMapping): number {
  return Array.isArray(mapping) ? mapping.length : 1;
}

export function segmentAt(
  mapping: SegmentMapping,
  index: number,
): MarkdownSourceMapSegment | undefined {
  return Array.isArray(mapping)
    ? mapping[index]
    : index === 0 ? mapping : undefined;
}
