import { describe, expect, it } from 'vitest';

import { parseJobNameTemplates } from './parse-job-name-templates.js';

describe('parseJobNameTemplates', () => {
  it('returns the declared name for a job that has one', () => {
    const templates = parseJobNameTemplates(
      ['jobs:', '  build:', '    name: build (${{ matrix.kind }})', '    runs-on: ubuntu-latest'].join('\n'),
    );

    expect(templates.get('build')).toBe('build (${{ matrix.kind }})');
  });

  it('returns null for a job that declares no name, so the caller can tell it apart from one that does', () => {
    const templates = parseJobNameTemplates(
      ['jobs:', '  publish:', '    runs-on: ubuntu-latest'].join('\n'),
    );

    expect(templates.get('publish')).toBeNull();
  });

  it('keeps every job, in declaration order, so a caller can assert the job set it covered', () => {
    const templates = parseJobNameTemplates(
      [
        'jobs:',
        '  plan:',
        '    runs-on: ubuntu-latest',
        '  build:',
        '    name: build x',
        '    runs-on: ubuntu-latest',
        '  publish:',
        '    runs-on: ubuntu-latest',
      ].join('\n'),
    );

    expect([...templates]).toEqual([
      ['plan', null],
      ['build', 'build x'],
      ['publish', null],
    ]);
  });

  it('ignores a step-level name, reading only the job-level one', () => {
    const templates = parseJobNameTemplates(
      [
        'jobs:',
        '  build:',
        '    name: the job name',
        '    steps:',
        '      - name: the step name',
        '        run: true',
      ].join('\n'),
    );

    expect(templates.get('build')).toBe('the job name');
  });

  it('treats a non-string name as undeclared rather than stringifying it', () => {
    const templates = parseJobNameTemplates(['jobs:', '  build:', '    name: 42'].join('\n'));

    expect(templates.get('build')).toBeNull();
  });

  it('treats a job with no body at all as undeclared', () => {
    const templates = parseJobNameTemplates(['jobs:', '  build:'].join('\n'));

    expect(templates.get('build')).toBeNull();
  });

  it('throws when the document carries no jobs key', () => {
    expect(() => parseJobNameTemplates('on:\n  pull_request:\n')).toThrow(
      'parseJobNameTemplates: workflow declares no `jobs:` mapping',
    );
  });

  it('throws when jobs is present but null', () => {
    expect(() => parseJobNameTemplates('jobs:\n')).toThrow(
      'parseJobNameTemplates: workflow declares no `jobs:` mapping',
    );
  });

  it('throws when jobs is a sequence rather than a mapping', () => {
    expect(() => parseJobNameTemplates('jobs:\n  - build\n')).toThrow(
      'parseJobNameTemplates: workflow declares no `jobs:` mapping',
    );
  });

  it('throws when jobs is a scalar rather than a mapping', () => {
    expect(() => parseJobNameTemplates('jobs: build\n')).toThrow(
      'parseJobNameTemplates: workflow declares no `jobs:` mapping',
    );
  });

  it('throws when the document itself is empty', () => {
    expect(() => parseJobNameTemplates('')).toThrow(
      'parseJobNameTemplates: workflow declares no `jobs:` mapping',
    );
  });
});
