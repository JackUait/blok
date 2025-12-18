import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Global setup for Playwright tests.
 * Builds the project once before running any tests.
 * In CI, skips build if artifact already exists.
 */
const globalSetup = async (): Promise<void> => {
  const projectRoot = path.resolve(__dirname, '../..');
  const distPath = path.resolve(projectRoot, 'dist');

  // Skip build if artifact already exists (CI scenario)
  if (process.env.BLOK_BUILT === 'true' && existsSync(distPath)) {
    console.log('Using pre-built Blok artifacts from CI...');
    return;
  }

  console.log('Building Blok for tests...');
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
