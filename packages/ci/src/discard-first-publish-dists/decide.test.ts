import { expect, it } from 'vitest';

import { droppedWarning, isFirstPublishArtifact } from './decide.js';

it.each([
  ['piot_fixture_zzz_py_placeholder-0.1.0.tar.gz', true],
  ['piot-fixture-zzz-py-placeholder-0.1.0.tar.gz', true],
  ['piot_fixture_zzz_hatch-1.2.3.tar.gz', false],
  ['placeholder-notes.txt', false],
])('isFirstPublishArtifact(%s) is %s', (name, expected) => {
  expect(isFirstPublishArtifact(name)).toBe(expected);
});

it('names the dropped count in the warning', () => {
  expect(droppedWarning(2)).toMatch(/^::warning::Dropped 2 first-publish artifact\(s\) from dist\/ — /);
});
