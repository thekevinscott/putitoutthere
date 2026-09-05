import type { Package } from '../config.js';
import { formatTag } from '../tag-template.js';
import type { CheckFinding } from './check-types.js';

export function checkTagTemplateCollisions(
  packages: readonly Package[],
  findings: CheckFinding[],
): void {
  // Templates collide when they resolve to the same tag at the same
  // version — typically when `{name}` is omitted and every package
  // thereafter races for one tag slot. A sentinel version is enough:
  // differing templates differ on every version, identical templates
  // collide on every version.
  const seen = new Map<string, string>();
  for (const p of packages) {
    const sentinel = formatTag(p.tag_format, { name: p.name, version: '0.0.0' });
    const prior = seen.get(sentinel);
    if (prior !== undefined) {
      findings.push({
        message: `tag_format collision: "${p.name}" and "${prior}" both resolve to tag "${sentinel}" at the same version. Include {name} in tag_format to disambiguate.`,
      });
    } else {
      seen.set(sentinel, p.name);
    }
  }
}
