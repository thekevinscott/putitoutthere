import { describe, expect, it } from 'vitest';

import { unresolvableSlots } from './unresolvable-slots.js';

const ROW = {
  kind: 'pypi',
  target: 'x86_64-unknown-linux-gnu',
  artifact_path: 'dist',
  python_version: '3.12',
  manylinux: false,
  nested: { leaf: 'deep' },
  blank: '',
  nulled: null,
} as const;

describe('unresolvableSlots', () => {
  it('reports nothing when every slot is a field the row carries', () => {
    expect(unresolvableSlots('build (${{ matrix.kind }}, ${{ matrix.target }})', ROW)).toEqual([]);
  });

  it('reports a slot whose field the row omits', () => {
    expect(unresolvableSlots('build (${{ matrix.rust_target }})', ROW)).toEqual([
      '${{ matrix.rust_target }}',
    ]);
  });

  // The regression this function exists for: one added slot, 53 names lost.
  it('reports only the omitted slot out of a name whose other slots resolve', () => {
    expect(
      unresolvableSlots(
        'build (${{ matrix.kind }}, ${{ matrix.target }}, ${{ matrix.python_version }}, ${{ matrix.artifact_path }})',
        { kind: 'npm', target: 'noarch', artifact_path: 'package.json' },
      ),
    ).toEqual(['${{ matrix.python_version }}']);
  });

  it('reports every omitted slot, in template order', () => {
    expect(
      unresolvableSlots('${{ matrix.bundle_cli }}-${{ matrix.kind }}-${{ matrix.build }}', ROW),
    ).toEqual(['${{ matrix.bundle_cli }}', '${{ matrix.build }}']);
  });

  it('accepts an empty string as a value the row supplies', () => {
    expect(unresolvableSlots('${{ matrix.blank }}', ROW)).toEqual([]);
  });

  // GitHub and willfire agree that an explicit null renders empty; the field
  // is present, so the lookup is not a miss.
  it('accepts an explicit null as a value the row supplies', () => {
    expect(unresolvableSlots('${{ matrix.nulled }}', ROW)).toEqual([]);
  });

  it('accepts a false boolean rather than treating it as absent', () => {
    expect(unresolvableSlots('${{ matrix.manylinux }}', ROW)).toEqual([]);
  });

  it('walks a dotted path into a nested field', () => {
    expect(unresolvableSlots('${{ matrix.nested.leaf }}', ROW)).toEqual([]);
  });

  it('reports a dotted path whose final segment is missing', () => {
    expect(unresolvableSlots('${{ matrix.nested.absent }}', ROW)).toEqual([
      '${{ matrix.nested.absent }}',
    ]);
  });

  it('reports a dotted path that tunnels through a non-object', () => {
    expect(unresolvableSlots('${{ matrix.kind.deeper }}', ROW)).toEqual([
      '${{ matrix.kind.deeper }}',
    ]);
  });

  // `matrix.kind.deeper` above misses on *any* guard, so it does not pin the
  // object test down: a guard narrowed to `!== null` reads a string's own
  // members happily. `'pypi'.length` is a real property, so without the
  // `typeof === 'object'` half this slot is reported resolvable — and willfire,
  // which only substitutes row fields, would still drop the name.
  it('reports a dotted path onto a string intrinsic rather than resolving it', () => {
    expect(unresolvableSlots('${{ matrix.kind.length }}', ROW)).toEqual([
      '${{ matrix.kind.length }}',
    ]);
  });

  // The pattern is anchored at *both* ends. The `matrix.build && ...` case
  // below cannot show why the trailing anchor matters, because `build` is
  // absent from the row, so the slot is reported either way. Here the prefix
  // resolves: drop the `$` and `matrix.kind` matches, `'pypi'` comes back, and
  // the slot looks fine. willfire substitutes the whole body or nothing.
  it('reports an expression whose leading matrix lookup would resolve on its own', () => {
    expect(unresolvableSlots("${{ matrix.kind && 'x' }}", ROW)).toEqual([
      "${{ matrix.kind && 'x' }}",
    ]);
  });

  // `typeof null === 'object'`, so a null segment must be rejected explicitly
  // rather than indexed into.
  it('reports a dotted path that tunnels through a null', () => {
    expect(unresolvableSlots('${{ matrix.nulled.deeper }}', ROW)).toEqual([
      '${{ matrix.nulled.deeper }}',
    ]);
  });

  it('reports a slot that is not a matrix lookup at all', () => {
    expect(unresolvableSlots('publish (${{ inputs.fixture }})', ROW)).toEqual([
      '${{ inputs.fixture }}',
    ]);
  });

  it.each([
    ['a conditional expression', "${{ matrix.build && format(' {0}', matrix.build) || '' }}"],
    ['a function call', '${{ format(   {0}   , matrix.kind) }}'],
    ['a github context read', '${{ github.run_id }}'],
    ['a path that only contains a matrix lookup', '${{ github.matrix.kind }}'],
    ['an index expression', '${{ matrix[0] }}'],
    ['an empty body', '${{}}'],
  ])('reports %s as unresolvable', (_label, template) => {
    expect(unresolvableSlots(template, ROW)).toEqual([template]);
  });

  it('reports nothing for a template with no interpolation', () => {
    expect(unresolvableSlots('publish', ROW)).toEqual([]);
  });

  it('tolerates whitespace around the matrix path', () => {
    expect(unresolvableSlots('${{matrix.kind}} ${{   matrix.target   }}', ROW)).toEqual([]);
  });

  it('resolves a single-character field name', () => {
    expect(unresolvableSlots('${{ matrix.k }}', { k: 'ok' })).toEqual([]);
  });
});
