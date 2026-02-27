import path from 'path';
import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/html-vite';
import { mergeConfig } from 'vite';
import type { InlineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Names of Vite plugins to remove from Storybook's config.
 *
 * - vite-plugin-css-injected-by-js: incompatible with Storybook builds.
 * - @tailwindcss/vite:*: the instance inherited from vite.config.mjs doesn't
 *   generate utility CSS inside Storybook's Vite context, so we replace it
 *   with a fresh instance below via mergeConfig.
 */
const PLUGINS_TO_REMOVE = new Set([
  'vite-plugin-css-injected-by-js',
  '@tailwindcss/vite:scan',
  '@tailwindcss/vite:generate:serve',
  '@tailwindcss/vite:generate:build',
]);

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-vitest'
  ],
  framework: '@storybook/html-vite',
  viteFinal: async (viteConfig) => {
    const updatedConfig: InlineConfig = {
      ...viteConfig,
      build: {
        ...viteConfig.build,
        // Disable module preload polyfill to prevent CSS preload errors in Chromatic
        modulePreload: { polyfill: false },
        // Disable CSS code splitting to prevent dynamic CSS loading issues
        cssCodeSplit: false,
      },
      resolve: {
        ...viteConfig.resolve,
        alias: {
          ...viteConfig.resolve?.alias,
          '@/types': path.resolve(__dirname, '../types'),
        },
      },
      // Strip incompatible plugins (nested arrays are flattened first so each
      // sub-plugin is checked individually — @tailwindcss/vite and
      // vite-plugin-css-injected-by-js both return nested arrays).
      plugins: viteConfig.plugins
        ?.flat()
        .filter(
          (plugin) => !(plugin && 'name' in plugin && PLUGINS_TO_REMOVE.has(plugin.name))
        ),
    };

    // Add a fresh @tailwindcss/vite instance that works in Storybook's Vite context
    return mergeConfig(updatedConfig, { plugins: [tailwindcss()] });
  },
};

export default config;