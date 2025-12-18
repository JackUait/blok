#!/usr/bin/env node

/**
 * Performance Regression Analyzer for Playwright Tests
 *
 * This script analyzes test performance metrics from Playwright JSON reports to:
 * - Track test duration trends over time
 * - Detect performance regressions (tests getting slower)
 * - Identify flaky tests (high retry rates)
 * - Generate performance insights and alerts
 *
 * Usage:
 *   node scripts/analyze-performance.mjs [options]
 *
 * Options:
 *   --current <file>       Path to current test results JSON (default: test-results/test-results.json)
 *   --baseline <file>      Path to baseline test results JSON for comparison
 *   --threshold <percent>  Regression threshold percentage (default: 20)
 *   --output <file>        Output file for metrics (JSON format)
 *   --format <type>        Output format: json, markdown, console (default: console)
 *   --fail-on-regression   Exit with code 1 if regressions detected
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const config = {
  currentFile: 'test-results/test-results.json',
  baselineFile: null,
  threshold: 20, // percentage
  outputFile: null,
  format: 'console',
  failOnRegression: false,
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--current':
      config.currentFile = args[++i];
      break;
    case '--baseline':
      config.baselineFile = args[++i];
      break;
    case '--threshold':
      config.threshold = parseFloat(args[++i]);
      break;
    case '--output':
      config.outputFile = args[++i];
      break;
    case '--format':
      config.format = args[++i];
      break;
    case '--fail-on-regression':
      config.failOnRegression = true;
      break;
  }
}

/**
 * Load and parse JSON test results
 */
