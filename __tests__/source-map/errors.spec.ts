import {
  SourceMapConsistencyError,
  SourceMapError,
  SourceMapUnavailableError,
  parseMdWithSourceMap,
} from '../helpers';

/** Collect matching nodes in document order. */
function nodesOfType(root: any, type: string): any[] {
  const out: any[] = [];
  (function walk(n: any) {
    if (n.type === type) out.push(n);
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

describe('parseMdWithSourceMap: error lifecycle', () => {
  /** Run `fn`, returning the error it threw. */
  function thrown(fn: () => unknown): any {
    try {
      fn();
    } catch (err) {
      return err;
    }
    throw new Error('expected the call to throw');
  }

  test('querying a modified text node throws SourceMapConsistencyError', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = nodesOfType(ast, 'text')[0];
    expect(t.value).toBe('A&B');
    t.value = 'changed';
    const err = thrown(() => sourceMap.getSourceRange(t, 0, 1));
    expect(err).toBeInstanceOf(SourceMapConsistencyError);
    expect(err).toBeInstanceOf(SourceMapError);
    // Still a RangeError: existing catch (RangeError) handling keeps working.
    expect(err).toBeInstanceOf(RangeError);
    // The stable code survives minification and cross-instance checks.
    expect(err.name).toBe('SourceMapConsistencyError');
    expect(err.code).toBe('ERR_SOURCE_MAP_CONSISTENCY');
  });

  test('getRaw on a modified text node throws SourceMapConsistencyError', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = nodesOfType(ast, 'text')[0];
    t.value = 'changed';
    const err = thrown(() => sourceMap.getRaw(t));
    expect(err).toBeInstanceOf(SourceMapConsistencyError);
    expect(err.code).toBe('ERR_SOURCE_MAP_CONSISTENCY');
  });

  test('reassigning the identical value keeps the mapping valid', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('A&amp;B');
    const t = nodesOfType(ast, 'text')[0];
    t.value = 'A&B'; // same content as parsed
    expect(sourceMap.getSourceRange(t, 1, 2).start.offset).toBe(1);
    expect(sourceMap.getRaw(t)).toBe('A&amp;B');
  });

  test('unavailable nodes throw SourceMapUnavailableError with a stable code', () => {
    const first = parseMdWithSourceMap('AAAA');
    const second = parseMdWithSourceMap('BBBB');
    const cases: Array<() => unknown> = [
      // foreign node from another document
      () => first.sourceMap.getRaw(second.ast.children[0]),
      () =>
        first.sourceMap.getSourceRange(
          second.ast.children[0].children[0],
          0,
          1,
        ),
      // owned but not a supported text node
      () => first.sourceMap.getSourceRange(first.ast.children[0] as any, 0, 1),
    ];
    for (const fn of cases) {
      const err = thrown(fn);
      expect(err).toBeInstanceOf(SourceMapUnavailableError);
      expect(err).toBeInstanceOf(SourceMapError);
      expect(err).toBeInstanceOf(RangeError);
      expect(err.code).toBe('ERR_SOURCE_MAP_UNAVAILABLE');
    }
  });

  test('rejects a text node added after parsing', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('hello');
    const paragraph = ast.children[0] as any;

    // A node pushed into the tree after parsing is not in the source map,
    // even when it carries a position that looks legitimate. The map must
    // not accept it just because a plausible position exists.
    const generated = {
      type: 'text',
      value: 'generated',
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 6, offset: 5 },
      },
    };
    paragraph.children.push(generated);

    const rangeError = thrown(() =>
      sourceMap.getSourceRange(generated, 0, generated.value.length),
    );
    expect(rangeError).toBeInstanceOf(SourceMapUnavailableError);
    expect(rangeError.code).toBe('ERR_SOURCE_MAP_UNAVAILABLE');

    const rawError = thrown(() => sourceMap.getRaw(generated));
    expect(rawError).toBeInstanceOf(SourceMapUnavailableError);
    expect(rawError.code).toBe('ERR_SOURCE_MAP_UNAVAILABLE');
  });

  test('caller argument errors stay plain RangeError (not SourceMapError)', () => {
    const { ast, sourceMap } = parseMdWithSourceMap('ab');
    const t = nodesOfType(ast, 'text')[0];
    const cases: Array<() => unknown> = [
      () => sourceMap.getSourceRange(t, 0, 99), // out of bounds
      () => sourceMap.getSourceRange(t, 0.5, 1), // non-integer
      () => sourceMap.getSourceRange(t, 2, 1), // reversed
    ];
    for (const fn of cases) {
      const err = thrown(fn);
      expect(err).toBeInstanceOf(RangeError);
      expect(err).not.toBeInstanceOf(SourceMapError);
    }
    // An empty range inside a multi-code-unit atomic construct is also a
    // caller-facing range error, not a mapping availability problem.
    const afr = parseMdWithSourceMap('&Afr;');
    const tAfr = nodesOfType(afr.ast, 'text')[0];
    const err = thrown(() => afr.sourceMap.getSourceRange(tAfr, 1, 1));
    expect(err).toBeInstanceOf(RangeError);
    expect(err).not.toBeInstanceOf(SourceMapError);
  });

  test('maps from two parses stay isolated and each serves its own nodes', () => {
    const a = parseMdWithSourceMap('A&amp;B');
    const b = parseMdWithSourceMap('C&amp;D');
    const tA = nodesOfType(a.ast, 'text')[0];
    const tB = nodesOfType(b.ast, 'text')[0];
    expect(a.sourceMap.getRaw(tA)).toBe('A&amp;B');
    expect(b.sourceMap.getRaw(tB)).toBe('C&amp;D');
    expect(a.sourceMap.getSourceRange(tA, 0, 3).end.offset).toBe(7);
    expect(b.sourceMap.getSourceRange(tB, 0, 3).end.offset).toBe(7);
  });
});

