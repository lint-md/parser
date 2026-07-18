import type { MarkdownNode, MarkdownTextNode, ParsedPosition } from '../types';

/**
 * The kind of transformation the parser applied to turn a slice of the raw
 * Markdown source into the corresponding slice of a node's normalized value.
 *
 * @public
 */
export type SourceMapSegmentKind =
  | 'literal'
  | 'escape'
  | 'character-reference'
  | 'normalization'
  | 'generated';

/**
 * A single contiguous mapping between a half-open range of a node's
 * normalized `value` (UTF-16 code unit indices) and the corresponding
 * half-open range of the raw Markdown source (absolute offsets).
 *
 * Adjacent segments never overlap and never leave gaps across the whole
 * `node.value`.
 *
 * @public
 */
export interface MarkdownSourceMapSegment {
  /** Half-open interval within `node.value` (JavaScript string indices). */
  valueStart: number
  /** Half-open interval within `node.value` (JavaScript string indices). */
  valueEnd: number

  /** Absolute half-open interval within the raw Markdown source. */
  sourceStart: number
  /** Absolute half-open interval within the raw Markdown source. */
  sourceEnd: number

  /**
   * What the parser did to this slice.
   *
   * - `literal`: copied verbatim from source.
   * - `escape`: a CommonMark backslash escape (`\(` → `(`).
   * - `character-reference`: a named/decimal/hex character reference
   *   (`&amp;` → `&`); source and value lengths may differ.
   * - `normalization`: the parser replaced an illegal code point with the
   *   Unicode replacement character (U+FFFD), or otherwise normalized the
   *   slice without decoding an entity.
   * - `generated`: the node (or slice) has no corresponding original source
   *   (e.g. synthesized by a plugin). Such slices MUST NOT claim a real
   *   source position.
   */
  kind: SourceMapSegmentKind
}

/**
 * Sidecar source map produced alongside a parse. Maps `text` nodes to the
 * compressed list of segments that reconstruct their `value` from the raw
 * Markdown source.
 *
 * @public
 */
export interface MarkdownSourceMap {
  /**
   * Returns the raw Markdown substring that produced the given node's
   * normalized value.
   *
   * Only accepts a node that belongs to the tree returned by the same
   * `parseMdWithSourceMap()` call and that has a real source span. For a
   * node with no source mapping this throws a `RangeError` instead of
   * returning a forged substring.
   *
   * @param node - A node from the document this map was built for.
   * @returns The raw Markdown that produced `node`.
   */
  getRaw(node: MarkdownNode): string

  /**
   * Maps a half-open range of a `text` node's normalized `value` back to the
   * corresponding range in the raw Markdown source.
   *
   * The returned range is monotonically increasing and covers the union of
   * every source segment spanned by `[valueStart, valueEnd)`.
   *
   * @param node - A `text` node from the document this map was built for.
   * @param valueStart - Start index into `node.value` (inclusive).
   * @param valueEnd - End index into `node.value` (exclusive).
   * @returns The source range covering the requested value slice.
   */
  getSourceRange(
    node: MarkdownTextNode,
    valueStart: number,
    valueEnd: number,
  ): ParsedPosition
}

/**
 * Result of {@link parseMdWithSourceMap}.
 *
 * @public
 */
export interface ParsedMarkdownDocument {
  /** The fully positioned AST, identical to what {@link parseMd} returns. */
  ast: import('../types').PositionedMarkdownRoot
  /** Sidecar source map for resolving `text` value ranges to raw source. */
  sourceMap: MarkdownSourceMap
}
