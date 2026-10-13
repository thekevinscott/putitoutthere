import { collectBinsFromManifest } from './collect-bins-from-manifest.js';
import { readToml } from './read-toml.js';
import { workspaceMemberManifests } from './workspace-member-manifests.js';

export async function readDeclaredBinNames(
  cargoToml: Record<string, unknown>,
  cargoTomlPath: string,
): Promise<string[]> {
  const result = collectBinsFromManifest(cargoToml);
  // Workspace manifests delegate [[bin]] declarations to member crates
  // (#337). `cargo build --bin X` from anywhere in the workspace
  // resolves X transparently, so a check that only reads the
  // workspace-root manifest reports bins as missing even when they
  // exist in a member.
  for (const memberManifest of await workspaceMemberManifests(cargoToml, cargoTomlPath)) {
    const memberParsed = await readToml(memberManifest);
    if (memberParsed === null) {continue;}
    for (const b of collectBinsFromManifest(memberParsed)) {
      if (!result.includes(b)) {result.push(b);}
    }
  }
  return result;
}
