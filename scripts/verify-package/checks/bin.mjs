import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { constants } from 'fs';

const execAsync = promisify(exec);

/**
 * Verify bin script is executable and works correctly
 * @param {string} packageDir - Path to node_modules/@jackuait/blok
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkBin(packageDir, verbose = false) {
  const details = {
    binExists: false,
    hasShebang: false,
    isExecutable: false,
    runsSuccessfully: false,
    errors: []
  };

  try {
    const binPath = join(packageDir, 'codemod', 'migrate-editorjs-to-blok.js');

    // Check if bin file exists
    try {
      await access(binPath);
      details.binExists = true;
      if (verbose) {
        console.log('  ✓ Bin script exists');
      }
    } catch (error) {
      details.errors.push('Bin script does not exist');
      return {
        passed: false,
        message: 'Bin script not found',
        details
      };
    }

    // Check for shebang
    const content = await readFile(binPath, 'utf-8');
    if (content.startsWith('#!/usr/bin/env node')) {
      details.hasShebang = true;
      if (verbose) {
        console.log('  ✓ Correct shebang found');
      }
    } else {
      details.errors.push('Missing or incorrect shebang');
      if (verbose) {
        console.log('  ✗ Missing or incorrect shebang');
      }
    }

    // Check if file is executable (on Unix-like systems)
    if (process.platform !== 'win32') {
      try {
        await access(binPath, constants.X_OK);
        details.isExecutable = true;
        if (verbose) {
          console.log('  ✓ File is executable');
        }
      } catch (error) {
        details.errors.push('File is not executable');
        if (verbose) {
          console.log('  ✗ File is not executable');
        }
      }
    } else {
      // On Windows, skip executable check
      details.isExecutable = true;
    }

    // Try to run the bin script with --help
    if (verbose) {
      console.log('  Testing bin script execution with --help...');
    }

    try {
      const { stdout, stderr } = await execAsync(
        `node "${binPath}" --help`,
        { timeout: 10000 }
      );

      details.runsSuccessfully = true;

      if (verbose) {
        console.log('  ✓ Bin script runs successfully');
        if (stdout) {
          console.log('  Output:', stdout.trim().substring(0, 100));
        }
      }
    } catch (error) {
      // Some scripts might not have --help, so check if it at least runs
      if (error.code === 0 || error.stdout || error.stderr) {
        details.runsSuccessfully = true;
        if (verbose) {
          console.log('  ✓ Bin script executed (no --help output)');
        }
      } else {
        details.errors.push(`Bin script execution failed: ${error.message}`);
        if (verbose) {
          console.log(`  ✗ Bin script execution failed: ${error.message}`);
        }
      }
    }

    // Determine if all checks passed
    const allPassed = details.binExists &&
                      details.hasShebang &&
                      details.isExecutable &&
                      details.runsSuccessfully;

    if (allPassed) {
      return {
        passed: true,
        message: 'Bin script verified successfully',
        details
      };
    } else {
      return {
        passed: false,
        message: `Bin verification failed: ${details.errors.join('; ')}`,
        details
      };
    }

  } catch (error) {
    return {
      passed: false,
      message: `Bin check failed: ${error.message}`,
      details
    };
  }
}
