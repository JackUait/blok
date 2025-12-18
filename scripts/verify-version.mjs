#!/usr/bin/env node

/**
 * Version Verification Script
 *
 * Ensures that package.json version matches the last git tag.
 * This prevents manual version bumps that could break semantic-release.
 *
 * Usage:
 *   node scripts/verify-version.mjs
 *
 * Exit codes:
 *   0 - Version is valid (matches last tag or no tags exist yet)
 *   1 - Version mismatch detected (manual bump suspected)
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

/**
 * Get the current version from package.json
 */
function getPackageVersion() {
  const packageJsonPath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

/**
 * Get the latest git tag (version tag)
 * Returns null if no tags exist
 */
function getLatestGitTag() {
  try {
    // Get all tags sorted by version
    const tags = execSync('git tag --list "v*" --sort=-version:refname', {
      encoding: 'utf8',
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (!tags) {
      return null;
    }

    // Return the first tag (latest version)
    const latestTag = tags.split('\n')[0];
    // Remove 'v' prefix if present
    return latestTag.replace(/^v/, '');
  } catch (error) {
    // No tags exist yet or git error
    return null;
  }
}

/**
 * Check if the current commit is a release commit made by semantic-release
 */
function isReleaseCommit() {
  try {
    const commitMessage = execSync('git log -1 --pretty=%B', {
      encoding: 'utf8',
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // semantic-release commits typically include these patterns
    const releasePatterns = [
      /^chore\(release\):/i,
      /\[skip ci\]/i,
      /semantic-release/i
    ];

    return releasePatterns.some(pattern => pattern.test(commitMessage));
  } catch (error) {
    return false;
  }
}

/**
 * Check if there are staged changes to package.json
 */
function hasPackageJsonChanges() {
  try {
    const diff = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    return diff.split('\n').includes('package.json');
  } catch (error) {
    return false;
  }
}

/**
 * Main verification logic
 */
function verifyVersion() {
  const packageVersion = getPackageVersion();
  const gitTagVersion = getLatestGitTag();

  console.log('🔍 Verifying package.json version...');
  console.log(`   Package version: ${packageVersion}`);
  console.log(`   Latest git tag:  ${gitTagVersion || '(no tags yet)'}`);

  // If no tags exist yet, allow any version (initial development)
  if (!gitTagVersion) {
    console.log('✓ No git tags found - allowing current version (initial development)');
    return true;
  }

  // If this is a release commit, allow version bump
  if (isReleaseCommit()) {
    console.log('✓ This is a semantic-release commit - version bump allowed');
    return true;
  }

  // Check if versions match
  if (packageVersion === gitTagVersion) {
    console.log('✓ Version matches latest git tag');
    return true;
  }

  // Version mismatch detected
  console.error('\n❌ Version mismatch detected!');
  console.error(`   package.json version (${packageVersion}) does not match latest git tag (${gitTagVersion})`);
  console.error('');
  console.error('   This suggests a manual version bump, which can break semantic-release.');
  console.error('');
  console.error('   ⚠️  DO NOT manually edit the version in package.json');
  console.error('   ⚠️  Versions should only be updated by semantic-release');
  console.error('');
  console.error('   To fix this:');
  console.error(`   1. Revert package.json version back to ${gitTagVersion}`);
  console.error('   2. Let semantic-release handle version bumps automatically');
  console.error('');

  return false;
}

// Run verification
const isValid = verifyVersion();
process.exit(isValid ? 0 : 1);