function loadTestResults(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Test results file not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

/**
 * Extract performance metrics from test results
 */
function extractMetrics(results) {
  const metrics = {
    totalDuration: 0,
    testCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    flakyCount: 0,
    retriedCount: 0,
    tests: [],
    suites: new Map(),
    projects: new Map(),
  };

  // Process each suite
  for (const suite of results.suites || []) {
    processSuite(suite, metrics, []);
  }

  return metrics;
}

/**
 * Recursively process test suites
 */
function processSuite(suite, metrics, path) {
  const suitePath = [...path, suite.title].filter(Boolean);
  const suiteKey = suitePath.join(' > ');

  for (const spec of suite.specs || []) {
    processSpec(spec, metrics, suitePath, suiteKey);
  }

  // Recursively process nested suites
  for (const childSuite of suite.suites || []) {
    processSuite(childSuite, metrics, suitePath);
  }
}

/**
 * Process individual test spec
 */
function processSpec(spec, metrics, suitePath, suiteKey) {
  const testTitle = spec.title;
  const fullTitle = [...suitePath, testTitle].join(' > ');

  // Aggregate results from all attempts
  let totalDuration = 0;
  let status = 'unknown';
  let retryCount = 0;
  let isFlaky = false;

  if (spec.tests && spec.tests.length > 0) {
    for (const test of spec.tests) {
      const projectName = test.projectName || 'default';

      // Initialize project metrics
      if (!metrics.projects.has(projectName)) {
        metrics.projects.set(projectName, {
          name: projectName,
          duration: 0,
          testCount: 0,
          passed: 0,
          failed: 0,
        });
      }

      const projectMetrics = metrics.projects.get(projectName);

      for (const result of test.results || []) {
        totalDuration += result.duration || 0;
        retryCount = test.results.length - 1;

        // Update status
        if (result.status === 'passed') {
          status = 'passed';
        } else if (result.status === 'failed' && status !== 'passed') {
          status = 'failed';
        } else if (result.status === 'skipped' && status === 'unknown') {
          status = 'skipped';
        }
      }

      // Test is flaky if it passed after retries
      if (retryCount > 0 && status === 'passed') {
        isFlaky = true;
        metrics.flakyCount++;
      }

      if (retryCount > 0) {
        metrics.retriedCount++;
      }

      // Update project metrics
      projectMetrics.duration += totalDuration;
      projectMetrics.testCount++;
      if (status === 'passed') {
        projectMetrics.passed++;
      } else if (status === 'failed') {
        projectMetrics.failed++;
      }
    }
  }

  // Update global metrics
  metrics.totalDuration += totalDuration;
  metrics.testCount++;

  if (status === 'passed') {
    metrics.passedCount++;
  } else if (status === 'failed') {
    metrics.failedCount++;
  } else if (status === 'skipped') {
    metrics.skippedCount++;
  }

  // Store test-level metrics
  const testMetric = {
    title: fullTitle,
    suite: suiteKey,
    duration: totalDuration,
    status,
    retryCount,
    isFlaky,
  };

  metrics.tests.push(testMetric);

  // Update suite-level metrics
  if (!metrics.suites.has(suiteKey)) {
    metrics.suites.set(suiteKey, {
      name: suiteKey,
      duration: 0,
      testCount: 0,
      tests: [],
    });
  }

  const suiteMetrics = metrics.suites.get(suiteKey);
  suiteMetrics.duration += totalDuration;
  suiteMetrics.testCount++;
  suiteMetrics.tests.push(testMetric);
}

/**
 * Compare current metrics with baseline to detect regressions
 */
function detectRegressions(current, baseline, threshold) {
  const regressions = {
    overall: null,
    tests: [],
    suites: [],
    projects: [],
  };

  // Compare overall duration
  const overallChange = ((current.totalDuration - baseline.totalDuration) / baseline.totalDuration) * 100;
  if (overallChange > threshold) {
    regressions.overall = {
      type: 'overall',
      current: current.totalDuration,
      baseline: baseline.totalDuration,
      change: overallChange,
    };
  }

  // Compare individual tests
  const baselineTestsMap = new Map(
    baseline.tests.map(t => [t.title, t])
  );

  for (const currentTest of current.tests) {
    const baselineTest = baselineTestsMap.get(currentTest.title);
    if (!baselineTest) continue;

    const change = ((currentTest.duration - baselineTest.duration) / baselineTest.duration) * 100;
    if (change > threshold && baselineTest.duration > 100) { // Only flag if baseline > 100ms
      regressions.tests.push({
        title: currentTest.title,
        current: currentTest.duration,
        baseline: baselineTest.duration,
        change,
      });
    }
  }

  // Compare suites
  for (const [suiteKey, currentSuite] of current.suites) {
    const baselineSuite = baseline.suites.get(suiteKey);
    if (!baselineSuite) continue;

    const change = ((currentSuite.duration - baselineSuite.duration) / baselineSuite.duration) * 100;
    if (change > threshold) {
      regressions.suites.push({
        name: suiteKey,
        current: currentSuite.duration,
        baseline: baselineSuite.duration,
        change,
      });
    }
  }

  // Compare projects
  for (const [projectName, currentProject] of current.projects) {
    const baselineProject = baseline.projects.get(projectName);
    if (!baselineProject) continue;

    const change = ((currentProject.duration - baselineProject.duration) / baselineProject.duration) * 100;
    if (change > threshold) {
      regressions.projects.push({
        name: projectName,
        current: currentProject.duration,
        baseline: baselineProject.duration,
        change,
      });
    }
  }

  return regressions;
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * Generate console output
 */
function generateConsoleOutput(metrics, regressions) {
  console.log('\n📊 Performance Analysis Report\n');
  console.log('═'.repeat(80));

  // Overall metrics
  console.log('\n📈 Overall Metrics:');
  console.log(`  Total Duration:     ${formatDuration(metrics.totalDuration)}`);
  console.log(`  Total Tests:        ${metrics.testCount}`);
  console.log(`  ✅ Passed:          ${metrics.passedCount}`);
  console.log(`  ❌ Failed:          ${metrics.failedCount}`);
  console.log(`  ⏭️  Skipped:         ${metrics.skippedCount}`);
  console.log(`  🔄 Retried:         ${metrics.retriedCount}`);
  console.log(`  ⚠️  Flaky:           ${metrics.flakyCount}`);

  // Project breakdown
  if (metrics.projects.size > 0) {
    console.log('\n🎯 Project Breakdown:');
    for (const [name, project] of metrics.projects) {
      console.log(`  ${name}:`);
      console.log(`    Duration: ${formatDuration(project.duration)}`);
      console.log(`    Tests:    ${project.testCount} (✅ ${project.passed}, ❌ ${project.failed})`);
    }
  }

  // Slowest tests
  const slowestTests = [...metrics.tests]
    .filter(t => t.status === 'passed')
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);

  if (slowestTests.length > 0) {
    console.log('\n🐌 Slowest Tests:');
    for (const test of slowestTests) {
      console.log(`  ${formatDuration(test.duration).padEnd(10)} ${test.title}`);
    }
  }

  // Flaky tests
  const flakyTests = metrics.tests.filter(t => t.isFlaky);
  if (flakyTests.length > 0) {
    console.log('\n⚠️  Flaky Tests (Passed After Retries):');
    for (const test of flakyTests) {
      console.log(`  ${test.title} (retried ${test.retryCount} time${test.retryCount > 1 ? 's' : ''})`);
    }
  }

  // Regressions
  if (regressions) {
    const hasRegressions =
      regressions.overall ||
      regressions.tests.length > 0 ||
      regressions.suites.length > 0 ||
      regressions.projects.length > 0;

    if (hasRegressions) {
      console.log('\n🔴 Performance Regressions Detected!\n');
      console.log('═'.repeat(80));

      if (regressions.overall) {
        console.log('\n🚨 Overall Duration Regression:');
        console.log(`  Baseline: ${formatDuration(regressions.overall.baseline)}`);
        console.log(`  Current:  ${formatDuration(regressions.overall.current)}`);
        console.log(`  Change:   +${regressions.overall.change.toFixed(2)}%`);
      }

      if (regressions.projects.length > 0) {
        console.log('\n📦 Project Regressions:');
        for (const reg of regressions.projects) {
          console.log(`  ${reg.name}:`);
          console.log(`    ${formatDuration(reg.baseline)} → ${formatDuration(reg.current)} (+${reg.change.toFixed(2)}%)`);
        }
      }

      if (regressions.suites.length > 0) {
        console.log('\n📁 Suite Regressions:');
        for (const reg of regressions.suites.slice(0, 5)) {
          console.log(`  ${reg.name}:`);
          console.log(`    ${formatDuration(reg.baseline)} → ${formatDuration(reg.current)} (+${reg.change.toFixed(2)}%)`);
        }
        if (regressions.suites.length > 5) {
          console.log(`  ... and ${regressions.suites.length - 5} more`);
        }
      }

      if (regressions.tests.length > 0) {
        console.log('\n🧪 Test Regressions:');
        for (const reg of regressions.tests.slice(0, 10)) {
          console.log(`  ${reg.title}:`);
          console.log(`    ${formatDuration(reg.baseline)} → ${formatDuration(reg.current)} (+${reg.change.toFixed(2)}%)`);
        }
        if (regressions.tests.length > 10) {
          console.log(`  ... and ${regressions.tests.length - 10} more`);
        }
      }
    } else {
      console.log('\n✅ No Performance Regressions Detected');
    }
  }

  console.log('\n' + '═'.repeat(80) + '\n');
}

/**
 * Generate markdown output
 */
function generateMarkdownOutput(metrics, regressions) {
  let md = '# Performance Analysis Report\n\n';

  md += '## Overall Metrics\n\n';
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Duration | ${formatDuration(metrics.totalDuration)} |\n`;
  md += `| Total Tests | ${metrics.testCount} |\n`;
  md += `| Passed | ${metrics.passedCount} |\n`;
  md += `| Failed | ${metrics.failedCount} |\n`;
  md += `| Skipped | ${metrics.skippedCount} |\n`;
  md += `| Retried | ${metrics.retriedCount} |\n`;
  md += `| Flaky | ${metrics.flakyCount} |\n\n`;

  // Project breakdown
  if (metrics.projects.size > 0) {
    md += '## Project Breakdown\n\n';
    md += `| Project | Duration | Tests | Passed | Failed |\n`;
    md += `|---------|----------|-------|--------|--------|\n`;
    for (const [name, project] of metrics.projects) {
      md += `| ${name} | ${formatDuration(project.duration)} | ${project.testCount} | ${project.passed} | ${project.failed} |\n`;
    }
    md += '\n';
  }

  // Slowest tests
  const slowestTests = [...metrics.tests]
    .filter(t => t.status === 'passed')
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);

  if (slowestTests.length > 0) {
    md += '## Slowest Tests\n\n';
    md += `| Duration | Test |\n`;
    md += `|----------|------|\n`;
    for (const test of slowestTests) {
      md += `| ${formatDuration(test.duration)} | ${test.title} |\n`;
    }
    md += '\n';
  }

  // Flaky tests
  const flakyTests = metrics.tests.filter(t => t.isFlaky);
  if (flakyTests.length > 0) {
    md += '## ⚠️ Flaky Tests\n\n';
    md += `| Test | Retries |\n`;
    md += `|------|--------|\n`;
    for (const test of flakyTests) {
      md += `| ${test.title} | ${test.retryCount} |\n`;
    }
    md += '\n';
  }

  // Regressions
  if (regressions) {
    const hasRegressions =
      regressions.overall ||
      regressions.tests.length > 0 ||
      regressions.suites.length > 0 ||
      regressions.projects.length > 0;

    if (hasRegressions) {
      md += '## 🔴 Performance Regressions\n\n';

      if (regressions.overall) {
        md += '### Overall Duration\n\n';
        md += `| Baseline | Current | Change |\n`;
        md += `|----------|---------|--------|\n`;
        md += `| ${formatDuration(regressions.overall.baseline)} | ${formatDuration(regressions.overall.current)} | +${regressions.overall.change.toFixed(2)}% |\n\n`;
      }

      if (regressions.projects.length > 0) {
        md += '### Project Regressions\n\n';
        md += `| Project | Baseline | Current | Change |\n`;
        md += `|---------|----------|---------|--------|\n`;
        for (const reg of regressions.projects) {
          md += `| ${reg.name} | ${formatDuration(reg.baseline)} | ${formatDuration(reg.current)} | +${reg.change.toFixed(2)}% |\n`;
        }
        md += '\n';
      }

      if (regressions.tests.length > 0) {
        md += '### Test Regressions\n\n';
        md += `| Test | Baseline | Current | Change |\n`;
        md += `|------|----------|---------|--------|\n`;
        for (const reg of regressions.tests.slice(0, 20)) {
          md += `| ${reg.title} | ${formatDuration(reg.baseline)} | ${formatDuration(reg.current)} | +${reg.change.toFixed(2)}% |\n`;
        }
        md += '\n';
      }
    } else {
      md += '## ✅ No Performance Regressions Detected\n\n';
    }
  }

  return md;
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🔍 Analyzing test performance...\n');

    // Load current results
    const currentResults = loadTestResults(config.currentFile);
    const currentMetrics = extractMetrics(currentResults);

    let regressions = null;

    // Compare with baseline if provided
    if (config.baselineFile) {
      console.log(`📊 Comparing with baseline: ${config.baselineFile}\n`);
      const baselineResults = loadTestResults(config.baselineFile);
      const baselineMetrics = extractMetrics(baselineResults);
      regressions = detectRegressions(currentMetrics, baselineMetrics, config.threshold);
    }

    // Generate output
    if (config.format === 'console' || config.format === 'both') {
      generateConsoleOutput(currentMetrics, regressions);
    }

    let markdownOutput = '';
    if (config.format === 'markdown' || config.format === 'both') {
      markdownOutput = generateMarkdownOutput(currentMetrics, regressions);
      if (config.format === 'markdown') {
        console.log(markdownOutput);
      }
    }

    // Save output to file if specified
    if (config.outputFile) {
      const outputData = {
        timestamp: new Date().toISOString(),
        metrics: {
          totalDuration: currentMetrics.totalDuration,
          testCount: currentMetrics.testCount,
          passedCount: currentMetrics.passedCount,
          failedCount: currentMetrics.failedCount,
          skippedCount: currentMetrics.skippedCount,
          flakyCount: currentMetrics.flakyCount,
          retriedCount: currentMetrics.retriedCount,
          projects: Object.fromEntries(currentMetrics.projects),
          tests: currentMetrics.tests,
        },
        regressions,
      };

      fs.writeFileSync(config.outputFile, JSON.stringify(outputData, null, 2));
      console.log(`💾 Metrics saved to: ${config.outputFile}`);
    }

    // Fail if regressions detected and flag is set
    if (config.failOnRegression && regressions) {
      const hasRegressions =
        regressions.overall ||
        regressions.tests.length > 0 ||
        regressions.suites.length > 0 ||
        regressions.projects.length > 0;

      if (hasRegressions) {
        console.error('\n❌ Performance regressions detected. Failing build.\n');
        process.exit(1);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
