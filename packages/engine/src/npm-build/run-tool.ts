import { execInherit, type ExecInheritOptions } from '../utils/exec-inherit.js';

export function toolArgv(tool: string, args: readonly string[], platform: NodeJS.Platform): [string, string[]] {
  return platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', tool, ...args]] : [tool, [...args]];
}

export async function runTool(tool: string, args: readonly string[], opts: ExecInheritOptions): Promise<void> {
  const [cmd, argv] = toolArgv(tool, args, process.platform);
  await execInherit(cmd, argv, opts);
}
