#!/usr/bin/env node

/**
 * Package verification script
 * Verifies that the package works correctly (pre-release or post-publish)
 */

import { writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { createTempDir, cleanupTempDir } from './verify-package/utils/temp-dir.mjs';
import { installPackage } from './verify-package/utils/npm-helpers.mjs';
import { checkInstallation } from './verify-package/checks/installation.mjs';
import { checkExports } from './verify-package/checks/exports.mjs';
import { checkTypes } from './verify-package/checks/types.mjs';
import { checkBin } from './verify-package/checks/bin.mjs';
import { checkSmokeTest } from './verify-package/checks/smoke-test.mjs';
import { checkBundleSize } from './verify-package/checks/bundle-size.mjs';
import { checkBrowserSmokeTest } from './verify-package/checks/browser-smoke-test.mjs';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  version: null,
  timeout: 300000, // 5 minutes default
  verbose: false,
  debug: false,
  local: false,
  skipBrowser: false
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version' && args[i + 1]) {
    options.version = args[i + 1];
    i++;
  } else if (args[i] === '--timeout' && args[i + 1]) {
    options.timeout = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--verbose') {
    options.verbose = true;
  } else if (args[i] === '--debug') {
    options.debug = true;
    options.verbose = true;
  } else if (args[i] === '--local') {
    options.local = true;
  } else if (args[i] === '--skip-browser') {
    options.skipBrowser = true;
  } else if (args[i] === '--help') {
    console.log(`
Usage: node verify-published-package.mjs [options]

Options:
  --version <version>   Version to verify (required unless --local)
  --timeout <ms>        Timeout in milliseconds (default: 300000)
  --verbose             Verbose logging
  --debug               Debug mode (keep temp directory, verbose logging)
  --local               Test local tarball instead of published package
  --skip-browser        Skip browser smoke test
  --help                Show this help message
`);
    process.exit(0);
  }
}

const PACKAGE_NAME = '@jackuait/blok';

/**
 * Find the most recent .tgz tarball in the current directory
 * @returns {Promise<string>} Path to tarball
 */
async function findLatestTarball() {
  const files = await readdir(process.cwd());
  const tarballs = files.filter(f => f.endsWith('.tgz') && f.startsWith('jackuait-blok-'));

  if (tarballs.length === 0) {
    throw new Error('No .tgz tarball found. Run "npm pack" first.');
  }

  // Sort by modification time (most recent first)
  tarballs.sort().reverse();
  return join(process.cwd(), tarballs[0]);
}

/**
 * Format check duration
 */
