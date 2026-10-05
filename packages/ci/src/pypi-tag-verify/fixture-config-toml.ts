/**
 * The throwaway `putitoutthere.toml` the e2e tag job reconciles against.
 *
 * The real fixture configs never reach the caller level — `e2e-fixture-job.yml`
 * materializes them on the build runners and uploads only `dist/` — so the tag
 * job writes a config naming exactly the projects the upload shipped.
 * `reconcile --expect` reads nothing else off it: no manifest, no preflight,
 * no glob walk. `tag_format` is left at its default so the tag it cuts is the
 * `{name}-v{version}` the expectation already carries.
 */

import type { UploadedExpectation } from './uploaded-expectations.js';

export function fixtureConfigToml(expectations: readonly UploadedExpectation[]): string {
  const packages = expectations.map(({ name }) =>
    ['[[package]]', `name = "${name}"`, 'kind = "pypi"', 'path = "."', 'globs = ["**"]', ''].join(
      '\n',
    ),
  );
  return ['[putitoutthere]', 'version = 1', '', ...packages].join('\n');
}
