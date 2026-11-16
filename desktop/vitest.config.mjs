import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@bloklabs/core/full': fileURLToPath(new URL('../src/full.ts', import.meta.url)), '@bloklabs/core/tools': fileURLToPath(new URL('../src/tools/index.ts', import.meta.url)), '@blok/sidebar': fileURLToPath(new URL('../src/shell/sidebar.ts', import.meta.url)), '@': fileURLToPath(new URL('../', import.meta.url)), '@blok/emoji-picker': fileURLToPath(new URL('../src/tools/callout/emoji-picker/index.ts', import.meta.url)), '@blok/agent-assistant': fileURLToPath(new URL('../src/shell/agent-assistant.ts', import.meta.url)), '@blok/popover': fileURLToPath(new URL('../src/components/utils/popover/popover-desktop.ts', import.meta.url)), '@blok/modal-dialog': fileURLToPath(new URL('../src/components/utils/modal-dialog.ts', import.meta.url)), '@blok/date-editor': fileURLToPath(new URL('../src/tools/database/cells/date-editor.ts', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
