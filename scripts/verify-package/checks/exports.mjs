import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';

/**
 * Verify all package exports work correctly
 * @param {string} tempDir - Temporary directory with package installed
 * @param {string} packageName - Package name
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkExports(tempDir, packageName, verbose = false) {
  const details = {
    namedImport: false,
    localesImport: false,
    commonjsRequire: false,
    dynamicImport: false,
    errors: []
  };

  try {
    // Test 1: Named ESM import (Blok uses named exports)
    if (verbose) {
      console.log('  Testing named ESM import...');
    }
    try {
      const testFile = join(tempDir, 'test-named-import.mjs');
      await writeFile(testFile, `
        import { Blok } from '${packageName}';
        if (typeof Blok !== 'function') {
          throw new Error('Blok is not a constructor function');
        }
        console.log('Named import: OK');
      `);

      const module = await import(pathToFileURL(testFile).href);
      details.namedImport = true;
    } catch (error) {
      details.errors.push(`Named import failed: ${error.message}`);
      if (verbose) {
        console.log(`  ✗ Named import failed: ${error.message}`);
      }
    }

    // Test 2: Locales subpath export
    if (verbose) {
      console.log('  Testing locales subpath export...');
    }
    try {
      const testFile = join(tempDir, 'test-locales-import.mjs');
      await writeFile(testFile, `
        import { loadLocale } from '${packageName}/locales';
        if (typeof loadLocale !== 'function') {
          throw new Error('loadLocale is not a function');
        }
        console.log('Locales import: OK');
      `);

      await import(pathToFileURL(testFile).href);
      details.localesImport = true;
    } catch (error) {
      details.errors.push(`Locales import failed: ${error.message}`);
      if (verbose) {
        console.log(`  ✗ Locales import failed: ${error.message}`);
      }
    }

    // Test 3: CommonJS require - SKIPPED
    // This package is ESM-only (no CJS build), so CommonJS require is not supported.
    // Modern bundlers and Node.js ESM support handle this correctly.
    if (verbose) {
      console.log('  Skipping CommonJS require (ESM-only package)...');
    }
    details.commonjsRequire = true; // Mark as passed since ESM-only is intentional

    // Test 4: Dynamic import (uses named export)
    if (verbose) {
      console.log('  Testing dynamic import...');
    }
    try {
      const packagePath = join(tempDir, 'node_modules', packageName);
      const module = await import(pathToFileURL(join(packagePath, 'dist', 'blok.mjs')).href);
      if (typeof module.Blok !== 'function') {
        throw new Error('Blok named export is not a constructor function');
      }
      details.dynamicImport = true;
    } catch (error) {
      details.errors.push(`Dynamic import failed: ${error.message}`);
      if (verbose) {
        console.log(`  ✗ Dynamic import failed: ${error.message}`);
      }
    }

    // Determine if all checks passed
    const allPassed = details.namedImport &&
                      details.localesImport &&
                      details.commonjsRequire &&
                      details.dynamicImport;

    if (allPassed) {
      return {
        passed: true,
        message: 'All export paths verified successfully',
        details
      };
    } else {
      return {
        passed: false,
        message: `Export verification failed: ${details.errors.join('; ')}`,
        details
      };
    }

  } catch (error) {
    return {
      passed: false,
      message: `Export check failed: ${error.message}`,
      details
    };
  }
}
