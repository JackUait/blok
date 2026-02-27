/**
 * Enable the 'style' condition so esbuild can resolve Tailwind CSS v4's
 * bare `@import 'tailwindcss'` (which exports under the "style" condition).
 */
function modifyEsbuildConfig(config) {
  config.conditions = [...(config.conditions || []), 'style'];

  return config;
}

module.exports = [
  {
    name: 'Minimum (core only)',
    path: 'src/variants/blok-minimum.ts',
    limit: '300 KB',
    modifyEsbuildConfig,
  },
  {
    name: 'Normal (with tools)',
    path: 'src/blok.ts',
    limit: '300 KB',
    modifyEsbuildConfig,
  },
  {
    name: 'Maximum (all locales)',
    path: 'src/variants/blok-maximum.ts',
    limit: '300 KB',
    modifyEsbuildConfig,
  },
];
