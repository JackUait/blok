#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { formatBytes, normalizeSize } from './lib/bundle-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load bundle size history
 * @param {string} historyFile - Path to history file
 * @returns {Promise<Array>} Historical data
 */
async function loadHistory(historyFile) {
  if (!existsSync(historyFile)) {
    console.error('❌ No history file found at:', historyFile);
    console.log('\nRun the build and tracking script first:');
    console.log('  yarn build');
    console.log('  node scripts/track-bundle-size.mjs\n');
    process.exit(1);
  }

  try {
    const content = await readFile(historyFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('❌ Failed to load history:', error.message);
    process.exit(1);
  }
}

/**
 * Get display size from a size value (supports both old and new formats)
 * @param {number|{raw: number, gzip: number}} size - Size value
 * @returns {number} Size to display (gzip if available, otherwise raw)
 */
function getDisplaySize(size) {
  const normalized = normalizeSize(size);
  return normalized.gzip ?? normalized.raw;
}

/**
 * Format size for display
 * @param {number|{raw: number, gzip: number}} size - Size value
 * @returns {string} Formatted size string
 */
function formatDisplaySize(size) {
  const normalized = normalizeSize(size);
  return formatBytes(normalized.gzip ?? normalized.raw);
}

/**
 * Display history in table format
 * @param {Array} history - Historical data
 * @param {number} limit - Number of entries to show
 */
function displayHistory(history, limit = 10) {
  const entries = history.slice(-limit);

  console.log('Bundle Size History\n');
  console.log('═'.repeat(120));

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleString();
    const commit = entry.commit.substring(0, 7);
    const version = entry.version || 'unknown';

    console.log(`\n📅 ${date} | Commit: ${commit} | Version: ${version}`);
    console.log('─'.repeat(120));

    // Display bundle sizes
    const bundles = Object.entries(entry.bundles)
      .filter(([name]) => name !== '_total')
      .sort((a, b) => getDisplaySize(b[1]) - getDisplaySize(a[1])); // Sort by size descending

    for (const [bundleName, size] of bundles) {
      const displaySize = formatDisplaySize(size);
      console.log(`  ${bundleName.padEnd(30)} ${displaySize.padStart(20)}`);
    }

    // Display total
    if (entry.bundles._total) {
      console.log('  ' + '─'.repeat(52));
      console.log(`  ${'Total'.padEnd(30)} ${formatDisplaySize(entry.bundles._total).padStart(20)}`);
    }

    // Display alerts if any
    if (entry.comparison?.alerts && entry.comparison.alerts.length > 0) {
      console.log('\n  Alerts:');
      for (const alert of entry.comparison.alerts) {
        console.log(`    ${alert}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(120));
}

/**
 * Display trend analysis
 * @param {Array} history - Historical data
 */
function displayTrends(history) {
  if (history.length < 2) {
    console.log('Not enough data for trend analysis (need at least 2 entries)');
    return;
  }

  console.log('\nTrend Analysis (First → Last)\n');
  console.log('═'.repeat(120));

  const first = history[0];
  const last = history[history.length - 1];

  // Get all bundle names that appear in either first or last
  const allBundles = new Set([
    ...Object.keys(first.bundles),
    ...Object.keys(last.bundles)
  ]);

  const trends = [];

  for (const bundleName of allBundles) {
    const firstSize = getDisplaySize(first.bundles[bundleName] || 0);
    const lastSize = getDisplaySize(last.bundles[bundleName] || 0);

    if (firstSize === 0 && lastSize === 0) continue;

    const change = lastSize - firstSize;
    const percentageChange = firstSize > 0 ? ((change / firstSize) * 100) : 100;

    trends.push({
      name: bundleName,
      firstSize,
      lastSize,
      change,
      percentageChange
    });
  }

  // Sort by absolute percentage change (descending)
  trends.sort((a, b) => Math.abs(b.percentageChange) - Math.abs(a.percentageChange));

  for (const trend of trends) {
    const { name, firstSize, lastSize, change, percentageChange } = trend;

    let emoji = '  ';
    if (Math.abs(percentageChange) >= 20) {
      emoji = change > 0 ? '⚠️ ' : '✅';
    } else if (Math.abs(percentageChange) >= 10) {
      emoji = change > 0 ? '📈' : '📉';
    } else {
      emoji = '➡️ ';
    }

    const changeStr = change > 0 ? `+${formatBytes(change)}` : formatBytes(change);
    const percentStr = percentageChange > 0 ? `+${percentageChange.toFixed(1)}%` : `${percentageChange.toFixed(1)}%`;

    console.log(
      `${emoji} ${name.padEnd(30)} ${formatBytes(firstSize).padStart(10)} → ${formatBytes(lastSize).padStart(10)} ` +
      `(${changeStr.padStart(12)} / ${percentStr.padStart(8)})`
    );
  }

  console.log('═'.repeat(120));

  // Summary
  const firstDate = new Date(first.timestamp).toLocaleDateString();
  const lastDate = new Date(last.timestamp).toLocaleDateString();
  const totalEntries = history.length;

  console.log(`\nAnalyzed ${totalEntries} entries from ${firstDate} to ${lastDate}`);
}

/**
 * Export data as CSV
 * @param {Array} history - Historical data
 * @param {string} outputFile - Output CSV file path
 */
async function exportToCsv(history, outputFile) {
  const { writeFile } = await import('fs/promises');

  // Get all unique bundle names
  const allBundles = new Set();
  for (const entry of history) {
    for (const bundleName of Object.keys(entry.bundles)) {
      allBundles.add(bundleName);
    }
  }

  const bundleNames = Array.from(allBundles).sort();

  // Create CSV header (with _gzip suffix for gzip sizes)
  const header = ['timestamp', 'commit', 'version', ...bundleNames.map(n => `${n}_raw`), ...bundleNames.map(n => `${n}_gzip`)].join(',');

  // Create CSV rows
  const rows = history.map(entry => {
    const rawSizes = bundleNames.map(name => {
      const size = entry.bundles[name];
      if (!size) return '';
      const normalized = normalizeSize(size);
      return normalized.raw;
    });

    const gzipSizes = bundleNames.map(name => {
      const size = entry.bundles[name];
      if (!size) return '';
      const normalized = normalizeSize(size);
      return normalized.gzip ?? '';
    });

    const row = [
      entry.timestamp,
      entry.commit,
      entry.version || 'unknown',
      ...rawSizes,
      ...gzipSizes
    ];
    return row.join(',');
  });

  const csv = [header, ...rows].join('\n');

  await writeFile(outputFile, csv, 'utf8');
  console.log(`✓ Exported to ${outputFile}`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const showTrends = args.includes('--trends') || args.includes('-t');
  const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '10');
  const csvOutput = args.find(arg => arg.startsWith('--csv='))?.split('=')[1];

  const projectRoot = join(__dirname, '..');
  const historyFile = join(projectRoot, '.bundle-size-history.json');

  const history = await loadHistory(historyFile);

  if (history.length === 0) {
    console.log('No bundle size history found.');
    return;
  }

  // Display history
  displayHistory(history, limit);

  // Display trends if requested
  if (showTrends) {
    displayTrends(history);
  }

  // Export to CSV if requested
  if (csvOutput) {
    await exportToCsv(history, csvOutput);
  }

  // Show help for additional options
  if (!showTrends && !csvOutput) {
    console.log('\nOptions:');
    console.log('  --trends, -t          Show trend analysis');
    console.log('  --limit=N             Show last N entries (default: 10)');
    console.log('  --csv=FILE            Export data to CSV file\n');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
}

export { loadHistory, displayHistory, displayTrends, exportToCsv };
