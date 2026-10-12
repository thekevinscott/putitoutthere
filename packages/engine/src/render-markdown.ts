import type { FailureContext } from './verbose-types.js';

export function renderMarkdown(err: Error, ctx: FailureContext): string {
  const lines: string[] = [];
  lines.push(`## ❌ ${ctx.handler}/${ctx.package} failed`);
  lines.push('');
  lines.push(`**Error.** ${err.message}`);
  lines.push(`**Exit code.** \`${ctx.exitCode}\``);
  lines.push('');
  lines.push('**Command**');
  lines.push('```');
  lines.push(ctx.command.join(' '));
  lines.push('```');

  if (ctx.toolVersions && Object.keys(ctx.toolVersions).length > 0) {
    lines.push('');
    lines.push('**Tool versions**');
    lines.push('```');
    for (const [k, v] of Object.entries(ctx.toolVersions)) {
      lines.push(`${k}: ${v}`);
    }
    lines.push('```');
  }

  lines.push('');
  lines.push('**stdout**');
  lines.push('```');
  lines.push(ctx.stdout || '(empty)');
  lines.push('```');

  lines.push('');
  lines.push('**stderr**');
  lines.push('```');
  lines.push(ctx.stderr || '(empty)');
  lines.push('```');

  if (ctx.extras && Object.keys(ctx.extras).length > 0) {
    lines.push('');
    lines.push('**Handler extras**');
    lines.push('```json');
    lines.push(JSON.stringify(ctx.extras, null, 2));
    lines.push('```');
  }

  lines.push('');
  return lines.join('\n');
}
