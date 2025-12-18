import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Create a temporary directory for package verification
 * @returns {Promise<string>} Path to the temporary directory
 */
export async function createTempDir() {
  const prefix = join(tmpdir(), 'blok-verify-');
  const tempDir = await mkdtemp(prefix);
  return tempDir;
}

/**
 * Remove a temporary directory and all its contents
 * @param {string} dirPath - Path to the directory to remove
 * @returns {Promise<void>}
 */
export async function cleanupTempDir(dirPath) {
  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Warning: Failed to cleanup temp directory ${dirPath}:`, error.message);
  }
}

/**
 * Execute a function with a temporary directory, ensuring cleanup
 * @param {(tempDir: string) => Promise<T>} fn - Function to execute with temp directory
 * @returns {Promise<T>} Result of the function
 * @template T
 */
export async function withTempDir(fn) {
  const tempDir = await createTempDir();
  try {
    return await fn(tempDir);
  } finally {
    await cleanupTempDir(tempDir);
  }
}
