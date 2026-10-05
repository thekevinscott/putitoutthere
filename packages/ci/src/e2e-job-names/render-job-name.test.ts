import { describe, expect, it } from 'vitest';

import { renderJobName } from './render-job-name.js';

const ROW = {
  kind: 'npm',
  build: 'napi',
  target: 'x86_64-apple-darwin',
  artifact_path: 'packages/ts/build/napi-x86_64-apple-darwin',
  bundle_cli: { bin: 'piot-fixture' },
  retries: 3,
  verbose: true,
  skipped: null,
} as const;

describe('renderJobName', () => {
  it('substitutes a single bare matrix reference', () => {
    expect(renderJobName('build (${{ matrix.kind }})', ROW)).toBe('build (npm)');
  });

  it('substitutes every reference in the template, not just the first', () => {
    expect(
      renderJobName('build (${{ matrix.kind }}, ${{ matrix.build }}, ${{ matrix.target }})', ROW),
    ).toBe('build (npm, napi, x86_64-apple-darwin)');
  });

  it('leaves the literal text around the references untouched', () => {
    expect(renderJobName('build ${{ matrix.kind }} @ ${{ matrix.target }}!', ROW)).toBe(
      'build npm @ x86_64-apple-darwin!',
    );
  });

  it('renders a field the row does not carry as the empty string, as GitHub does', () => {
    expect(renderJobName('build (${{ matrix.python_version }})', ROW)).toBe('build ()');
  });

  it('renders an explicitly null field as the empty string too', () => {
    expect(renderJobName('build (${{ matrix.skipped }})', ROW)).toBe('build ()');
  });

  it('stringifies a numeric field rather than dropping it', () => {
    expect(renderJobName('build (${{ matrix.retries }})', ROW)).toBe('build (3)');
  });

  it('stringifies a boolean field rather than dropping it', () => {
    expect(renderJobName('build (${{ matrix.verbose }})', ROW)).toBe('build (true)');
  });

  it('resolves a dotted path into a nested field', () => {
    expect(renderJobName('build (${{ matrix.bundle_cli.bin }})', ROW)).toBe('build (piot-fixture)');
  });

  it('renders a dotted path through a non-object as the empty string rather than throwing', () => {
    expect(renderJobName('build (${{ matrix.kind.nope }})', ROW)).toBe('build ()');
  });

  // `matrix.kind.nope` above misses on *any* guard, so it does not pin the
  // object test down: a guard narrowed to `!== null` reads a string's own
  // members happily. `'npm'.length` is a real property, so without the
  // `typeof === 'object'` half this renders `3`. A string's intrinsics are not
  // fields the row carries.
  it('renders a dotted path onto a string intrinsic as empty, not the intrinsic', () => {
    expect(renderJobName('build (${{ matrix.kind.length }})', ROW)).toBe('build ()');
  });

  // `typeof null === 'object'`, so walking past a null segment has to be
  // guarded separately or the property read throws a TypeError that surfaces
  // as "the workflow is broken" instead of an empty slot.
  it('renders a dotted path through a null segment as the empty string rather than throwing', () => {
    expect(renderJobName('build (${{ matrix.skipped.deeper }})', ROW)).toBe('build ()');
  });

  it('tolerates missing whitespace inside the interpolation', () => {
    expect(renderJobName('build (${{matrix.kind}})', ROW)).toBe('build (npm)');
  });

  it('returns a template with no interpolation unchanged', () => {
    expect(renderJobName('publish', ROW)).toBe('publish');
  });

  // GitHub renders an object slot as the opaque string `Object`, which is a
  // name nobody can read and two different objects share. A slot that lands
  // on a mapping is a mistake in the template, not a value to coerce.
  it('refuses a path that resolves to a mapping rather than coercing it', () => {
    expect(() => renderJobName('build (${{ matrix.bundle_cli }})', ROW)).toThrow(
      'renderJobName: ${{ matrix.bundle_cli }} resolves to a object, not a JSON scalar, so what it renders is not predictable',
    );
  });

  // Each of these renders correctly on GitHub and is still rejected: the name
  // has to be resolvable by substitution alone, with no expression evaluator
  // and no context beyond the matrix row (#660).
  it.each([
    ['a caller input, which does not propagate into a called workflow', '${{ inputs.fixture }}'],
    ['the conditional slot form', "${{ matrix.build && format(' {0}', matrix.build) || '' }}"],
    ['a negation', '${{ !matrix.kind }}'],
    ['a comparison', "${{ matrix.kind == 'npm' }}"],
    ['a github context read', '${{ github.run_id }}'],
    ['a needs-output read', '${{ needs.plan.outputs.matrix }}'],
    ['a bare matrix object', '${{ matrix }}'],
    ['a hyphenated path, which GitHub parses as subtraction', '${{ matrix.run-id }}'],
    ['an empty interpolation', '${{ }}'],
    // Anchored at the start, so a context that merely *contains* `matrix.`
    // is not silently read as the matrix itself.
    ['a path that only contains a matrix lookup', '${{ github.matrix.kind }}'],
  ])('refuses %s', (_why, interpolation) => {
    expect(() => renderJobName(`build ${interpolation}`, ROW)).toThrow(
      `renderJobName: ${interpolation} is not a bare \`matrix.<path>\` reference, so no check-name predictor can resolve it`,
    );
  });

  it('refuses the unresolvable slot even when a resolvable one precedes it', () => {
    expect(() => renderJobName('build ${{ matrix.kind }} ${{ inputs.fixture }}', ROW)).toThrow(
      'is not a bare `matrix.<path>` reference',
    );
  });
});
