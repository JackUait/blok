import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const LOCK_FILE = '.playwright-build.lock';
const LOCK_TIMEOUT_MS = 120_000; // 2 minutes max wait for build

/**
 * Global setup for Playwright tests.
 * Builds the project once before running any tests.
 * In CI, skips build if artifact already exists.
 *
 * Uses a lock file to prevent race conditions when multiple
 * Playwright projects start simultaneously.
 */
const globalSetup = async (): Promise<void> => {
  const projectRoot = path.resolve(__dirname, '../..');
  const distPath = path.resolve(projectRoot, 'dist');
  const lockPath = path.resolve(projectRoot, LOCK_FILE);

  // Skip build if artifact already exists (CI scenario)
  if (process.env.BLOK_BUILT === 'true' && existsSync(distPath)) {
    console.log('Using pre-built Blok artifacts from CI...');
    return;
  }

  // Check if dist already exists (another process may have built it)
  if (hasBuildArtifacts(distPath)) {
    console.log('Using existing build artifacts...');
    process.env.BLOK_BUILT = 'true';
    return;
  }

  // Try to acquire lock for building
  const acquired = acquireLock(lockPath);

  if (!acquired) {
    // Another process is building, wait for it to complete
    console.log('Waiting for another process to complete build...');
    await waitForBuild(distPath, lockPath);
    process.env.BLOK_BUILT = 'true';
    return;
  }

  try {
    console.log('Building Blok for tests...');
    const result = spawnSync('yarn', ['build:test'], {
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
  } finally {
    // Release lock
    releaseLock(lockPath);
  }
};

/**
 * Checks if the build artifacts exist.
 */
const hasBuildArtifacts = (distPath: string): boolean => {
  return existsSync(distPath) && existsSync(path.resolve(distPath, 'blok.js'));
};

/**
 * Checks if the lock file is stale (older than timeout).
 */
const isLockStale = (lockPath: string): boolean => {
  const stats = statSync(lockPath);
  const lockAge = Date.now() - stats.mtimeMs;
  return lockAge > LOCK_TIMEOUT_MS;
};

/**
 * Handles existing lock file - removes if stale, returns false if held by another process.
 */
const handleExistingLock = (lockPath: string): boolean => {
  if (!existsSync(lockPath)) {
    return true; // No lock exists, can proceed
  }

  if (isLockStale(lockPath)) {
    console.log('Removing stale lock file...');
    rmSync(lockPath, { force: true });
    return true; // Stale lock removed, can proceed
  }

  // Lock is held by another process
  return false;
};

/**
 * Attempts to acquire a lock file for exclusive build access.
 * Returns true if lock was acquired, false if another process holds it.
 */
const acquireLock = (lockPath: string): boolean => {
  try {
    if (!handleExistingLock(lockPath)) {
      return false;
    }

    // Create lock file with our PID
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    // Lock file was created by another process between our check and write
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    // For other errors, try to proceed without lock
    console.warn('Warning: Could not acquire build lock:', error);
    return true;
  }
};

/**
 * Releases the lock file.
 */
const releaseLock = (lockPath: string): void => {
  try {
    rmSync(lockPath, { force: true });
  } catch {
    // Ignore errors when releasing lock
  }
};

/**
 * Checks if build completed after lock was released.
 * Throws if lock released but no artifacts found.
 */
const checkBuildAfterLockRelease = async (distPath: string): Promise<boolean> => {
  await sleep(100);
  if (hasBuildArtifacts(distPath)) {
    return true;
  }
  // Lock released but no dist - build may have failed
  throw new Error('Build lock released but no build artifacts found');
};

/**
 * Waits for the build to complete by polling for dist directory
 * or lock file removal.
 */
const waitForBuild = async (distPath: string, lockPath: string): Promise<void> => {
  const startTime = Date.now();
  const pollInterval = 500; // Check every 500ms

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    if (hasBuildArtifacts(distPath)) {
      return;
    }

    // Check if lock was released (build failed or completed)
    const lockReleased = !existsSync(lockPath);
    if (lockReleased && await checkBuildAfterLockRelease(distPath)) {
      return;
    }

    await sleep(pollInterval);
  }

  throw new Error(`Timed out waiting for build after ${LOCK_TIMEOUT_MS}ms`);
};

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export default globalSetup;
