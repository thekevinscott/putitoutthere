import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Put It Out There',
  description: 'Polyglot release orchestrator for crates.io, PyPI, and npm.',
  base: '/putitoutthere/',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/putitoutthere/favicon.svg' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Guide', link: '/guide/concepts' },
      { text: 'Library shapes', link: '/guide/shapes/' },
      { text: 'GitHub', link: 'https://github.com/thekevinscott/putitoutthere' },
    ],
    sidebar: {
      '/guide/shapes/': [
        {
          text: 'Library shapes',
          items: [
            { text: 'Overview', link: '/guide/shapes/' },
          ],
        },
        {
          text: 'Single-package',
          items: [
            { text: 'Python library', link: '/guide/shapes/python-library' },
            { text: 'npm library', link: '/guide/shapes/npm-library' },
            { text: 'Rust crate', link: '/guide/shapes/rust-crate' },
          ],
        },
        {
          text: 'Multi-package workspaces',
          items: [
            { text: 'Rust workspace', link: '/guide/shapes/rust-workspace' },
            { text: 'npm workspace', link: '/guide/shapes/npm-workspace' },
          ],
        },
        {
          text: 'Rust core, multi-registry',
          items: [
            { text: 'Rust + PyO3 wheels', link: '/guide/shapes/rust-pyo3' },
            { text: 'Rust + napi npm', link: '/guide/shapes/rust-napi' },
            { text: 'Polyglot Rust library', link: '/guide/shapes/polyglot-rust' },
          ],
        },
        {
          text: 'Distribution patterns',
          items: [
            { text: 'Bundled-CLI npm family', link: '/guide/shapes/bundled-cli' },
            { text: 'Dual-family npm (CLI + napi)', link: '/guide/shapes/dual-family-npm' },
          ],
        },
      ],
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Concepts', link: '/guide/concepts' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Authentication', link: '/guide/auth' },
            { text: 'Release trailer', link: '/guide/trailer' },
            { text: 'Nightly release', link: '/guide/nightly-release' },
            { text: 'Cascade', link: '/guide/cascade' },
            { text: 'Artifact contract', link: '/guide/artifact-contract' },
            { text: 'Troubleshooting publish failures', link: '/guide/troubleshooting' },
            { text: 'npm platform packages', link: '/guide/npm-platform-packages' },
            { text: 'Runner prerequisites', link: '/guide/runner-prerequisites' },
            { text: 'Dynamic versions', link: '/guide/dynamic-versions' },
            { text: 'Migrations', link: '/guide/migrations' },
            { text: 'Known gaps', link: '/guide/gaps' },
          ],
        },
        {
          text: 'Library shapes',
          items: [
            { text: 'Overview', link: '/guide/shapes/' },
            { text: 'Single-package Python library', link: '/guide/shapes/python-library' },
            { text: 'Single-package npm library', link: '/guide/shapes/npm-library' },
            { text: 'Single-package Rust crate', link: '/guide/shapes/rust-crate' },
            { text: 'Multi-crate Rust workspace', link: '/guide/shapes/rust-workspace' },
            { text: 'Multi-package npm workspace', link: '/guide/shapes/npm-workspace' },
            { text: 'Rust + PyO3 wheels', link: '/guide/shapes/rust-pyo3' },
            { text: 'Rust + napi npm', link: '/guide/shapes/rust-napi' },
            { text: 'Polyglot Rust library', link: '/guide/shapes/polyglot-rust' },
            { text: 'Bundled-CLI npm family', link: '/guide/shapes/bundled-cli' },
            { text: 'Dual-family npm (CLI + napi)', link: '/guide/shapes/dual-family-npm' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/thekevinscott/putitoutthere' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Kevin Scott',
    },
  },
});
