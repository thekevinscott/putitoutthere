export type Installer = 'npm' | 'pnpm' | 'none';

export interface NpmBuildPackageOptions {
  dir: string;
  boundary: string;
  target: string;
  build: string;
  version: string;
}

export interface NpmBuildRow {
  kind: string;
  path: string;
  version: string;
}
