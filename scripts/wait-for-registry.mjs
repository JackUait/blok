#!/usr/bin/env node

/**
 * Wait for package to be available on npm registry
 * Uses exponential backoff polling instead of fixed sleep
 */

import { waitForPackageAvailability } from './verify-package/utils/npm-helpers.mjs';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  version: null,
  timeout: 300000, // 5 minutes default
  verbose: false
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
  } else if (args[i] === '--help') {
    console.log(`
Usage: node wait-for-registry.mjs [options]

Options:
  --version <version>   Version to wait for (required)
  --timeout <ms>        Maximum wait time in milliseconds (default: 300000)
  --verbose             Verbose logging
  --help                Show this help message

Example:
  node wait-for-registry.mjs --version 1.2.3 --timeout 300000 --verbose
`);
    process.exit(0);
  }
}

const PACKAGE_NAME = '@jackuait/blok';

/**
 * Main function
 */
async function main() {
  if (!options.version) {
    console.error('Error: --version is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  console.log('🔍 Waiting for npm registry propagation...');
  console.log(`  Package: ${PACKAGE_NAME}@${options.version}`);
  console.log(`  Timeout: ${options.timeout}ms`);
  console.log('');

  const startTime = Date.now();

  try {
    const isAvailable = await waitForPackageAvailability(
      PACKAGE_NAME,
      options.version,
      options.timeout,
      options.verbose
    );

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (isAvailable) {
      console.log(`✅ Package is available on npm registry (took ${elapsed}s)`);
      process.exit(0);
    } else {
      console.error(`❌ Package did not become available within ${options.timeout}ms`);
      console.error(`   This may indicate a registry propagation delay or publish failure`);
      console.error(`   Total wait time: ${elapsed}s`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error while waiting for package:');
    console.error(error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(2);
  }
}

main();
