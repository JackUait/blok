import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Install a package from npm with retry logic
 * @param {string} name - Package name
 * @param {string|null} version - Package version (null for local tarball)
 * @param {string} dir - Directory to install in
 * @param {object} options - Options
 * @param {number} [options.retries=3] - Number of retries
 * @param {boolean} [options.verbose=false] - Verbose logging
 * @param {string|null} [options.tarballPath=null] - Path to local tarball
 * @returns {Promise<void>}
 */
export async function installPackage(name, version, dir, { retries = 3, verbose = false, tarballPath = null } = {}) {
  const packageSpec = tarballPath || `${name}@${version}`;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (verbose) {
        console.log(`[Attempt ${attempt}/${retries}] Installing ${packageSpec}...`);
      }

      const { stdout, stderr } = await execAsync(
        `npm install ${packageSpec} --no-save --legacy-peer-deps`,
        { cwd: dir, timeout: 120000 }
      );

      if (verbose && stdout) {
        console.log(stdout);
      }
      if (stderr && !stderr.includes('npm warn')) {
        console.warn(stderr);
      }

      return;
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        if (verbose) {
          console.warn(`Install failed, retrying in ${delay}ms...`);
        }
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to install ${packageSpec} after ${retries} attempts: ${lastError.message}`);
}

/**
 * Wait for package to be available on npm registry
 * Uses exponential backoff with jitter for efficient polling
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<boolean>} True if package is available
 */
export async function waitForPackageAvailability(name, version, maxWaitMs = 300000, verbose = false) {
  const packageSpec = `${name}@${version}`;
  const startTime = Date.now();
  const initialInterval = 2000; // Start with 2 seconds
  const maxInterval = 30000; // Cap at 30 seconds
  let currentInterval = initialInterval;
  let attempt = 0;

  if (verbose) {
    console.log(`Waiting for ${packageSpec} to be available on npm registry...`);
    console.log(`Using exponential backoff (2s → 30s max interval)`);
  }

  while (Date.now() - startTime < maxWaitMs) {
    attempt++;
    try {
      const info = await getPackageInfo(name, version);
      if (info && info.version === version) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (verbose) {
          console.log(`✓ Package ${packageSpec} is available! (found after ${elapsed}s, ${attempt} attempts)`);
        }
        return true;
      }
    } catch (error) {
      // Package not available yet, continue polling
      if (verbose && error.message && !error.message.includes('404')) {
        console.log(`  Registry check error: ${error.message}`);
      }
    }

    // Calculate next wait interval with exponential backoff + jitter
    const jitter = Math.random() * 1000; // 0-1000ms random jitter
    const backoffInterval = Math.min(currentInterval, maxInterval);
    const waitTime = backoffInterval + jitter;

    // Don't wait if we're going to exceed the timeout
    const timeRemaining = maxWaitMs - (Date.now() - startTime);
    if (timeRemaining <= 0) {
      break;
    }

    const actualWait = Math.min(waitTime, timeRemaining);

    if (verbose) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  Attempt ${attempt}: Package not found yet (${elapsed}s elapsed, waiting ${Math.round(actualWait / 1000)}s before retry)`);
    }

    await sleep(actualWait);

    // Exponential backoff: double the interval for next time
    currentInterval = Math.min(currentInterval * 2, maxInterval);
  }

  return false;
}

/**
 * Get package information from npm registry
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @returns {Promise<object>} Package metadata
 */
export async function getPackageInfo(name, version) {
  const packageSpec = version ? `${name}@${version}` : name;

  try {
    const { stdout } = await execAsync(`npm view ${packageSpec} --json`);
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to fetch package info for ${packageSpec}: ${error.message}`);
  }
}
