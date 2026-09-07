import {
  appendSegment,
  compactSegments,
  segmentAt,
  segmentCount,
} from '../../src/source-map/segment-mapping';
import type {
  MarkdownSourceMapSegment,
  SegmentMapping,
} from '../../src/source-map/types';

const first: MarkdownSourceMapSegment = {
  valueStart: 0,
  valueEnd: 1,
  sourceStart: 0,
  sourceEnd: 1,
  kind: 'literal',
};

const second: MarkdownSourceMapSegment = {
  valueStart: 1,
  valueEnd: 2,
  sourceStart: 1,
  sourceEnd: 3,
  kind: 'escape',
};

describe('segment mapping storage', () => {
  it('stores one segment directly and promotes the second segment', () => {
    const mappings = new WeakMap<object, SegmentMapping>();
    const node = {};

    appendSegment(mappings, node, first);
    expect(mappings.get(node)).toBe(first);

    appendSegment(mappings, node, second);
    expect(mappings.get(node)).toEqual([first, second]);
  });

  it('compacts completed single-segment arrays', () => {
    expect(compactSegments([first])).toBe(first);

    const multiple = [first, second];
    expect(compactSegments(multiple)).toBe(multiple);
  });

  it('reads direct and array mappings without normalization', () => {
    expect(segmentCount(first)).toBe(1);
    expect(segmentAt(first, 0)).toBe(first);
    expect(segmentAt(first, 1)).toBeUndefined();

    const multiple = [first, second];
    expect(segmentCount(multiple)).toBe(2);
    expect(segmentAt(multiple, 1)).toBe(second);
  });
});
