import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts so no eval ever runs in the per-commit unit job.
export default defineConfig({
  root: path.resolve(__dirname, '../../..'),
  resolve: { alias: { '@/types': path.resolve(__dirname, '../../../types') } },
  test: {
    name: 'agent-evals',
    environment: 'node',
    include: ['test/evals/agent/runner/node-surfaces.eval.ts'],
    testTimeout: 600_000,
    fileParallelism: false,
  },
});
