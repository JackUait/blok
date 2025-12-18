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
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<boolean>} True if package is available
 */
export async function waitForPackageAvailability(name, version, maxWaitMs = 300000, verbose = false) {
  const packageSpec = `${name}@${version}`;
  const startTime = Date.now();
  const pollInterval = 10000;

  if (verbose) {
    console.log(`Waiting for ${packageSpec} to be available on npm registry...`);
  }

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const info = await getPackageInfo(name, version);
      if (info && info.version === version) {
        if (verbose) {
          console.log(`Package ${packageSpec} is available!`);
        }
        return true;
      }
    } catch (error) {
      // Package not available yet, continue polling
    }

    await sleep(pollInterval);

    if (verbose) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`Still waiting... (${elapsed}s elapsed)`);
    }
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
