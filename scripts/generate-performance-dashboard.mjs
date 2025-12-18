#!/usr/bin/env node

/**
 * Performance Dashboard Generator
 *
 * Generates an interactive HTML dashboard showing performance trends over time
 * Uses Chart.js for visualizations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HISTORY_DIR = path.resolve(process.cwd(), '.performance-history');
const OUTPUT_DIR = path.resolve(process.cwd(), 'performance-dashboard');

/**
 * Load all historical performance data
 */
function loadHistoricalData() {
  const data = [];

  if (!fs.existsSync(HISTORY_DIR)) {
    console.log('⚠️  No historical performance data found.');
    return data;
  }

  const subdirs = fs.readdirSync(HISTORY_DIR);

  for (const subdir of subdirs) {
    const subdirPath = path.join(HISTORY_DIR, subdir);
    if (!fs.statSync(subdirPath).isDirectory()) continue;

    const files = fs.readdirSync(subdirPath);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(subdirPath, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (content.timestamp && content.metrics) {
          data.push(content);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to parse ${filePath}: ${error.message}`);
      }
    }
  }

  // Sort by timestamp
  data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return data;
}

/**
 * Generate HTML dashboard
 */
function generateDashboard(historicalData) {
  if (historicalData.length === 0) {
    console.log('⚠️  No data to generate dashboard. Need at least one performance report.');
    return;
  }

  // Prepare data for charts
  const timestamps = historicalData.map(d => new Date(d.timestamp).toLocaleDateString());
  const totalDurations = historicalData.map(d => d.metrics.totalDuration / 1000); // Convert to seconds
  const testCounts = historicalData.map(d => d.metrics.testCount);
  const flakyRates = historicalData.map(d =>
    d.metrics.testCount > 0 ? (d.metrics.flakyCount / d.metrics.testCount) * 100 : 0
  );
  const passRates = historicalData.map(d =>
    d.metrics.testCount > 0 ? (d.metrics.passedCount / d.metrics.testCount) * 100 : 0
  );

  // Get latest metrics
  const latest = historicalData[historicalData.length - 1];

  // Calculate trends
  const avgDuration = totalDurations.reduce((a, b) => a + b, 0) / totalDurations.length;
  const currentDuration = totalDurations[totalDurations.length - 1];
  const durationTrend = currentDuration > avgDuration ? '📈' : '📉';
  const durationChange = ((currentDuration - avgDuration) / avgDuration * 100).toFixed(2);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blok E2E Performance Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      background: white;
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    h1 {
      color: #1a202c;
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
    }

    .subtitle {
      color: #718096;
      font-size: 1.1rem;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .metric-card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s;
    }

    .metric-card:hover {
      transform: translateY(-4px);
    }

    .metric-label {
      color: #718096;
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .metric-value {
      color: #1a202c;
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }

    .metric-trend {
      color: #718096;
      font-size: 0.875rem;
    }

    .metric-trend.positive {
      color: #48bb78;
    }

    .metric-trend.negative {
      color: #f56565;
    }

    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 2rem;
      margin-bottom: 2rem;
    }

    .chart-card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .chart-title {
      color: #1a202c;
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }

    .chart-container {
      position: relative;
      height: 300px;
    }

    .footer {
      text-align: center;
      color: white;
      margin-top: 3rem;
      padding: 1rem;
    }

    .data-table {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      background: #f7fafc;
      padding: 0.75rem;
      text-align: left;
      font-weight: 600;
      color: #4a5568;
      border-bottom: 2px solid #e2e8f0;
    }

    td {
      padding: 0.75rem;
      border-bottom: 1px solid #e2e8f0;
      color: #2d3748;
    }

    tr:hover {
      background: #f7fafc;
    }

    .status-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .status-badge.success {
      background: #c6f6d5;
      color: #22543d;
    }

    .status-badge.warning {
      background: #feebc8;
      color: #744210;
    }

    .status-badge.error {
      background: #fed7d7;
      color: #742a2a;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Blok E2E Performance Dashboard</h1>
      <p class="subtitle">Last updated: ${new Date(latest.timestamp).toLocaleString()}</p>
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total Duration</div>
        <div class="metric-value">${(currentDuration).toFixed(2)}s</div>
        <div class="metric-trend ${durationChange > 0 ? 'negative' : 'positive'}">
          ${durationTrend} ${Math.abs(durationChange)}% vs avg
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Total Tests</div>
        <div class="metric-value">${latest.metrics.testCount}</div>
        <div class="metric-trend">
          ✅ ${latest.metrics.passedCount} passed
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Pass Rate</div>
        <div class="metric-value">${passRates[passRates.length - 1].toFixed(1)}%</div>
        <div class="metric-trend ${passRates[passRates.length - 1] >= 95 ? 'positive' : 'negative'}">
          ${latest.metrics.failedCount > 0 ? `❌ ${latest.metrics.failedCount} failed` : 'All passing'}
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Flaky Tests</div>
        <div class="metric-value">${latest.metrics.flakyCount}</div>
        <div class="metric-trend ${latest.metrics.flakyCount === 0 ? 'positive' : 'negative'}">
          ${flakyRates[flakyRates.length - 1].toFixed(1)}% flaky rate
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Retried Tests</div>
        <div class="metric-value">${latest.metrics.retriedCount}</div>
        <div class="metric-trend">
          ${latest.metrics.retriedCount > 0 ? '⚠️ Tests needed retries' : '✅ No retries needed'}
        </div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h2 class="chart-title">Total Duration Trend</h2>
        <div class="chart-container">
          <canvas id="durationChart"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <h2 class="chart-title">Pass Rate Trend</h2>
        <div class="chart-container">
          <canvas id="passRateChart"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <h2 class="chart-title">Flaky Test Rate</h2>
        <div class="chart-container">
          <canvas id="flakyRateChart"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <h2 class="chart-title">Test Count Over Time</h2>
        <div class="chart-container">
          <canvas id="testCountChart"></canvas>
        </div>
      </div>
    </div>

    <div class="data-table">
      <h2 class="chart-title">Slowest Tests (Latest Run)</h2>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Retries</th>
          </tr>
        </thead>
        <tbody>
          ${latest.metrics.tests
            .filter(t => t.status === 'passed')
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 20)
            .map(test => `
              <tr>
                <td>${test.title}</td>
                <td>${(test.duration / 1000).toFixed(2)}s</td>
                <td>
                  <span class="status-badge ${test.isFlaky ? 'warning' : 'success'}">
                    ${test.isFlaky ? 'Flaky' : 'Passed'}
                  </span>
                </td>
                <td>${test.retryCount > 0 ? test.retryCount : '-'}</td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <p>Generated by Blok Performance Tracking System</p>
      <p style="margin-top: 0.5rem; font-size: 0.875rem; opacity: 0.8;">
        Tracking ${historicalData.length} data points
      </p>
    </div>
  </div>

  <script>
    // Chart.js configuration
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif';
    Chart.defaults.color = '#4a5568';

    // Duration Chart
    new Chart(document.getElementById('durationChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          label: 'Total Duration (seconds)',
          data: ${JSON.stringify(totalDurations)},
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => value + 's'
            }
          }
        }
      }
    });

    // Pass Rate Chart
    new Chart(document.getElementById('passRateChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          label: 'Pass Rate (%)',
          data: ${JSON.stringify(passRates)},
          borderColor: '#48bb78',
          backgroundColor: 'rgba(72, 187, 120, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: {
              callback: (value) => value + '%'
            }
          }
        }
      }
    });

    // Flaky Rate Chart
    new Chart(document.getElementById('flakyRateChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          label: 'Flaky Rate (%)',
          data: ${JSON.stringify(flakyRates)},
          borderColor: '#ed8936',
          backgroundColor: 'rgba(237, 137, 54, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => value + '%'
            }
          }
        }
      }
    });

    // Test Count Chart
    new Chart(document.getElementById('testCountChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          label: 'Test Count',
          data: ${JSON.stringify(testCounts)},
          backgroundColor: '#764ba2',
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  </script>
</body>
</html>`;

  return html;
}

/**
 * Main execution
 */
async function main() {
  console.log('🎨 Generating performance dashboard...\n');

  // Load historical data
  const historicalData = loadHistoricalData();

  if (historicalData.length === 0) {
    console.log('⚠️  No performance data available. Run tests first to generate data.\n');
    process.exit(0);
  }

  console.log(`📊 Found ${historicalData.length} historical data points\n`);

  // Generate dashboard
  const html = generateDashboard(historicalData);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write dashboard
  const outputPath = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(outputPath, html);

  console.log(`✅ Dashboard generated: ${outputPath}\n`);
  console.log(`🌐 Open in browser: file://${outputPath}\n`);
}

main().catch(error => {
  console.error(`\n❌ Error: ${error.message}\n`);
  process.exit(1);
});
