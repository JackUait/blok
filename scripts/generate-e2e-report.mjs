#!/usr/bin/env node

/**
 * E2E Test Report Generator for PR Comments
 *
 * Generates a concise markdown summary of E2E test results from Playwright JSON reports.
 *
 * Usage:
 *   node scripts/generate-e2e-report.mjs [options]
 *
 * Options:
 *   --input <file>    Path to merged test results JSON (default: playwright-report/results.json)
 *   --output <file>   Output file for markdown report (default: stdout)
 */

import fs from 'fs';
import path from 'path';

// Configuration
const config = {
  inputFile: 'playwright-report/results.json',
  outputFile: null,
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  // Handle --key=value format
  if (arg.startsWith('--input=')) {
    config.inputFile = arg.slice('--input='.length);
  } else if (arg.startsWith('--output=')) {
    config.outputFile = arg.slice('--output='.length);
  // Handle --key value format
  } else if (arg === '--input') {
    config.inputFile = args[++i];
  } else if (arg === '--output') {
    config.outputFile = args[++i];
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Extract file:line from test location
 */
function extractLocation(test) {
  if (test.location?.file && test.location?.line) {
    const file = path.basename(test.location.file);
    return `${file}:${test.location.line}`;
  }
  return null;
}

/**
 * Process test results and extract metrics
 */
function processResults(results) {
  const metrics = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    duration: 0,
    projects: new Map(),
    failedTests: [],
    flakyTests: [],
  };

  function processSpec(spec, suitePath) {
    const testTitle = [...suitePath, spec.title].filter(Boolean).join(' > ');

    for (const test of spec.tests || []) {
      const projectName = test.projectName || 'default';

      // Initialize project metrics
      if (!metrics.projects.has(projectName)) {
        metrics.projects.set(projectName, {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          flaky: 0,
          duration: 0,
        });
      }

      const project = metrics.projects.get(projectName);
      metrics.total++;
      project.total++;

      // Calculate duration from all results
      let testDuration = 0;
      for (const result of test.results || []) {
        testDuration += result.duration || 0;
      }
      metrics.duration += testDuration;
      project.duration += testDuration;

      // Determine test status
      const resultCount = test.results?.length || 0;
      const lastResult = test.results?.[resultCount - 1];
      const status = lastResult?.status || test.status;

      if (status === 'passed') {
        // Check if flaky (passed after retries)
        if (resultCount > 1) {
          metrics.flaky++;
          project.flaky++;
          metrics.flakyTests.push({
            title: testTitle,
            project: projectName,
            retries: resultCount - 1,
            location: extractLocation(test),
          });
        }
        metrics.passed++;
        project.passed++;
      } else if (status === 'failed' || status === 'timedOut') {
        metrics.failed++;
        project.failed++;
        metrics.failedTests.push({
          title: testTitle,
          project: projectName,
          location: extractLocation(test),
          error: lastResult?.error?.message?.split('\n')[0] || 'Unknown error',
        });
      } else if (status === 'skipped') {
        metrics.skipped++;
        project.skipped++;
      }
    }
  }

  function processSuite(suite, path = []) {
    const suitePath = [...path, suite.title].filter(Boolean);

    for (const spec of suite.specs || []) {
      processSpec(spec, suitePath);
    }

    for (const childSuite of suite.suites || []) {
      processSuite(childSuite, suitePath);
    }
  }

  // Process all suites
  for (const suite of results.suites || []) {
    processSuite(suite);
  }

  return metrics;
}

/**
 * Generate markdown report
 */
function generateMarkdown(metrics) {
  const allPassed = metrics.failed === 0;
  const statusIcon = allPassed ? '✅' : '❌';
  const statusText = allPassed ? 'All tests passed!' : `${metrics.failed} test${metrics.failed > 1 ? 's' : ''} failed`;

  // Find the longest browser duration
  let longestDuration = 0;
  for (const [, project] of metrics.projects) {
    if (project.duration > longestDuration) {
      longestDuration = project.duration;
    }
  }

  let md = `## 🧪 E2E Test Report\n\n`;
  md += `**${statusIcon} ${statusText}**\n\n`;

  // Summary table
  md += `| Status | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| ✅ Passed | ${metrics.passed} |\n`;
  if (metrics.failed > 0) {
    md += `| ❌ Failed | ${metrics.failed} |\n`;
  }
  if (metrics.skipped > 0) {
    md += `| ⏭️ Skipped | ${metrics.skipped} |\n`;
  }
  if (metrics.flaky > 0) {
    md += `| 🔄 Flaky | ${metrics.flaky} |\n`;
  }
  md += `| ⏱️ Total Duration (all browsers combined) | ${formatDuration(metrics.duration)} |\n`;
  md += `| ⏱️ Longest Browser | ${formatDuration(longestDuration)} |\n`;
  md += `\n`;

  // Browser/project breakdown
  if (metrics.projects.size > 1) {
    md += `### Browser Results\n\n`;
    md += `| Browser | Tests | Passed | Failed | Duration |\n`;
    md += `|---------|-------|--------|--------|----------|\n`;

    // Sort projects by name for consistent ordering
    const sortedProjects = [...metrics.projects.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, project] of sortedProjects) {
      const statusEmoji = project.failed > 0 ? '❌' : '✅';
      md += `| ${statusEmoji} ${name} | ${project.total} | ${project.passed} | ${project.failed} | ${formatDuration(project.duration)} |\n`;
    }
    md += `\n`;
  }

  // Failed tests details
  if (metrics.failedTests.length > 0) {
    md += `### ❌ Failed Tests\n\n`;
    md += `| Test | Location | Browser |\n`;
    md += `|------|----------|----------|\n`;

    for (const test of metrics.failedTests.slice(0, 10)) {
      const location = test.location || 'N/A';
      md += `| ${test.title} | \`${location}\` | ${test.project} |\n`;
    }

    if (metrics.failedTests.length > 10) {
      md += `\n*... and ${metrics.failedTests.length - 10} more failed tests*\n`;
    }
    md += `\n`;
  }

  // Flaky tests warning
  if (metrics.flakyTests.length > 0) {
    md += `<details>\n<summary>🔄 Flaky Tests (${metrics.flakyTests.length})</summary>\n\n`;
    md += `| Test | Retries | Browser |\n`;
    md += `|------|---------|----------|\n`;

    for (const test of metrics.flakyTests.slice(0, 10)) {
      md += `| ${test.title} | ${test.retries} | ${test.project} |\n`;
    }

    if (metrics.flakyTests.length > 10) {
      md += `\n*... and ${metrics.flakyTests.length - 10} more flaky tests*\n`;
    }
    md += `\n</details>\n`;
  }

  return md;
}

/**
 * Main execution
 */
async function main() {
  try {
    const inputPath = path.resolve(process.cwd(), config.inputFile);

    if (!fs.existsSync(inputPath)) {
      console.error(`Error: Input file not found: ${inputPath}`);
      process.exit(1);
    }

    const results = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    const metrics = processResults(results);
    const markdown = generateMarkdown(metrics);

    if (config.outputFile) {
      fs.writeFileSync(config.outputFile, markdown);
      console.log(`Report saved to: ${config.outputFile}`);
    } else {
      console.log(markdown);
    }

    // Always exit successfully - the report itself shows pass/fail status
    // The CI workflow handles failure detection separately
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
