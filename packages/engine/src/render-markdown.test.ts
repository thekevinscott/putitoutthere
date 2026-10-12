import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './render-markdown.js';
import type { FailureContext } from './verbose-types.js';

function ctx(over: Partial<FailureContext> = {}): FailureContext {
  return {
    package: 'demo',
    handler: 'crates',
    command: ['cargo', 'publish'],
    stdout: 'some output',
    stderr: 'some error',
    exitCode: 1,
    ...over,
  };
}

const CORE = [
  '## ❌ crates/demo failed',
  '',
  '**Error.** boom',
  '**Exit code.** `1`',
  '',
  '**Command**',
  '```',
  'cargo publish',
  '```',
];

const STREAMS = [
  '',
  '**stdout**',
  '```',
  'some output',
  '```',
  '',
  '**stderr**',
  '```',
  'some error',
  '```',
];

describe('renderMarkdown', () => {
  it('renders header, error, exit code, command and both streams', () => {
    expect(renderMarkdown(new Error('boom'), ctx())).toBe([...CORE, ...STREAMS, ''].join('\n'));
  });

  it('renders a tool-versions block between command and streams', () => {
    const md = renderMarkdown(
      new Error('boom'),
      ctx({ toolVersions: { cargo: 'cargo 1.78.0', rustc: 'rustc 1.78.0' } }),
    );
    expect(md).toBe(
      [
        ...CORE,
        '',
        '**Tool versions**',
        '```',
        'cargo: cargo 1.78.0',
        'rustc: rustc 1.78.0',
        '```',
        ...STREAMS,
        '',
      ].join('\n'),
    );
  });

  it('omits the tool-versions block when versions are empty', () => {
    expect(renderMarkdown(new Error('boom'), ctx({ toolVersions: {} }))).not.toContain('Tool versions');
  });

  it('renders "(empty)" for blank stdout and stderr', () => {
    const md = renderMarkdown(new Error('boom'), ctx({ stdout: '', stderr: '' }));
    expect(md).toContain('**stdout**\n```\n(empty)\n```');
    expect(md).toContain('**stderr**\n```\n(empty)\n```');
  });

  it('renders extras as indented JSON after the streams', () => {
    const md = renderMarkdown(new Error('boom'), ctx({ extras: { wheelTags: ['cp310-linux'] } }));
    expect(md).toBe(
      [
        ...CORE,
        ...STREAMS,
        '',
        '**Handler extras**',
        '```json',
        '{\n  "wheelTags": [\n    "cp310-linux"\n  ]\n}',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('omits the extras block when extras are empty', () => {
    expect(renderMarkdown(new Error('boom'), ctx({ extras: {} }))).not.toContain('Handler extras');
  });
});
