import { stat, readdir } from 'fs/promises';
import { join } from 'path';

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
 * Verify bundle sizes are within expected ranges
 * @param {string} packageDir - Path to node_modules/@jackuait/blok
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkBundleSize(packageDir, verbose = false) {
  const details = {
    bundles: {},
    warnings: [],
    totalSize: 0
  };

  // Bundle size limits (in bytes)
  const limits = {
    'blok.umd.js': 800 * 1024, // 800KB
    'blok.mjs': 5 * 1024,      // 5KB (entry point)
    total: 3 * 1024 * 1024     // 3MB total package
  };

  try {
    const distDir = join(packageDir, 'dist');

    // Get all files in dist directory
    const files = await readdir(distDir);

    // Check specific bundle files
    const bundlesToCheck = ['blok.umd.js', 'blok.mjs', 'locales.mjs'];

    for (const bundleName of bundlesToCheck) {
      if (files.includes(bundleName)) {
        const bundlePath = join(distDir, bundleName);
        const stats = await stat(bundlePath);
        const size = stats.size;

        details.bundles[bundleName] = {
          size,
          sizeFormatted: formatBytes(size),
          limit: limits[bundleName] || null,
          limitFormatted: limits[bundleName] ? formatBytes(limits[bundleName]) : 'N/A',
          withinLimit: limits[bundleName] ? size <= limits[bundleName] : true
        };

        if (verbose) {
          const status = details.bundles[bundleName].withinLimit ? '✓' : '✗';
          console.log(`  ${status} ${bundleName}: ${formatBytes(size)} ${limits[bundleName] ? `(limit: ${formatBytes(limits[bundleName])})` : ''}`);
        }

        if (limits[bundleName] && size > limits[bundleName]) {
          details.warnings.push(
            `${bundleName} exceeds size limit: ${formatBytes(size)} > ${formatBytes(limits[bundleName])}`
          );
        }
      }
    }

    // Check main chunk (blok-*.mjs pattern)
    const mainChunkPattern = /^blok-[a-zA-Z0-9]+\.mjs$/;
    const mainChunks = files.filter(f => mainChunkPattern.test(f));

    if (mainChunks.length > 0) {
      for (const chunkName of mainChunks) {
        const chunkPath = join(distDir, chunkName);
        const stats = await stat(chunkPath);
        const size = stats.size;
        const limit = 1024 * 1024; // 1MB

        details.bundles[chunkName] = {
          size,
          sizeFormatted: formatBytes(size),
          limit,
          limitFormatted: formatBytes(limit),
          withinLimit: size <= limit
        };

        if (verbose) {
          const status = size <= limit ? '✓' : '✗';
          console.log(`  ${status} ${chunkName}: ${formatBytes(size)} (limit: ${formatBytes(limit)})`);
        }

        if (size > limit) {
          details.warnings.push(
            `${chunkName} exceeds size limit: ${formatBytes(size)} > ${formatBytes(limit)}`
          );
        }
      }
    }

    // Calculate total package size
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

    details.totalSize = await calculateDirSize(packageDir);
    details.totalSizeFormatted = formatBytes(details.totalSize);
    details.totalLimit = limits.total;
    details.totalLimitFormatted = formatBytes(limits.total);

    if (verbose) {
      const status = details.totalSize <= limits.total ? '✓' : '⚠';
      console.log(`  ${status} Total package size: ${formatBytes(details.totalSize)} (limit: ${formatBytes(limits.total)})`);
    }

    if (details.totalSize > limits.total) {
      details.warnings.push(
        `Total package size exceeds limit: ${formatBytes(details.totalSize)} > ${formatBytes(limits.total)}`
      );
    }

    // Bundle size warnings don't fail the check, just warn
    if (details.warnings.length > 0) {
      if (verbose) {
        console.log('  ⚠ Bundle size warnings (non-blocking):');
        details.warnings.forEach(w => console.log(`    - ${w}`));
      }
    }

    return {
      passed: true, // Always pass, warnings are informational
      message: details.warnings.length > 0
        ? `Bundle size check completed with ${details.warnings.length} warning(s)`
        : 'Bundle sizes verified successfully',
      details
    };

  } catch (error) {
    return {
      passed: false,
      message: `Bundle size check failed: ${error.message}`,
      details
    };
  }
}
