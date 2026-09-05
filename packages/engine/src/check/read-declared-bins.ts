import { collectBinsFromManifest } from './collect-bins-from-manifest.js';
import { parseCargoToml } from './parse-cargo-toml.js';
import { workspaceMemberManifests } from './workspace-member-manifests.js';

export async function readDeclaredBins(cargoTomlPath: string): Promise<string[]> {
  const parsed = await parseCargoToml(cargoTomlPath);
  if (parsed === null) {return [];}
  const result = collectBinsFromManifest(parsed);
  // Workspace manifests delegate [[bin]] declarations to member crates
  // (#337). `cargo build --bin X` from anywhere in the workspace
  // resolves X transparently, so a check that only reads the
  // workspace-root manifest reports bins as missing even when they
  // exist in a member. Walk `[workspace].members` so `crate_path = "."`
  // (the default) satisfies the standard cargo-workspace shape.
  // `members` entries are globs, expanded against the filesystem the way
  // cargo resolves them. parseCargoToml returns null for missing /
  // malformed manifests, so stray entries silently drop out — cargo's
  // own diagnostics own surfacing those.
  for (const memberManifest of await workspaceMemberManifests(parsed, cargoTomlPath)) {
    const memberParsed = await parseCargoToml(memberManifest);
    if (memberParsed === null) {continue;}
    for (const b of collectBinsFromManifest(memberParsed)) {
      if (!result.includes(b)) {result.push(b);}
    }
  }
  return result;
}
