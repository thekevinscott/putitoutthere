import { join } from 'node:path';

import type { Package } from './config.js';
import { readJson } from './read-json.js';
import { readToml } from './read-toml.js';

export interface DeclaredRepoUrl {
  url: string;
  manifestPath: string;
}

export async function readDeclaredRepoUrl(p: Package): Promise<DeclaredRepoUrl | null> {
  switch (p.kind) {
    case 'npm': {
      const manifestPath = join(p.path, 'package.json');
      const parsed = await readJson(manifestPath);
      if (parsed === null) {return null;}
      const repository = (parsed as { repository?: unknown }).repository;
      if (typeof repository === 'string' && repository.trim().length > 0) {
        return { url: repository.trim(), manifestPath };
      }
      if (repository !== null && typeof repository === 'object') {
        const url = (repository as { url?: unknown }).url;
        if (typeof url === 'string' && url.trim().length > 0) {
          return { url: url.trim(), manifestPath };
        }
      }
      return null;
    }
    case 'crates': {
      const manifestPath = join(p.path, 'Cargo.toml');
      const parsed = await readToml(manifestPath);
      if (parsed === null) {return null;}
      const pkgTable = (parsed.package ?? {}) as Record<string, unknown>;
      const repo = pkgTable.repository;
      if (typeof repo === 'string' && repo.trim().length > 0) {
        return { url: repo.trim(), manifestPath };
      }
      return null;
    }
    case 'pypi': {
      const manifestPath = join(p.path, 'pyproject.toml');
      const parsed = await readToml(manifestPath);
      if (parsed === null) {return null;}
      const project = (parsed.project ?? {}) as Record<string, unknown>;
      const urls = (project.urls ?? {}) as Record<string, unknown>;
      for (const key of ['Repository', 'repository', 'Source', 'source', 'Homepage', 'homepage']) {
        const candidate = urls[key];
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          return { url: candidate.trim(), manifestPath };
        }
      }
      return null;
    }
  }
}
