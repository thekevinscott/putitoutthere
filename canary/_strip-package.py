#!/usr/bin/env python3
"""Strip a single `[[package]]` block from the canary's putitoutthere.toml.

Used by .github/workflows/canary.yml's `skip_npm` / `skip_crates`
workflow_dispatch inputs so an operator debugging a single-registry
regression can re-run the canary without burning a version slot on
the other registry. NOT a consumer-facing tool — internal to the
canary fixture; do not call from outside the canary workflow.

Usage: _strip-package.py <toml-path> <kind>

Matches `[[package]]` blocks by their `kind = "<value>"` line and
removes the entire block (anchored by the next top-of-line
`[[package]]` header or EOF). Preserves preamble (`[putitoutthere]`
table + leading comments) and any non-matching `[[package]]` blocks
byte-for-byte. Exits 1 if no block matches the requested kind --
that would mean the canary toml drifted and the strip would silently
no-op, which is the failure mode this guard exists to catch.
"""

import re
import sys
from pathlib import Path


def strip_kind(src: str, kind: str) -> str:
    starts = [m.start() for m in re.finditer(r'^\[\[package\]\]', src, re.MULTILINE)]
    if not starts:
        raise SystemExit("no [[package]] blocks found in toml")
    pre = src[: starts[0]]
    ends = starts[1:] + [len(src)]
    matched = 0
    out = []
    for s, e in zip(starts, ends):
        block = src[s:e]
        if re.search(rf'kind\s*=\s*"{re.escape(kind)}"', block):
            matched += 1
            continue
        out.append(block)
    if matched == 0:
        raise SystemExit(f"no [[package]] block with kind = \"{kind}\" found")
    return pre + ''.join(out)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    path = Path(sys.argv[1])
    kind = sys.argv[2]
    path.write_text(strip_kind(path.read_text(), kind))


if __name__ == "__main__":
    main()
