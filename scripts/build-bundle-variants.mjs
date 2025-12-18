#!/usr/bin/env node

/**
 * Build bundle size variants for measurement.
 *
 * This script builds three variants of the bundle:
 * - Minimum: Core editor only (no bundled tools, no locales)
 * - Normal: Standard build (bundled tools + English locale)
 * - Maximum: All tools + all 68 locales statically bundled
 *
 * Results are written to .bundle-variants.json for use by track-bundle-size.mjs
 */

import { build } from 'vite';
import { stat, readdir, writeFile, rm, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import { formatBytes, getGzipSize } from './lib/bundle-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

/**
 * Variant configurations
 */
const VARIANTS = {
  minimum: {
    entry: 'src/variants/blok-minimum.ts',
    outDir: 'dist-variants/minimum',
    description: 'Core editor only (no bundled tools, no locales)',
  },
  normal: {
    entry: null, // Uses existing dist/ build
    outDir: 'dist',
    description: 'Standard build (bundled tools + English locale)',
  },
  maximum: {
    entry: 'src/variants/blok-maximum.ts',
    outDir: 'dist-variants/maximum',
    description: 'All tools + all 68 locales bundled',
  },
};

/**
 * Calculate total size of a directory (recursively)
 */
async function calculateDirSize(dir) {
  let totalRaw = 0;
  let totalGzip = 0;

  if (!existsSync(dir)) {
    return { raw: 0, gzip: 0 };
  }

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
      // Only gzip .mjs files
      if (item.name.endsWith('.mjs')) {
        totalGzip += await getGzipSize(itemPath);
      } else {
        totalGzip += stats.size;
      }
    }
  }

  return { raw: totalRaw, gzip: totalGzip };
}

/**
 * Get sizes of all .mjs files in a directory
 */
async function getMjsSizes(dir) {
  const files = {};

  if (!existsSync(dir)) {
    return files;
  }

  const items = await readdir(dir);

  for (const item of items) {
    if (item.endsWith('.mjs')) {
      const itemPath = join(dir, item);
      const stats = await stat(itemPath);
      const gzip = await getGzipSize(itemPath);
      files[item] = { raw: stats.size, gzip };
    }
  }

  return files;
}

/**
 * Build a variant using Vite
 */
