#!/usr/bin/env node

/**
 * Manual package unpublish script
 * Use this to manually unpublish a broken package version from npm
 *
 * Usage:
 *   node scripts/unpublish-package.mjs <version>
 *   node scripts/unpublish-package.mjs 1.2.3
 *   node scripts/unpublish-package.mjs 1.2.3 --dry-run
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const PACKAGE_NAME = '@jackuait/blok';

// Parse command line arguments
const args = process.argv.slice(2);
let targetVersion = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') {
    dryRun = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Usage: node scripts/unpublish-package.mjs <version> [options]

Arguments:
  <version>         Version to unpublish (e.g., 1.2.3)

Options:
  --dry-run         Show what would be unpublished without doing it
  --help, -h        Show this help message

Examples:
  node scripts/unpublish-package.mjs 1.2.3
  node scripts/unpublish-package.mjs 1.2.3 --dry-run

Environment:
  Requires NPM_TOKEN environment variable or npm login
`);
    process.exit(0);
  } else if (!targetVersion && !args[i].startsWith('--')) {
    targetVersion = args[i];
  }
}

if (!targetVersion) {
  console.error('❌ Error: Version argument is required\n');
  console.log('Usage: node scripts/unpublish-package.mjs <version>');
  console.log('Example: node scripts/unpublish-package.mjs 1.2.3');
  console.log('\nRun with --help for more information');
  process.exit(1);
}

/**
 * Check if user is authenticated with npm
 */
function checkNpmAuth() {
  try {
    execSync('npm whoami', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get current package version from package.json
 */
function getCurrentVersion() {
  try {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
    return packageJson.version;
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Check if version exists on npm registry
 */
function versionExists(packageName, version) {
  try {
    execSync(`npm view ${packageName}@${version} version`, { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Unpublish package version
 */
function unpublishVersion(packageName, version, dryRun = false) {
  console.log('🔍 Pre-unpublish checks...\n');

  // Check authentication
  if (!checkNpmAuth()) {
    console.error('❌ Not authenticated with npm');
    console.error('Run: npm login');
    console.error('Or set NPM_TOKEN environment variable');
    process.exit(1);
  }
  console.log('✓ npm authentication verified');

  // Check if version exists
  if (!versionExists(packageName, version)) {
    console.error(`\n❌ Version ${version} does not exist on npm registry`);
    console.error(`Package: ${packageName}`);
    process.exit(1);
  }
  console.log(`✓ Version ${version} exists on npm registry`);

  // Get current version
  const currentVersion = getCurrentVersion();
  console.log(`\nCurrent version (package.json): ${currentVersion}`);
  console.log(`Target version (to unpublish): ${version}`);

  // Warning
  console.log('\n⚠️  WARNING ⚠️');
  console.log('═'.repeat(50));
  console.log(`This will unpublish ${packageName}@${version}`);
  console.log('Users will no longer be able to install this version');
  console.log('This action is irreversible');
  console.log('═'.repeat(50));

  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
    console.log(`Would execute: npm unpublish ${packageName}@${version} --force`);
    console.log('\nTo perform the actual unpublish, run without --dry-run flag');
    return;
  }

  console.log('\n🗑️  Unpublishing...');

  try {
    execSync(`npm unpublish ${packageName}@${version} --force`, {
      stdio: 'inherit'
    });

    console.log('\n✅ Successfully unpublished');
    console.log(`   Package: ${packageName}`);
    console.log(`   Version: ${version}`);
    console.log('\n📝 Next steps:');
    console.log('1. Investigate why the package was broken');
    console.log('2. Fix the issues');
    console.log('3. Trigger a new release');

  } catch (error) {
    console.error('\n❌ Failed to unpublish package');
    console.error('Error:', error.message);
    console.error('\nPossible reasons:');
    console.error('- Insufficient permissions');
    console.error('- Network issues');
    console.error('- npm registry problems');
    console.error('\nYou may need to unpublish manually via npm website or contact npm support');
    process.exit(1);
  }
}

// Run the unpublish
unpublishVersion(PACKAGE_NAME, targetVersion, dryRun);
