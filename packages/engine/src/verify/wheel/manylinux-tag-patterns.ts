/**
 * #610: map a config `manylinux` baseline to the platform-tag substrings
 * a compliant wheel filename may carry. maturin emits PEP 600 tags
 * (`manylinux_2_28`) and, for the legacy aliases, sometimes both the
 * alias and its PEP 600 equivalent — accept either. `auto` (or no
 * baseline) returns no patterns: the tag is whatever the build
 * environment produced, so there is nothing to assert.
 */
export function manylinuxTagPatterns(manylinux: string | undefined): string[] {
  if (manylinux === undefined || manylinux === '' || manylinux === 'auto') {
    return [];
  }
  switch (manylinux) {
    case '1':
      return ['manylinux1_', 'manylinux_2_5_'];
    case '2010':
      return ['manylinux2010_', 'manylinux_2_12_'];
    case '2014':
      return ['manylinux2014_', 'manylinux_2_17_'];
    default:
      // `2_XX` glibc baselines and `musllinux_X_Y` tags are already in
      // PEP 600 / PEP 656 form.
      return manylinux.startsWith('musllinux_') ? [`${manylinux}_`] : [`manylinux_${manylinux}_`];
  }
}
