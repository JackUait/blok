#!/usr/bin/env node

/**
 * CLI for Typography Checker
 * Finds French typography violations in source code
 */

import { scanSourceDirectory } from './scanner.ts';

/**
 * Generate text report
 */
function generateTextReport(result) {
  const lines = [];

  lines.push('='.repeat(50));
  lines.push('Typography Checker Report');
  lines.push('French Typography Rules');
  lines.push('='.repeat(50));
  lines.push('');
  lines.push('Non-breaking spaces (\\u00A0) are required before:');
  lines.push('  ? ! : ; (high punctuation)');
  lines.push('  % € $ (currency symbols)');
  lines.push('  « » (inside guillemets)');
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Files scanned: ${result.filesScanned}`);
  lines.push(`  Total issues: ${result.totalIssues}`);
  lines.push('');

  if (result.totalIssues === 0) {
    lines.push('✨ No typography issues found!');
    return lines.join('\n');
  }

  // Group issues by file
  const issuesByFile = {};
  for (const fileResult of result.fileResults) {
    if (fileResult.issues.length > 0) {
      issuesByFile[fileResult.filePath] = fileResult.issues;
    }
  }

  // Sort by issue count (most issues first)
  const sortedFiles = Object.entries(issuesByFile)
    .sort((a, b) => b[1].length - a[1].length);

  lines.push(`Files with issues: ${sortedFiles.length}`);
  lines.push('');

  for (const [filePath, issues] of sortedFiles) {
    lines.push(`${filePath} (${issues.length} issue${issues.length > 1 ? 's' : ''})`);

    // Group by line number
    const issuesByLine = {};
    for (const issue of issues) {
      if (!issuesByLine[issue.line]) {
        issuesByLine[issue.line] = [];
      }
      issuesByLine[issue.line].push(issue);
    }

    // Show issues sorted by line number
    const sortedLines = Object.keys(issuesByLine).map(Number).sort((a, b) => a - b);
    for (const lineNum of sortedLines) {
      const lineIssues = issuesByLine[lineNum];
      for (const issue of lineIssues) {
        lines.push(`  Line ${issue.line}:${issue.column}  ${issue.type === 'missing-nbsp-guillemets' ? 'Guillemets' : issue.punctuation}`);
        lines.push(`    ${issue.text.replace(/\u00A0/g, '\\u00A0')}`);
        lines.push(`    → Suggestion: ${issue.suggestion.replace(/\u00A0/g, '\\u00A0')}`);
      }
    }
    lines.push('');
  }

  lines.push('Sources:');
  lines.push('  - https://www.noslangues-ourlanguages.gc.ca/en/writing-tips-plus/punctuation-standard-spacing-in-english-and-french');
  lines.push('  - https://brunobernard.com/en/typographic-space-invisible-yet-essential/');

  return lines.join('\n');
}

/**
 * Generate JSON report
 */
function generateJSONReport(result) {
  return JSON.stringify({
    summary: {
      filesScanned: result.filesScanned,
      totalIssues: result.totalIssues,
    },
    issues: result.fileResults
      .filter(f => f.issues.length > 0)
      .map(f => ({
        filePath: f.filePath,
        issues: f.issues,
      })),
  }, null, 2);
}

/**
 * Main CLI function
 */
async function main() {
  const args = process.argv.slice(2);

  let srcDir = '.';
  let format = 'text';
  let fix = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Typography Checker - Find French typography violations

Usage:
  check-typo [options]

Options:
  --src-dir <path>   Directory containing source files to scan (default: .)
  --format <fmt>     Output format: text or json (default: text)
  --fix              Automatically fix issues (experimental)
  --help, -h         Show this help message

Examples:
  check-typo --src-dir ./src
  check-typo --format json
  check-typo --fix

French Typography Rules:
  Non-breaking spaces (\\u00A0) are required before:
    ? ! : ; (high punctuation)
    % € $ (currency symbols)
    « » (inside guillemets)

Sources:
  - Government of Canada - Punctuation: standard spacing in English and French
  - Typographic space: invisible, yet essential
      `);
      process.exit(0);
    }

    if (arg === '--src-dir' && args[i + 1]) {
      srcDir = args[++i];
    } else if (arg === '--format' && args[i + 1]) {
      format = args[++i];
    } else if (arg === '--fix') {
      fix = true;
    }
  }

  console.error(`Scanning source files in: ${srcDir}`);

  const result = await scanSourceDirectory(srcDir);

  console.error(`Scanned ${result.filesScanned} file(s)`);

  if (format === 'json') {
    console.log(generateJSONReport(result));
  } else {
    console.log(generateTextReport(result));
  }

  // Exit with error code if issues found
  if (result.totalIssues > 0) {
    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
