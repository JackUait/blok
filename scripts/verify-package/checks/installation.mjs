import { access, readdir } from 'fs/promises';
import { join } from 'path';

/**
 * Verify package installation and structure
 * @param {string} packageDir - Path to node_modules/@jackuait/blok
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkInstallation(packageDir, verbose = false) {
  const details = {
    requiredFiles: [],
    unexpectedFiles: [],
    missingFiles: []
  };

  try {
    // Check if package directory exists
    await access(packageDir);

    // Required directories and files
    const requiredPaths = [
      'dist',
      'types',
      'codemod',
      'dist/blok.umd.js',
      'dist/blok.mjs',
      'dist/locales.mjs',
      'types/index.d.ts',
      'types/locales.d.ts',
      'codemod/migrate-editorjs-to-blok.js',
      'package.json'
    ];

    // Check all required paths exist
    for (const path of requiredPaths) {
      const fullPath = join(packageDir, path);
      try {
        await access(fullPath);
        details.requiredFiles.push(path);
        if (verbose) {
          console.log(`  ✓ Found: ${path}`);
        }
      } catch (error) {
        details.missingFiles.push(path);
        if (verbose) {
          console.log(`  ✗ Missing: ${path}`);
        }
      }
    }

    // Check for unexpected files (should not be published)
    const unexpectedPaths = [
      '.env',
      '.env.local',
      'test',
      '.github',
      'node_modules',
      '.git',
      'playwright-report',
      'test-results'
    ];

    for (const path of unexpectedPaths) {
      const fullPath = join(packageDir, path);
      try {
        await access(fullPath);
        details.unexpectedFiles.push(path);
        if (verbose) {
          console.log(`  ⚠ Unexpected file found: ${path}`);
        }
      } catch (error) {
        // Good - file doesn't exist
      }
    }

    // Verify dist directory has bundles
    const distDir = join(packageDir, 'dist');
    const distFiles = await readdir(distDir);
    const hasUMD = distFiles.some(f => f === 'blok.umd.js');
    const hasMJS = distFiles.some(f => f === 'blok.mjs');
    const hasLocales = distFiles.some(f => f === 'locales.mjs');

    if (!hasUMD || !hasMJS || !hasLocales) {
      return {
        passed: false,
        message: 'Missing required bundle files in dist/',
        details: { ...details, distFiles }
      };
    }

    // Check if any required files are missing
    if (details.missingFiles.length > 0) {
      return {
        passed: false,
        message: `Missing required files: ${details.missingFiles.join(', ')}`,
        details
      };
    }

    // Warn about unexpected files but don't fail
    if (details.unexpectedFiles.length > 0) {
      console.warn(`Warning: Unexpected files found in package: ${details.unexpectedFiles.join(', ')}`);
    }

    return {
      passed: true,
      message: 'Package structure verified successfully',
      details
    };

  } catch (error) {
    return {
      passed: false,
      message: `Installation check failed: ${error.message}`,
      details
    };
  }
}
