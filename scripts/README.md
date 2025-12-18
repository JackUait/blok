# Build & Release Scripts

This directory contains scripts for building, verifying, and releasing the Blok package.

## Bundle Size Tracking

### [`track-bundle-size.mjs`](./track-bundle-size.mjs)

Tracks bundle sizes over time and alerts on significant changes.

**Usage:**
```bash
# Track current bundle size
yarn bundle:track

# With custom options
node scripts/track-bundle-size.mjs --verbose --output=report.md --threshold=10
```

**Options:**
- `--verbose, -v` - Show detailed output
- `--output=FILE` - Generate markdown report
- `--threshold=N` - Alert threshold percentage (default: 10)
- `--max-entries=N` - Max history entries to keep (default: 100)

**See:** [Bundle Size Tracking Documentation](../docs/bundle-size-tracking.md)

### [`view-bundle-trends.mjs`](./view-bundle-trends.mjs)

View historical bundle size data and trends.

**Usage:**
```bash
# View recent history
yarn bundle:history

# View with trend analysis
yarn bundle:trends

# Export to CSV
node scripts/view-bundle-trends.mjs --csv=sizes.csv
```

**Options:**
- `--trends, -t` - Show trend analysis (first vs last)
- `--limit=N` - Show last N entries (default: 10)
- `--csv=FILE` - Export data to CSV file

## Performance Tracking

### [`analyze-performance.mjs`](./analyze-performance.mjs)

Analyzes Playwright test performance metrics and detects regressions.

**Usage:**
```bash
# Basic analysis
yarn perf:analyze

# Compare with baseline
node scripts/analyze-performance.mjs --baseline path/to/baseline.json --threshold 20

# Save metrics to file
node scripts/analyze-performance.mjs --output metrics.json --format markdown

# Fail build on regression (for CI)
node scripts/analyze-performance.mjs --baseline baseline.json --fail-on-regression
```

**Options:**
- `--current <file>` - Current test results JSON (default: test-results/test-results.json)
- `--baseline <file>` - Baseline for comparison
- `--threshold <percent>` - Regression threshold (default: 20)
- `--output <file>` - Save metrics to JSON file
- `--format <type>` - Output format: console, markdown, json (default: console)
- `--fail-on-regression` - Exit with code 1 if regressions found

**Outputs:**
- Overall metrics (duration, test count, pass/fail/skip counts)
- Project breakdown (per browser)
- Slowest tests (top 10)
- Flaky tests (passed after retries)
- Regressions (if baseline provided)

**See:** [Performance Tracking Documentation](../docs/PERFORMANCE-TRACKING.md)

### [`generate-performance-dashboard.mjs`](./generate-performance-dashboard.mjs)

Generates an interactive HTML dashboard with historical performance trends.

**Usage:**
```bash
# Generate dashboard
yarn perf:dashboard

# Open dashboard
open performance-dashboard/index.html
```

**Requirements:**
- Historical data in `.performance-history/` directory
- Internet connection (for Chart.js CDN)

**Features:**
- Real-time metrics cards
- Duration trend chart
- Pass rate trend chart
- Flaky rate trend chart
- Test count over time
- Slowest tests table

## Package Verification

### [`verify-published-package.mjs`](./verify-published-package.mjs)

Verifies a published or local package is correctly built and functional.

**Usage:**
```bash
# Verify published package
yarn verify:package

# Verify local build
yarn verify:package:local

# Verify specific version
node scripts/verify-published-package.mjs --version 0.4.1 --verbose
```

**Checks:**
- Package structure and files
- Type definitions
- Bundle sizes (reference values)
- Import/require functionality
- Exports configuration

### [`verify-version.mjs`](./verify-version.mjs)

Verifies version consistency across package files.

**Usage:**
```bash
yarn verify:version
```

## Publishing

### [`unpublish-package.mjs`](./unpublish-package.mjs)

Safely unpublishes a package version from npm (used by rollback automation).

**Usage:**
```bash
# Interactive mode
yarn unpublish

# Direct unpublish (dangerous!)
node scripts/unpublish-package.mjs --version 0.4.1 --force
```

## Internationalization

### [`i18n/check-translations.mjs`](./i18n/check-translations.mjs)

Checks translation completeness and consistency.

**Usage:**
```bash
yarn i18n:check
```

## Directory Structure

```
scripts/
├── README.md                           # This file
├── analyze-performance.mjs            # Performance metrics analyzer
├── generate-performance-dashboard.mjs # Performance dashboard generator
├── track-bundle-size.mjs              # Bundle size tracking
├── view-bundle-trends.mjs             # Historical trend viewer
├── verify-published-package.mjs       # Package verification
├── verify-version.mjs                 # Version consistency check
├── unpublish-package.mjs              # Package unpublishing
├── i18n/
│   └── check-translations.mjs         # Translation checker
└── verify-package/
    ├── checks/                        # Package verification checks
    │   ├── bundle-size.mjs           # Bundle size check
    │   ├── exports.mjs               # Export configuration check
    │   ├── imports.mjs               # Import functionality check
    │   ├── package-structure.mjs     # File structure check
    │   └── types.mjs                 # Type definition check
    ├── fixtures/                      # Test fixtures
    └── utils/                         # Shared utilities
```

## CI/CD Integration

These scripts are integrated into GitHub Actions workflows:

- **CI workflow** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml))
  - Collects performance metrics on every test run
  - Uploads metrics as artifacts

- **Performance tracking** ([`.github/workflows/performance-tracking.yml`](../.github/workflows/performance-tracking.yml))
  - Compares with baseline on PRs
  - Generates performance reports
  - Posts PR comments with regression analysis
  - Updates baseline on master
  - Generates historical dashboard

- **Release workflow** ([`.github/workflows/release.yml`](../.github/workflows/release.yml))
  - Tracks bundle sizes
  - Verifies package before/after publish
  - Handles automatic rollback on failure

- **Bundle size check** ([`.github/workflows/bundle-size-check.yml`](../.github/workflows/bundle-size-check.yml))
  - Runs on PRs
  - Compares with base branch
  - Posts comparison as PR comment

## Development

All scripts are ES modules (`.mjs`) and can be imported:

```javascript
import { trackBundleSize } from './scripts/track-bundle-size.mjs';
import { loadHistory, displayTrends } from './scripts/view-bundle-trends.mjs';

// Use programmatically
await trackBundleSize();
const history = await loadHistory('.bundle-size-history.json');
```

## Troubleshooting

### "No history file found"

Run a build and track first:
```bash
yarn build
yarn bundle:track
```

### "Package not found"

Make sure to build before verifying:
```bash
yarn build
yarn verify:package:local
```

### "Failed to download artifact"

This is normal on first run. GitHub artifacts are created after the first release.

## Contributing

When adding new scripts:

1. Use ES modules (`.mjs` extension)
2. Add JSDoc comments for functions
3. Include usage examples in `--help`
4. Update this README
5. Add integration tests if applicable
6. Document in relevant workflow files

## Related Documentation

- [Development Guide](../CLAUDE.md)
- [Contributing Guide](../CONTRIBUTING.md)
