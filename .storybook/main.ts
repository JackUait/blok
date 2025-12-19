import path from 'path';
import { fileURLToPath } from 'url';
import type { StorybookConfig } from '@storybook/html-vite';
import type { InlineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
    '@chromatic-com/storybook'
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
      // Remove vite-plugin-css-injected-by-js as it's incompatible with Storybook builds
      plugins: viteConfig.plugins?.filter(
        (plugin) => plugin && 'name' in plugin && plugin.name !== 'vite-plugin-css-injected-by-js'
      ),
    };

    return updatedConfig;
  },
};

export default config;