describe('parseMdWithSourceMap: range resolution regression matrix', () => {
  interface RangeResolutionCase {
    name: string
    run: () => any
    error?: {
      name: string
      message: string
    }
    offsets?: readonly [number, number]
  }

  const cases: RangeResolutionCase[] = [
    {
      name: 'invalid index takes priority over an unsupported mapping',
      run: () => {
        const { ast, sourceMap } = parseMdWithSourceMap('hello');
        return sourceMap.getSourceRange(ast.children[0] as any, 0.5, 1);
      },
      error: {
        name: 'RangeError',
        message: 'getSourceRange: valueStart and valueEnd must be finite integers, got [0.5, 1)',
      },
    },
    {
      name: 'a modified node takes priority over an out-of-bounds range',
      run: () => {
        const { ast, sourceMap } = parseMdWithSourceMap('hello');
        const node = nodesOfType(ast, 'text')[0];
        node.value = 'changed';
        return sourceMap.getSourceRange(node, 0, 99);
      },
      error: {
        name: 'SourceMapConsistencyError',
        message: 'the mapped node has been modified since parsing; the source map only covers the original parsed value',
      },
    },
    {
      name: 'an empty range inside an atomic segment stays invalid',
      run: () => {
        const { ast, sourceMap } = parseMdWithSourceMap('&Afr;');
        return sourceMap.getSourceRange(nodesOfType(ast, 'text')[0], 1, 1);
      },
      error: {
        name: 'RangeError',
        message: 'getSourceRange: empty range falls inside an atomic construct (escape / character reference / normalization) where no accurate source boundary exists',
      },
    },
    {
      name: 'a text range crossing a source gap stays invalid',
      run: () => {
        const { ast, sourceMap } = parseMdWithSourceMap('> hello\n> world');
        const node = nodesOfType(ast, 'text')[0];
        return sourceMap.getSourceRange(node, 0, node.value.length);
      },
      error: {
        name: 'RangeError',
        message: 'getSourceRange: value range crosses non-contiguous source segments',
      },
    },
    {
      name: 'an empty URL resolves to its destination boundary',
      run: () => {
        const { ast, sourceMap } = parseMdWithSourceMap('[link]()');
        const node = nodesOfType(ast, 'link')[0];
        return sourceMap.getFieldSourceRange(node, 'url', 0, 0);
      },
      offsets: [7, 7],
    },
  ];

  test.each(cases)('$name', ({ run, error, offsets }) => {
    if (error) {
      expect(run).toThrow(expect.objectContaining(error));
      return;
    }
    const range = run();
    expect([range.start.offset, range.end.offset]).toEqual(offsets);
  });
});
