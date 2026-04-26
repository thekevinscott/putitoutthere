---
layout: home

hero:
  name: Put It Out There
  text: Polyglot release orchestrator
  tagline: One reusable GitHub Actions workflow. crates.io + PyPI + npm from a single repo.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/thekevinscott/putitoutthere

features:
  - icon: 📦
    title: Three registries, one flow
    details: Rust, Python, and JavaScript packages release from the same repo with no per-language release scripts.
  - icon: 🪞
    title: Trailer-driven
    details: release:&nbsp;minor in the merge commit. That's it. Default is patch-on-cascade.
  - icon: 🔐
    title: OIDC-first
    details: Trusted publishers on all three registries. No long-lived tokens unless you want them.
---

::: warning Docs being rewritten
The consumer surface is being collapsed to a single reusable GitHub Actions workflow. These pages describe the prior hand-written-`release.yml` model and are mid-rewrite. See [design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md) for the new direction.
:::
