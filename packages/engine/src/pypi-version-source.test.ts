import { describe, expect, it } from 'vitest';

import { classifyPypiVersionSource } from './pypi-version-source.js';

describe('classifyPypiVersionSource (#696)', () => {
  describe('reachable shapes', () => {
    it('accepts hatch-vcs when the plugin is declared', () => {
      expect(
        classifyPypiVersionSource(
          { requires: ['hatchling', 'hatch-vcs>=0.4'] },
          { hatch: { version: { source: 'vcs' } } },
        ),
      ).toEqual({ reachable: true });
    });

    it('accepts setuptools-scm when the plugin is declared', () => {
      expect(
        classifyPypiVersionSource(
          { requires: ['setuptools>=61', 'setuptools_scm>=8'] },
          { setuptools_scm: {} },
        ),
      ).toEqual({ reachable: true });
    });

    it('accepts setuptools-scm even when a path-based hatch table is also present', () => {
      // setuptools-scm is checked first on purpose: it is the backend that
      // actually computes the version, so a stray hatch table alongside it
      // must not downgrade the verdict to unreachable.
      const verdict = classifyPypiVersionSource(
        { requires: ['setuptools', 'setuptools-scm'] },
        { setuptools_scm: {}, hatch: { version: { path: 'src/pkg/_version.py' } } },
      );
      expect(verdict.reachable).toBe(true);
    });
  });

  describe('PIOT_PYPI_HATCH_VERSION_PATH — the source is a file nothing rewrites', () => {
    it('rejects a bare path (hatchling implicit regex source)', () => {
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling'] },
        { hatch: { version: { path: 'src/pkg/_version.py' } } },
      );
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_HATCH_VERSION_PATH',
      });
    });

    it('names the declared path so the consumer can find the file', () => {
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling'] },
        { hatch: { version: { path: 'src/pkg/_version.py' } } },
      );
      expect(verdict.reachable).toBe(false);
      expect(verdict.reachable === false && verdict.detail).toContain('src/pkg/_version.py');
    });

    it('points at the fix rather than only naming the fault', () => {
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling'] },
        { hatch: { version: { path: 'src/pkg/_version.py' } } },
      );
      expect(verdict.reachable === false && verdict.detail).toMatch(/source\s*=\s*"vcs"/);
    });

    it('still rejects a path source when setuptools-scm is in requires but unconfigured', () => {
      // A declared plugin with no [tool.setuptools_scm] table does not make
      // the hatch path source reachable: hatchling is the backend here, and
      // it reads the file regardless of what setuptools has installed.
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling', 'setuptools-scm>=8'] },
        { hatch: { version: { path: 'src/pkg/_version.py' } } },
      );
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_HATCH_VERSION_PATH',
      });
    });

    it('rejects source = "code", which imports a file release steps do not touch', () => {
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling'] },
        { hatch: { version: { source: 'code', path: 'build/version.py' } } },
      );
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_HATCH_VERSION_PATH',
      });
    });

    it('rejects a hatch version table with no path at all', () => {
      const verdict = classifyPypiVersionSource({ requires: ['hatchling'] }, { hatch: { version: {} } });
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_HATCH_VERSION_PATH',
      });
      expect(verdict.reachable === false && verdict.detail).toContain('(no path declared)');
    });

    it('does not interpolate a non-string path into the detail', () => {
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling'] },
        { hatch: { version: { path: 42 } } },
      );
      expect(verdict.reachable === false && verdict.detail).toContain('(no path declared)');
      expect(verdict.reachable === false && verdict.detail).not.toContain('42');
    });
  });

  describe('PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND — the plugin is missing', () => {
    it('rejects source = "vcs" when hatch-vcs is absent from requires', () => {
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling'] },
        { hatch: { version: { source: 'vcs' } } },
      );
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
      });
      expect(verdict.reachable === false && verdict.detail).toContain('hatch-vcs');
    });

    it('rejects source = "vcs" when [build-system] declares no requires', () => {
      const verdict = classifyPypiVersionSource({}, { hatch: { version: { source: 'vcs' } } });
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
      });
    });

    it('rejects [tool.setuptools_scm] when setuptools-scm is absent from requires', () => {
      const verdict = classifyPypiVersionSource({ requires: ['setuptools'] }, { setuptools_scm: {} });
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
      });
      expect(verdict.reachable === false && verdict.detail).toContain('setuptools-scm');
    });

    it('rejects a [tool] table with no version source at all', () => {
      const verdict = classifyPypiVersionSource({ requires: ['hatchling'] }, {});
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
      });
      expect(verdict.reachable === false && verdict.detail).toContain('[tool.hatch.version]');
    });
  });

  describe('malformed tables degrade to the missing-backend verdict', () => {
    it.each([
      ['a non-table [tool.hatch]', { hatch: 'hatchling' }],
      ['a non-table [tool.hatch.version]', { hatch: { version: 'dynamic' } }],
      ['a null [tool.hatch.version]', { hatch: { version: null } }],
      ['an array-of-tables [[tool.hatch.version]]', { hatch: { version: [{ source: 'vcs' }] } }],
      ['a non-table [tool.setuptools_scm]', { setuptools_scm: true }],
      ['an array-of-tables [[tool.setuptools_scm]]', { setuptools_scm: [{}] }],
    ])('treats %s as no source', (_label, tool) => {
      const verdict = classifyPypiVersionSource(
        { requires: ['hatchling', 'hatch-vcs', 'setuptools-scm'] },
        tool,
      );
      expect(verdict).toMatchObject({
        reachable: false,
        code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
      });
    });
  });
});
