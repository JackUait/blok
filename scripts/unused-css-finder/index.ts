/**
 * Unused CSS Finder
 * A tool for finding and reporting unused CSS classes and data attributes
 */

export { extractClassNames, extractSelectors, parseCSS } from './css-parser.js';
export { findCSSUsage, scanFile, scanSourceDirectory } from './scanner.js';
export { analyzeUnusedCSS } from './analyzer.js';
export { generateReport, type ReportFormat } from './reporter.js';

export type { ParsedCSS, Selector } from './css-parser.js';
export type { CSSUsage, FileScanResult, ScanResult } from './scanner.js';
export type { AnalyzerOptions, UnusedCSSReport, FileUnusedItems } from './analyzer.js';
