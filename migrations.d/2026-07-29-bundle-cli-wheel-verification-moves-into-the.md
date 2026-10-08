# bundle_cli wheel verification moves into the engine

**Summary.** The reusable workflow's `bundle_cli — verify wheel contains
<stage_to>/<bin>` step carried its check inline: `unzip -l | awk | grep`
over the produced wheel, plus a `python3 - <<'PY' … import tomllib … PY`
heredoc to read `[tool.maturin].python-source` out of the consumer's
`pyproject.toml`. That heredoc ran under whatever interpreter
`setup-python` provisioned **for that wheel row**, and `tomllib` is
standard library only on CPython 3.11+, so any fanned wheel row at 3.10
or below died with `ModuleNotFoundError: No module named 'tomllib'` —
after the wheel had already built, inside the release itself.

The step now calls the engine's `verify bundle-cli` command, which has
existed and been tested since #451. It parses the TOML on the action's
own Node runtime (so no consumer `requires-python` floor can reach it)
and reads the wheel with a dependency-free pure-Node zip reader (so the
runner needs no `unzip`). The duplicated logic is deleted rather than
relocated: one tested implementation, in the engine.

**Required changes.** None. This is entirely internal to the reusable
workflow — no config key, no workflow input, no trailer grammar changes.

If you raised your package's `requires-python` floor to `>=3.11` purely
to dodge the crash above, or adopted version-independent (abi3) wheels
for the same reason, you may revert that:

| | before | after |
| --- | --- | --- |
| `pyproject.toml` | `requires-python = ">=3.11"` (workaround) | `requires-python = ">=3.9"` (or whatever your code actually needs) |

**Deprecations removed.** None.

**Behavior changes without code changes.**

- Maturin `bundle_cli` wheel rows built against CPython ≤ 3.10 now pass
  the verification step instead of crashing it.
- The verification step no longer requires `python3` or `unzip` on the
  runner image. This matters only for a custom `runs_on` image lacking
  either; GitHub-hosted runners carry both.
- Everything else about the check is byte-identical, and covered by
  tests at two tiers: same wheel selection, same `python-source`
  subtraction (both the `python-source` and legacy `python_source`
  spellings), same `.exe` suffix on Windows targets, same
  `::error::` / `ok bundle_cli:` output, same exit code.

**Verification.** On your next release of a maturin package with a
`[package.bundle_cli]`, the build job's step of that name is now a
`putitoutthere` action step rather than a shell script. Its log line is
unchanged on success:

```
ok bundle_cli: dirsql/_binary/dirsql present in dirsql-0.4.0-cp39-abi3-manylinux_2_34_x86_64.whl
```

If you had pinned `requires-python = ">=3.11"` as a workaround, lower it
and confirm the ≤ 3.10 wheel rows in the build matrix now go green.