function formatDuration(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

/**
 * Run all verification checks
 */
async function runVerification() {
  const startTime = Date.now();
  let tempDir;

  console.log('🔍 Package Verification Started');
  console.log(`  Mode: ${options.local ? 'Pre-release (local tarball)' : 'Post-publish (npm registry)'}`);
  console.log(`  Package: ${PACKAGE_NAME}`);
  console.log(`  Version: ${options.version || 'local'}`);
  console.log('');

  const results = {
    checks: [],
    passed: 0,
    failed: 0,
    totalTime: 0
  };

  try {
    // Create temporary directory
    tempDir = await createTempDir();
    if (options.verbose) {
      console.log(`Temp directory: ${tempDir}`);
      console.log('');
    }

    // Initialize npm in temp directory
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({
      name: 'blok-verification',
      version: '1.0.0',
      private: true,
      type: 'module'
    }, null, 2));

    // Install the package
    if (options.local) {
      const tarballPath = await findLatestTarball();
      console.log(`📦 Installing from local tarball: ${tarballPath}...`);
      await installPackage(PACKAGE_NAME, null, tempDir, {
        retries: 3,
        verbose: options.verbose,
        tarballPath
      });
    } else {
      console.log(`📦 Installing ${PACKAGE_NAME}@${options.version}...`);
      await installPackage(PACKAGE_NAME, options.version, tempDir, {
        retries: 3,
        verbose: options.verbose
      });
    }
    console.log('✓ Package installed\n');

    const packageDir = join(tempDir, 'node_modules', PACKAGE_NAME);

    // Define all checks
    // NOTE: Types check must run LAST because it installs TypeScript which may modify node_modules
    const checks = [
      {
        name: 'Installation',
        fn: () => checkInstallation(packageDir, options.verbose)
      },
      {
        name: 'Exports',
        fn: () => checkExports(tempDir, PACKAGE_NAME, options.verbose)
      },
      {
        name: 'Bin script',
        fn: () => checkBin(packageDir, options.verbose)
      },
      {
        name: 'Smoke test',
        fn: () => checkSmokeTest(packageDir, options.verbose)
      },
      {
        name: 'Bundle sizes',
        fn: () => checkBundleSize(packageDir, options.verbose)
      },
      {
        name: 'Types',
        fn: () => checkTypes(packageDir, tempDir, options.verbose)
      }
    ];

    // Add browser test if not skipped
    if (!options.skipBrowser) {
      checks.push({
        name: 'Browser test',
        fn: () => checkBrowserSmokeTest(packageDir, tempDir, options.verbose)
      });
    }

    // Run all checks
    for (let i = 0; i < checks.length; i++) {
      const check = checks[i];
      const checkNum = i + 1;
      const totalChecks = checks.length;

      process.stdout.write(`[${checkNum}/${totalChecks}] ${check.name}... `);

      const checkStart = Date.now();
      try {
        const result = await check.fn();
        const checkDuration = Date.now() - checkStart;

        results.checks.push({
          name: check.name,
          ...result,
          duration: checkDuration
        });

        if (result.passed) {
          console.log(`✓ passed (${formatDuration(checkDuration)})`);
          results.passed++;
        } else {
          console.log(`✗ FAILED (${formatDuration(checkDuration)})`);
          console.log(`  Error: ${result.message}`);
          results.failed++;
        }
      } catch (error) {
        const checkDuration = Date.now() - checkStart;
        console.log(`✗ FAILED (${formatDuration(checkDuration)})`);
        console.log(`  Error: ${error.message}`);
        results.checks.push({
          name: check.name,
          passed: false,
          message: error.message,
          duration: checkDuration
        });
        results.failed++;
      }
    }

    results.totalTime = Date.now() - startTime;

    // Print summary
    console.log('');
    console.log('─'.repeat(50));
    if (results.failed === 0) {
      console.log('✅ Verification passed');
    } else {
      console.log('❌ Verification failed');
    }
    console.log(`   ${results.passed} of ${checks.length} checks passed`);
    console.log(`   Total time: ${formatDuration(results.totalTime)}`);
    console.log('─'.repeat(50));

    // Save detailed report
    const reportPath = join(process.cwd(), 'verification-report.json');
    await writeFile(reportPath, JSON.stringify(results, null, 2));
    console.log(`\nDetailed report saved to: verification-report.json`);

    // Show remediation guidance on failure
    if (results.failed > 0) {
      console.log('');
      console.log('REMEDIATION OPTIONS:');
      if (options.local) {
        console.log('1. Fix the issues identified above');
        console.log('2. Rebuild: yarn build');
        console.log('3. Re-verify: npm pack && node scripts/verify-published-package.mjs --local');
        console.log('4. When fixed, trigger release workflow');
      } else {
        console.log(`1. Unpublish broken version: node scripts/unpublish-package.mjs ${options.version}`);
        console.log(`   Or manually: npm unpublish ${PACKAGE_NAME}@${options.version}`);
        console.log('2. Publish hotfix: Fix issue and trigger new release');
        console.log('3. Investigate locally: npm pack && node scripts/verify-published-package.mjs --local');
      }
      console.log('');
      console.log('See full report: verification-report.json');
    }

  } catch (error) {
    console.error('\n❌ Verification failed with error:');
    console.error(error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    return 2; // Script error exit code
  } finally {
    // Cleanup temp directory unless debug mode
    if (tempDir && !options.debug) {
      await cleanupTempDir(tempDir);
    } else if (tempDir && options.debug) {
      console.log(`\nDebug mode: temp directory preserved at ${tempDir}`);
    }
  }

  return results.failed > 0 ? 1 : 0; // 1 = verification failed, 0 = success
}

// Run verification
runVerification()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(2);
  });
