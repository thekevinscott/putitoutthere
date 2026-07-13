/**
 * Pins the cargo-http-registry diagnostic dump byte-for-byte against the
 * "Diagnostic dump (cargo-http-registry)" bash: three `::group::`/`::endgroup::`
 * sections, raw `cat` bytes concatenated verbatim, and the `(no log)` /
 * `(no config.toml)` fallbacks. Pure.
 */

import { describe, expect, it } from 'vitest';

import { diagnoseOutput } from './diagnose-output.js';

describe('diagnoseOutput', () => {
  it('concatenates raw log + probe + config bytes verbatim inside the groups', () => {
    expect(
      diagnoseOutput({
        logRaw: 'listening on 127.0.0.1:35503\n',
        probeRaw: 'GET /git/info/refs?service=git-upload-pack -> 200\n',
        configRaw: '\n[net]\ngit-fetch-with-cli = true\n',
      }),
    ).toBe(
      '::group::cargo-http-registry log\n' +
        'listening on 127.0.0.1:35503\n' +
        '::endgroup::\n' +
        '::group::endpoint probe\n' +
        'GET /git/info/refs?service=git-upload-pack -> 200\n' +
        '::endgroup::\n' +
        '::group::~/.cargo/config.toml\n' +
        '\n[net]\ngit-fetch-with-cli = true\n' +
        '::endgroup::\n',
    );
  });

  it('uses (no log) / (no config.toml) fallbacks when files are absent', () => {
    expect(diagnoseOutput({ logRaw: null, probeRaw: '', configRaw: null })).toBe(
      '::group::cargo-http-registry log\n' +
        '(no log)\n' +
        '::endgroup::\n' +
        '::group::endpoint probe\n' +
        '::endgroup::\n' +
        '::group::~/.cargo/config.toml\n' +
        '(no config.toml)\n' +
        '::endgroup::\n',
    );
  });
});