async function buildVariant(name, config) {
  const outDir = join(projectRoot, config.outDir);

  console.log(`\n📦 Building ${name} variant...`);

  // Clean output directory for variant builds (not normal)
  if (name !== 'normal' && existsSync(outDir)) {
    await rm(outDir, { recursive: true });
  }

  await mkdir(outDir, { recursive: true });

  await build({
    configFile: false,
    root: projectRoot,
    mode: 'production',
    logLevel: 'warn',
    build: {
      copyPublicDir: false,
      target: 'es2017',
      outDir: config.outDir,
      emptyOutDir: false,
      lib: {
        entry: join(projectRoot, config.entry),
        // Use 'blok' as the name so CSS injection plugin can find it
        name: 'blok',
        fileName: 'blok',
        formats: ['es'],
      },
    },
    define: {
      NODE_ENV: JSON.stringify('production'),
      VERSION: JSON.stringify('0.0.0-variant'),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    resolve: {
      alias: {
        '@/types': join(projectRoot, 'types'),
      },
    },
    plugins: [
      cssInjectedByJsPlugin({
        jsAssetsFilterFunction: (outputChunk) => {
          // Match any variant entry chunk
          return outputChunk.isEntry;
        },
      }),
    ],
  });

  console.log(`   ✓ ${name} variant built`);
}

/**
 * Measure a variant's size
 * For minimum/maximum variants, we measure only the main bundle (not code-split chunks)
 * For normal, we measure the main bundle + locales entry (what ships by default)
 */
async function measureVariant(name, config) {
  const outDir = join(projectRoot, config.outDir);
  const files = await getMjsSizes(outDir);
  const totalSize = await calculateDirSize(outDir);

  // Find the main bundle file(s)
  let mainBundleRaw = 0;
  let mainBundleGzip = 0;
  const mainBundleFiles = {};

  for (const [fileName, size] of Object.entries(files)) {
    // Include entry points and their chunks, but NOT locale message chunks
    const isEntryPoint = fileName === 'blok.mjs' || fileName === 'locales.mjs';
    const isMainChunk = fileName.startsWith('blok-') && fileName.endsWith('.mjs');

    // For all variants, exclude individual message chunks from the "main" size
    // These are lazy-loaded and shouldn't count toward the core bundle
    if (name === 'normal') {
      // Normal build: include blok.mjs, blok-*.mjs, locales.mjs (but not message chunks)
      if (isEntryPoint || isMainChunk) {
        mainBundleRaw += size.raw;
        mainBundleGzip += size.gzip;
        mainBundleFiles[fileName] = size;
      }
    } else if (name === 'minimum') {
      // Minimum: only blok.mjs and blok-minimum-*.mjs
      if (fileName === 'blok.mjs' || (isMainChunk && fileName.includes('minimum'))) {
        mainBundleRaw += size.raw;
        mainBundleGzip += size.gzip;
        mainBundleFiles[fileName] = size;
      }
    } else if (name === 'maximum') {
      // Maximum: blok.mjs and blok-maximum-*.mjs (all locales are inlined)
      if (fileName === 'blok.mjs' || (isMainChunk && fileName.includes('maximum'))) {
        mainBundleRaw += size.raw;
        mainBundleGzip += size.gzip;
        mainBundleFiles[fileName] = size;
      }
    }
  }

  return {
    size: { raw: mainBundleRaw, gzip: mainBundleGzip },
    totalSize,
    files: mainBundleFiles,
    allFiles: files,
    description: config.description,
  };
}

/**
 * Clean up variant build directories
 */
async function cleanup() {
  const variantsDir = join(projectRoot, 'dist-variants');
  if (existsSync(variantsDir)) {
    await rm(variantsDir, { recursive: true });
    console.log('\n🧹 Cleaned up dist-variants/');
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const skipCleanup = args.includes('--no-cleanup');

  console.log('📊 Building bundle size variants...\n');

  const results = {};

  try {
    // Build minimum variant
    await buildVariant('minimum', VARIANTS.minimum);

    // Normal variant uses existing dist/ - verify it exists
    const normalDir = join(projectRoot, 'dist');
    if (!existsSync(normalDir)) {
      console.error('❌ dist/ directory not found. Run yarn build first.');
      process.exit(1);
    }
    console.log('\n📦 Using existing dist/ for normal variant');

    // Build maximum variant
    await buildVariant('maximum', VARIANTS.maximum);

    // Measure all variants
    console.log('\n📏 Measuring variant sizes...\n');

    for (const [name, config] of Object.entries(VARIANTS)) {
      results[name] = await measureVariant(name, config);

      if (verbose) {
        const size = results[name].size;
        console.log(`   ${name}: ${formatBytes(size.gzip)}`);
        console.log(`      ${config.description}`);
        if (Object.keys(results[name].files).length > 0) {
          for (const [file, fileSize] of Object.entries(results[name].files)) {
            console.log(`      - ${file}: ${formatBytes(fileSize.gzip)}`);
          }
        }
      }
    }

    // Write results
    const outputPath = join(projectRoot, '.bundle-variants.json');
    await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n✓ Results written to .bundle-variants.json`);

    // Print summary
    console.log('\n📊 Bundle Size Tiers:');
    console.log('─'.repeat(60));
    console.log(`   Minimum: ${formatBytes(results.minimum.size.gzip).padStart(10)}`);
    console.log(`   Normal:  ${formatBytes(results.normal.size.gzip).padStart(10)}`);
    console.log(`   Maximum: ${formatBytes(results.maximum.size.gzip).padStart(10)}`);
    console.log('─'.repeat(60));

    // Cleanup unless skipped
    if (!skipCleanup) {
      await cleanup();
    }

    console.log('\n✅ Bundle variants built successfully\n');
  } catch (error) {
    console.error('\n❌ Failed to build bundle variants:', error.message);
    if (verbose) {
      console.error(error.stack);
    }

    // Cleanup on error too
    if (!skipCleanup) {
      await cleanup();
    }

    process.exit(1);
  }
}

// Run if called directly
main();
