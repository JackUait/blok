#!/usr/bin/env node

import { stat, readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  formatBytes,
  calculatePercentageChange,
  getGzipSize,
  normalizeSize,
  getComparisonSize,
  formatSizeForDisplay,
  getChunkGroup
} from './lib/bundle-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get all bundle sizes from dist directory
 * @param {string} distDir - Path to dist directory
 * @returns {Promise<object>} Bundle sizes with raw and gzip
 */
async function getBundleSizes(distDir) {
  const bundles = {};

  try {
    const files = await readdir(distDir);

    // Track specific bundles (ES modules only)
    const bundlesToTrack = ['blok.mjs', 'locales.mjs'];

    for (const bundleName of bundlesToTrack) {
      if (files.includes(bundleName)) {
        const bundlePath = join(distDir, bundleName);
        const stats = await stat(bundlePath);
        const gzip = await getGzipSize(bundlePath);
        bundles[bundleName] = { raw: stats.size, gzip };
      }
    }

    // Track main chunk (blok-*.mjs pattern)
    const mainChunkPattern = /^blok-[a-zA-Z0-9]+\.mjs$/;
    const mainChunks = files.filter(f => mainChunkPattern.test(f));

    for (const chunkName of mainChunks) {
      const chunkPath = join(distDir, chunkName);
      const stats = await stat(chunkPath);
      const gzip = await getGzipSize(chunkPath);
      bundles[chunkName] = { raw: stats.size, gzip };
    }

    // Track locales chunk (locales-*.mjs pattern)
    const localesChunkPattern = /^locales-[a-zA-Z0-9]+\.mjs$/;
    const localesChunks = files.filter(f => localesChunkPattern.test(f));

    for (const chunkName of localesChunks) {
      const chunkPath = join(distDir, chunkName);
      const stats = await stat(chunkPath);
      const gzip = await getGzipSize(chunkPath);
      bundles[chunkName] = { raw: stats.size, gzip };
    }

    // Calculate total dist size
    const calculateDirSize = async (dir) => {
      let totalRaw = 0;
      let totalGzip = 0;
      const items = await readdir(dir, { withFileTypes: true });

      for (const item of items) {
        const itemPath = join(dir, item.name);
        if (item.isDirectory()) {
          const subTotal = await calculateDirSize(itemPath);
          totalRaw += subTotal.raw;
          totalGzip += subTotal.gzip;
        } else {
          const stats = await stat(itemPath);
          totalRaw += stats.size;
          // Only gzip .mjs files for total
          if (item.name.endsWith('.mjs')) {
            totalGzip += await getGzipSize(itemPath);
          } else {
            totalGzip += stats.size;
          }
        }
      }

      return { raw: totalRaw, gzip: totalGzip };
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
 * Group bundles by chunk group and sum their sizes
 * @param {object} bundles - Bundle sizes
 * @returns {object} Grouped sizes
 */
function groupBundlesByChunk(bundles) {
  const groups = {};

  for (const [bundleName, size] of Object.entries(bundles)) {
    const group = getChunkGroup(bundleName);
    const normalized = normalizeSize(size);

    if (!groups[group]) {
      groups[group] = { raw: 0, gzip: 0, files: [] };
    }

    groups[group].raw += normalized.raw;
    groups[group].gzip += normalized.gzip ?? normalized.raw;
    groups[group].files.push(bundleName);
  }

  return groups;
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

  // Group bundles to handle renamed chunks
  const currentGroups = groupBundlesByChunk(current);
  const previousGroups = groupBundlesByChunk(previous);

  // Compare each group
  for (const [groupName, currentGroup] of Object.entries(currentGroups)) {
    const previousGroup = previousGroups[groupName];
    const previousGzip = previousGroup?.gzip || 0;
    const change = currentGroup.gzip - previousGzip;
    const percentageChange = calculatePercentageChange(currentGroup.gzip, previousGzip);

    comparison.bundles[groupName] = {
      current: { raw: currentGroup.raw, gzip: currentGroup.gzip },
      previous: previousGroup ? { raw: previousGroup.raw, gzip: previousGroup.gzip } : null,
      change,
      percentageChange,
      isSignificant: Math.abs(percentageChange) >= threshold
    };

    if (Math.abs(percentageChange) >= threshold && previousGzip > 0) {
      comparison.hasSignificantChange = true;

      const direction = change > 0 ? 'increased' : 'decreased';
      const emoji = change > 0 ? '⚠️' : '✅';

      comparison.alerts.push(
        `${emoji} ${groupName} ${direction} by ${Math.abs(percentageChange).toFixed(2)}% ` +
        `(${formatBytes(previousGzip)} → ${formatBytes(currentGroup.gzip)} gzip)`
      );
    }
  }

  // Check for removed groups (not just renamed chunks)
  for (const groupName of Object.keys(previousGroups)) {
    if (!currentGroups[groupName]) {
      comparison.alerts.push(`❌ ${groupName} was removed`);
    }
  }

  // Calculate total change using gzip sizes
  const currentTotal = getComparisonSize(current['_total']);
  const previousTotal = getComparisonSize(previous['_total']);
  comparison.totalChange = calculatePercentageChange(currentTotal, previousTotal);

  return comparison;
}

/**
 * Load bundle variants data if available
 * @param {string} variantsFile - Path to variants JSON file
 * @returns {Promise<object|null>} Variants data or null
 */
async function loadVariants(variantsFile) {
  if (!existsSync(variantsFile)) {
    return null;
  }

  try {
    const content = await readFile(variantsFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn('Failed to load variants data:', error.message);
    return null;
  }
}

/**
 * Generate markdown report
 * @param {object} comparison - Comparison results
 * @param {object} current - Current bundle sizes
 * @param {object|null} variants - Bundle variants data (minimum/normal/maximum)
 * @param {object|null} previousVariants - Previous variants for comparison
 * @param {number} threshold - Percentage threshold for significant changes
 * @returns {string} Markdown report
 */
function generateMarkdownReport(comparison, _current, variants = null, previousVariants = null, threshold = 10) {
  const lines = [];

  lines.push('## Bundle Size Report\n');

  // Bundle Size Tiers section (if variants available)
  if (variants) {
    lines.push('### Bundle Size Tiers\n');
    lines.push('| Tier | Size | Previous | Change | Description |');
    lines.push('|------|------|----------|--------|-------------|');

    for (const [name, data] of Object.entries(variants)) {
      const currentSize = normalizeSize(data.size);
      const prevData = previousVariants?.[name];
      const prevSize = prevData ? normalizeSize(prevData.size) : null;

      const currentGzip = currentSize.gzip ?? currentSize.raw;
      const prevGzip = prevSize ? (prevSize.gzip ?? prevSize.raw) : 0;

      const change = currentGzip - prevGzip;
      const percentageChange = prevGzip > 0
        ? ((change / prevGzip) * 100).toFixed(2)
        : 0;

      const changeStr = prevGzip > 0
        ? `${change > 0 ? '+' : ''}${formatBytes(change)} (${change > 0 ? '+' : ''}${percentageChange}%)`
        : 'New';

      const tierName = name.charAt(0).toUpperCase() + name.slice(1);

      lines.push(
        `| **${tierName}** | ${formatBytes(currentGzip)} | ${prevGzip > 0 ? formatBytes(prevGzip) : 'N/A'} | ${changeStr} | ${data.description} |`
      );
    }

    lines.push('');
  }

  if (comparison.alerts.length > 0) {
    lines.push('### Alerts\n');
    for (const alert of comparison.alerts) {
      lines.push(`- ${alert}`);
    }
    lines.push('');
  }

  if (comparison.hasSignificantChange) {
    lines.push(`> ⚠️ Significant size changes detected (>${threshold}% threshold)`);
  } else {
    lines.push(`> ✅ No significant size changes (threshold: ${threshold}%)`);
  }

  return lines.join('\n');
}

/**
 * Main tracking function
 */
async function trackBundleSize() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const withVariants = args.includes('--with-variants');
  const compareOnly = args.includes('--compare-only');
  const outputFile = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
  const threshold = parseInt(args.find(arg => arg.startsWith('--threshold='))?.split('=')[1] || '10');
  const maxEntries = parseInt(args.find(arg => arg.startsWith('--max-entries='))?.split('=')[1] || '100');

  console.log('📊 Tracking bundle sizes...\n');

  // Paths
  const projectRoot = join(__dirname, '..');
  const distDir = join(projectRoot, 'dist');
  const historyFile = join(projectRoot, '.bundle-size-history.json');
  const variantsFile = join(projectRoot, '.bundle-variants.json');

  // Get current sizes
  const currentSizes = await getBundleSizes(distDir);

  if (verbose) {
    console.log('Current bundle sizes:');
    for (const [name, size] of Object.entries(currentSizes)) {
      console.log(`  ${name}: ${formatSizeForDisplay(size)}`);
    }
    console.log('');
  }

  // Load variants if requested and available
  let variants = null;
  if (withVariants) {
    variants = await loadVariants(variantsFile);
    if (variants && verbose) {
      console.log('Bundle size tiers:');
      for (const [name, data] of Object.entries(variants)) {
        console.log(`  ${name}: ${formatSizeForDisplay(data.size)}`);
      }
      console.log('');
    } else if (!variants) {
      console.log('⚠️  No variants data found. Run yarn bundle:variants first.\n');
    }
  }

  // Load history
  const history = await loadHistory(historyFile);

  // Get previous entry (if exists)
  const previousEntry = history.length > 0 ? history[history.length - 1] : null;
  const previousSizes = previousEntry?.bundles;
  const previousVariants = previousEntry?.variants || null;

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

  // Only update history if not in compare-only mode
  if (!compareOnly) {
    // Create new entry
    const newEntry = {
      timestamp: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || 'local',
      version: process.env.PACKAGE_VERSION || 'unknown',
      bundles: currentSizes,
      variants: variants || undefined,
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
  }

  // Generate and save markdown report if requested
  if (outputFile) {
    const report = generateMarkdownReport(comparison, currentSizes, variants, previousVariants, threshold);
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
