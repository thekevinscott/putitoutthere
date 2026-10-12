import type { TargetEntry } from '../types.js';
import type { NpmBuildField } from './npm-platform.js';

export type NpmPkg = {
  name: string;
  path: string;
  npm?: string;
  access?: 'public' | 'restricted';
  tag?: string;
  // #dirsql: `build` accepts a single mode string ("napi" / "bundled-cli")
  // for backward compat, OR an array of entries — strings or
  // `{ mode, name }` objects — to publish multiple platform-package
  // families per main package. See src/handlers/npm-platform.ts.
  build?: NpmBuildField;
  // #159: `targets` entries can be bare triples or `{ triple, runner }`
  // objects. Only the triple matters at publish time; the `runner`
  // override is a CI-matrix concern consumed by the planner.
  targets?: readonly TargetEntry[];
};

export function npmNameFor(pkg: NpmPkg): string {
  return pkg.npm ?? pkg.name;
}
