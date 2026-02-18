#!/usr/bin/env node

/**
 * CLI for Unused CSS Finder
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedCSS } from './css-parser.js';
import type { ScanResult } from './scanner.js';
import type { UnusedCSSReport } from './analyzer.js';
import type { ReportFormat } from './reporter.js';

const currentFilename = fileURLToPath(import.meta.url);
const currentDirname = dirname(currentFilename);

interface ImportedModule {
  parseCSS: (content: string, filePath: string) => ParsedCSS;
  scanSourceDirectory: (dir: string) => Promise<ScanResult>;
  analyzeUnusedCSS: (parsedCSS: ParsedCSS[], sourceScan: ScanResult, options: { ignoreTailwindUtilities: boolean }) => UnusedCSSReport;
  generateReport: (report: UnusedCSSReport, format: ReportFormat) => string;
}

// Import the module - using the .js extension as required by TypeScript ESM
const importModule = async (): Promise<ImportedModule> => {
  const modulePath = join(currentDirname, 'index.js');
  return await import(modulePath) as ImportedModule;
};

/**
 * Get CSS file extension for a filename
 */
const getCSSExtension = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.module.css')) return '.module.css';
  if (lower.endsWith('.css')) return '.css';
  return '';
};

/**
 * Check if a directory should be skipped during scanning
 */
const isExcludedDir = (name: string): boolean => {
  return ['node_modules', '.git', 'dist', 'build'].includes(name);
};

/**
 * Find all CSS files in a directory
 */
const findCSSFiles = async (dir: string, extensions: string[] = ['.css']): Promise<string[]> => {
  const { readdir } = await import('node:fs/promises');
  const { join: pathJoin } = await import('node:path');

  const files: string[] = [];

  const scan = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = pathJoin(currentDir, entry.name);

      if (entry.isDirectory() && !isExcludedDir(entry.name)) {
        await scan(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = getCSSExtension(entry.name);
      if (extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  };

  await scan(dir);
  return files;
};

interface CLIOptions {
  cssDir: string;
  srcDir: string;
  format: ReportFormat;
  output: string | null;
  ignoreTailwind: boolean;
}

const HELP_TEXT = `
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
`;

const VALID_FORMATS = ['text', 'json', 'markdown'];

/**
 * Parse CLI arguments into options
 */
/**
 * Get the value for a flag argument (the next arg after the flag)
 */
const getFlagValue = (args: string[], index: number): string | undefined => {
  return args[index + 1];
};

const parseArgs = (args: string[]): CLIOptions | null => {
  const options: CLIOptions = {
    cssDir: '.',
    srcDir: '.',
    format: 'text',
    output: null,
    ignoreTailwind: true,
  };

  const flagHandlers: Record<string, (value: string) => void> = {
    '--css-dir': (value: string) => { options.cssDir = value; },
    '--src-dir': (value: string) => { options.srcDir = value; },
    '--format': (value: string) => { options.format = value as ReportFormat; },
    '--output': (value: string) => { options.output = value; },
  };

  const skipIndices = new Set<number>();

  args.forEach((arg, i) => {
    if (skipIndices.has(i)) return;

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    }

    if (arg === '--include-tailwind') {
      options.ignoreTailwind = false;
      return;
    }

    const handler = flagHandlers[arg];
    const value = getFlagValue(args, i);
    if (handler && value) {
      handler(value);
      skipIndices.add(i + 1);
    }
  });

  if (!VALID_FORMATS.includes(options.format)) {
    console.error(`Error: Invalid format '${options.format}'. Must be one of: text, json, markdown`);
    process.exit(1);
  }

  return options;
};

/**
 * Main CLI function
 */
const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const { parseCSS, scanSourceDirectory, analyzeUnusedCSS, generateReport } = await importModule();

  const options = parseArgs(args);
  if (!options) return;

  const { cssDir, srcDir, format, output, ignoreTailwind } = options;

  // Find CSS files
  console.error(`Scanning CSS files in: ${cssDir}`);
  const cssFiles = await findCSSFiles(cssDir);

  if (cssFiles.length === 0) {
    console.error('No CSS files found');
    process.exit(1);
  }

  console.error(`Found ${cssFiles.length} CSS file(s)`);

  // Parse CSS files
  const parsedCSS: ParsedCSS[] = [];
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
};

// Run
main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
