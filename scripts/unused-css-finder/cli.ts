#!/usr/bin/env node

/**
 * CLI for Unused CSS Finder
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the module - using the .js extension as required by TypeScript ESM
async function importModule() {
  const modulePath = join(__dirname, 'index.js');
  return await import(modulePath);
}

/**
 * Find all CSS files in a directory
 */
async function findCSSFiles(dir, extensions = ['.css']) {
  const { readdir } = await import('node:fs/promises');
  const { join: pathJoin } = await import('node:path');

  const files = [];

  async function scan(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = pathJoin(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and similar
        if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          await scan(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = entry.name.toLowerCase().endsWith('.css') ? '.css' :
                    entry.name.toLowerCase().endsWith('.module.css') ? '.module.css' : '';
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await scan(dir);
  return files;
}

/**
 * Main CLI function
 */
async function main() {
  const args = process.argv.slice(2);
  const { parseCSS, scanSourceDirectory, analyzeUnusedCSS, generateReport } = await importModule();

  // Parse CLI arguments
  let cssDir = '.';
  let srcDir = '.';
  let format = 'text';
  let output = null;
  let ignoreTailwind = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Unused CSS Finder - Find and report unused CSS classes and data attributes

Usage:
  unused-css-finder [options]

Options:
  --css-dir <path>     Directory containing CSS files (default: .)
  --src-dir <path>     Directory containing source files to scan (default: .)
  --format <format>    Output format: text, json, or markdown (default: text)
  --output <file>      Write report to file instead of stdout
  --include-tailwind   Don't ignore Tailwind utility classes
  --help, -h           Show this help message

Examples:
  unused-css-finder --css-dir ./src/styles --src-dir ./src
  unused-css-finder --format json --output report.json
  unused-css-finder --include-tailwind
      `);
      process.exit(0);
    }

    if (arg === '--css-dir' && args[i + 1]) {
      cssDir = args[++i];
    } else if (arg === '--src-dir' && args[i + 1]) {
      srcDir = args[++i];
    } else if (arg === '--format' && args[i + 1]) {
      format = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      output = args[++i];
    } else if (arg === '--include-tailwind') {
      ignoreTailwind = false;
    }
  }

  // Validate format
  if (!['text', 'json', 'markdown'].includes(format)) {
    console.error(`Error: Invalid format '${format}'. Must be one of: text, json, markdown`);
    process.exit(1);
  }

  // Find CSS files
  console.error(`Scanning CSS files in: ${cssDir}`);
  const cssFiles = await findCSSFiles(cssDir);

  if (cssFiles.length === 0) {
    console.error('No CSS files found');
    process.exit(1);
  }

  console.error(`Found ${cssFiles.length} CSS file(s)`);

  // Parse CSS files
  const parsedCSS = [];
  for (const filePath of cssFiles) {
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseCSS(content, filePath);
    parsedCSS.push(parsed);
    console.error(`  Parsed: ${filePath} (${parsed.classes.length} classes, ${parsed.attributes.length} attributes)`);
  }

  // Scan source files
  console.error(`\nScanning source files in: ${srcDir}`);
  const sourceScan = await scanSourceDirectory(srcDir);
  console.error(`Scanned ${sourceScan.filesScanned} file(s)`);
  console.error(`Found usage of ${sourceScan.allClasses.length} classes and ${sourceScan.allAttributes.length} attributes`);

  // Analyze
  console.error('\nAnalyzing...');
  const report = analyzeUnusedCSS(parsedCSS, sourceScan, { ignoreTailwindUtilities: ignoreTailwind });

  // Generate report
  const outputText = generateReport(report, format);

  // Output
  if (output) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, outputText, 'utf-8');
    console.error(`\nReport written to: ${output}`);
  } else {
    console.log(outputText);
  }

  // Exit with error code if unused CSS found
  if (report.unusedClassesCount > 0 || report.unusedAttributesCount > 0) {
    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
