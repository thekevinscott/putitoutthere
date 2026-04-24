import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Put It Out There',
  description: 'Polyglot release orchestrator for crates.io, PyPI, and npm.',
  base: '/put-it-out-there/',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/put-it-out-there/favicon.svg' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Guide', link: '/guide/concepts' },
      { text: 'Library shapes', link: '/guide/shapes/' },
      { text: 'API', link: '/api/cli' },
      { text: 'GitHub', link: 'https://github.com/thekevinscott/put-it-out-there' },
    ],
    sidebar: {
      '/guide/shapes/': [
        {
          text: 'Library shapes',
          items: [
            { text: 'Overview', link: '/guide/shapes/' },
            { text: 'Single-package Python library', link: '/guide/shapes/python-library' },
            { text: 'Polyglot Rust library', link: '/guide/shapes/polyglot-rust' },
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
            { text: 'Testing your release workflow', link: '/guide/testing-your-release-workflow' },
            { text: 'Cascade', link: '/guide/cascade' },
            { text: 'npm platform packages', link: '/guide/npm-platform-packages' },
            { text: 'Runner prerequisites', link: '/guide/runner-prerequisites' },
            { text: 'Dynamic versions', link: '/guide/dynamic-versions' },
            { text: 'Known gaps', link: '/guide/gaps' },
          ],
        },
        {
          text: 'Library shapes',
          items: [
            { text: 'Overview', link: '/guide/shapes/' },
            { text: 'Single-package Python library', link: '/guide/shapes/python-library' },
            { text: 'Polyglot Rust library', link: '/guide/shapes/polyglot-rust' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API',
          items: [
            { text: 'CLI', link: '/api/cli' },
            { text: 'GitHub Action', link: '/api/action' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/thekevinscott/put-it-out-there' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Kevin Scott',
    },
  },
});
