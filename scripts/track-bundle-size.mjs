#!/usr/bin/env node

import { stat, readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Calculate percentage change
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {number} Percentage change
 */
function calculatePercentageChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Get all bundle sizes from dist directory
 * @param {string} distDir - Path to dist directory
 * @returns {Promise<object>} Bundle sizes
 */
async function getBundleSizes(distDir) {
  const bundles = {};

  try {
    const files = await readdir(distDir);

    // Track specific bundles
    const bundlesToTrack = ['blok.umd.js', 'blok.mjs', 'locales.mjs', 'locales.umd.js'];

    for (const bundleName of bundlesToTrack) {
      if (files.includes(bundleName)) {
        const bundlePath = join(distDir, bundleName);
        const stats = await stat(bundlePath);
        bundles[bundleName] = stats.size;
      }
    }

    // Track main chunk (blok-*.mjs pattern)
    const mainChunkPattern = /^blok-[a-zA-Z0-9]+\.mjs$/;
    const mainChunks = files.filter(f => mainChunkPattern.test(f));

    for (const chunkName of mainChunks) {
      const chunkPath = join(distDir, chunkName);
      const stats = await stat(chunkPath);
      bundles[chunkName] = stats.size;
    }

    // Track locales chunk (locales-*.mjs pattern)
    const localesChunkPattern = /^locales-[a-zA-Z0-9]+\.mjs$/;
    const localesChunks = files.filter(f => localesChunkPattern.test(f));

    for (const chunkName of localesChunks) {
      const chunkPath = join(distDir, chunkName);
      const stats = await stat(chunkPath);
      bundles[chunkName] = stats.size;
    }

    // Calculate total dist size
    const calculateDirSize = async (dir) => {
      let totalSize = 0;
      const items = await readdir(dir, { withFileTypes: true });

      for (const item of items) {
        const itemPath = join(dir, item.name);
        if (item.isDirectory()) {
          totalSize += await calculateDirSize(itemPath);
        } else {
          const stats = await stat(itemPath);
          totalSize += stats.size;
        }
      }

      return totalSize;
    };

    bundles['_total'] = await calculateDirSize(distDir);

    return bundles;
  } catch (error) {
    console.error('Failed to get bundle sizes:', error.message);
    throw error;
  }
}

/**
 * Load historical bundle size data
 * @param {string} historyFile - Path to history file
 * @returns {Promise<Array>} Historical data
 */
async function loadHistory(historyFile) {
  if (!existsSync(historyFile)) {
    return [];
  }

  try {
    const content = await readFile(historyFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn('Failed to load history, starting fresh:', error.message);
    return [];
  }
}

/**
 * Save bundle size history
 * @param {string} historyFile - Path to history file
 * @param {Array} history - History data
 */
async function saveHistory(historyFile, history) {
  const dir = dirname(historyFile);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Compare current sizes with previous entry
 * @param {object} current - Current bundle sizes
 * @param {object} previous - Previous bundle sizes
 * @param {number} threshold - Percentage threshold for alerts
 * @returns {object} Comparison results
 */
function compareSizes(current, previous, threshold = 10) {
  const comparison = {
    bundles: {},
    alerts: [],
    totalChange: 0,
    hasSignificantChange: false
  };

  if (!previous) {
    comparison.alerts.push('No previous data to compare against');
    return comparison;
  }

  // Compare each bundle
  for (const [bundleName, currentSize] of Object.entries(current)) {
    const previousSize = previous[bundleName] || 0;
    const change = currentSize - previousSize;
    const percentageChange = calculatePercentageChange(currentSize, previousSize);

    comparison.bundles[bundleName] = {
      current: currentSize,
      previous: previousSize,
      change,
      percentageChange,
      isSignificant: Math.abs(percentageChange) >= threshold
    };

    if (Math.abs(percentageChange) >= threshold) {
      comparison.hasSignificantChange = true;

      const direction = change > 0 ? 'increased' : 'decreased';
      const emoji = change > 0 ? '⚠️' : '✅';

      comparison.alerts.push(
        `${emoji} ${bundleName} ${direction} by ${Math.abs(percentageChange).toFixed(2)}% ` +
        `(${formatBytes(previousSize)} → ${formatBytes(currentSize)})`
      );
    }
  }

  // Check for removed bundles
  if (previous) {
    for (const bundleName of Object.keys(previous)) {
      if (!current[bundleName]) {
        comparison.alerts.push(`❌ ${bundleName} was removed`);
      }
    }
  }

  // Calculate total change
  const currentTotal = current['_total'] || 0;
  const previousTotal = previous['_total'] || 0;
  comparison.totalChange = calculatePercentageChange(currentTotal, previousTotal);

  return comparison;
}

/**
 * Generate markdown report
 * @param {object} comparison - Comparison results
 * @param {object} current - Current bundle sizes
 * @returns {string} Markdown report
 */
function generateMarkdownReport(comparison, current) {
  const lines = [];

  lines.push('## Bundle Size Report\n');

  if (comparison.alerts.length > 0) {
    lines.push('### Alerts\n');
    for (const alert of comparison.alerts) {
      lines.push(`- ${alert}`);
    }
    lines.push('');
  }

  lines.push('### Current Bundle Sizes\n');
  lines.push('| Bundle | Size | Previous | Change |');
  lines.push('|--------|------|----------|--------|');

  for (const [bundleName, bundleComparison] of Object.entries(comparison.bundles)) {
    const { current, previous, change, percentageChange } = bundleComparison;

    const changeStr = previous > 0
      ? `${change > 0 ? '+' : ''}${formatBytes(change)} (${percentageChange > 0 ? '+' : ''}${percentageChange.toFixed(2)}%)`
      : 'New';

    lines.push(
      `| ${bundleName} | ${formatBytes(current)} | ${previous > 0 ? formatBytes(previous) : 'N/A'} | ${changeStr} |`
    );
  }

  lines.push('');

  if (comparison.hasSignificantChange) {
    lines.push('> ⚠️ Significant size changes detected (>10% threshold)');
  } else {
    lines.push('> ✅ No significant size changes detected');
  }

  return lines.join('\n');
}

/**
 * Main tracking function
 */
async function trackBundleSize() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const outputFile = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
  const threshold = parseInt(args.find(arg => arg.startsWith('--threshold='))?.split('=')[1] || '10');
  const maxEntries = parseInt(args.find(arg => arg.startsWith('--max-entries='))?.split('=')[1] || '100');

  console.log('📊 Tracking bundle sizes...\n');

  // Paths
  const projectRoot = join(__dirname, '..');
  const distDir = join(projectRoot, 'dist');
  const historyFile = join(projectRoot, '.bundle-size-history.json');

  // Get current sizes
  const currentSizes = await getBundleSizes(distDir);

  if (verbose) {
    console.log('Current bundle sizes:');
    for (const [name, size] of Object.entries(currentSizes)) {
      console.log(`  ${name}: ${formatBytes(size)}`);
    }
    console.log('');
  }

  // Load history
  const history = await loadHistory(historyFile);

  // Get previous entry (if exists)
  const previousEntry = history.length > 0 ? history[history.length - 1] : null;
  const previousSizes = previousEntry?.bundles;

  // Compare sizes
  const comparison = compareSizes(currentSizes, previousSizes, threshold);

  // Print comparison results
  if (comparison.alerts.length > 0) {
    console.log('Bundle size changes:\n');
    for (const alert of comparison.alerts) {
      console.log(`  ${alert}`);
    }
    console.log('');
  }

  // Create new entry
  const newEntry = {
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || 'local',
    version: process.env.PACKAGE_VERSION || 'unknown',
    bundles: currentSizes,
    comparison: {
      hasSignificantChange: comparison.hasSignificantChange,
      totalChange: comparison.totalChange,
      alerts: comparison.alerts
    }
  };

  // Add to history
  history.push(newEntry);

  // Trim history to max entries
  if (history.length > maxEntries) {
    history.splice(0, history.length - maxEntries);
  }

  // Save history
  await saveHistory(historyFile, history);

  if (verbose) {
    console.log(`✓ Bundle size history saved (${history.length} entries)`);
    console.log(`  History file: ${historyFile}\n`);
  }

  // Generate and save markdown report if requested
  if (outputFile) {
    const report = generateMarkdownReport(comparison, currentSizes);
    await writeFile(outputFile, report, 'utf8');
    console.log(`✓ Report saved to: ${outputFile}\n`);
  }

  // Exit with appropriate code
  if (comparison.hasSignificantChange) {
    console.log('⚠️  Significant bundle size changes detected');
    console.log(`   Total change: ${comparison.totalChange > 0 ? '+' : ''}${comparison.totalChange.toFixed(2)}%\n`);

    // Don't fail the build, just warn
    process.exit(0);
  } else {
    console.log('✅ No significant bundle size changes\n');
    process.exit(0);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  trackBundleSize().catch(error => {
    console.error('❌ Bundle size tracking failed:', error.message);
    process.exit(1);
  });
}

export { trackBundleSize, getBundleSizes, compareSizes, generateMarkdownReport };
