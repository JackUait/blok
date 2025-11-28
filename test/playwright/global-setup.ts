import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Global setup for Playwright tests.
 * Builds the project once before running any tests.
 */
const globalSetup = async (): Promise<void> => {
  console.log('Building Blok for tests...');
  const projectRoot = path.resolve(__dirname, '../..');

  const result = spawnSync('yarn', [ 'build:test' ], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Building Blok for Playwright failed with exit code ${result.status ?? 'unknown'}.`);
  }

  process.env.BLOK_BUILT = 'true';
};

export default globalSetup;
