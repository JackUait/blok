import { chromium } from 'playwright';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Verify package works in a real browser environment
 * @param {string} packageDir - Path to node_modules/@jackuait/blok
 * @param {string} tempDir - Temporary directory
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkBrowserSmokeTest(packageDir, tempDir, verbose = false) {
  const details = {
    browserLaunched: false,
    pageLoaded: false,
    editorInitialized: false,
    noConsoleErrors: true,
    consoleErrors: [],
    errors: []
  };

  let browser;
  let page;

  try {
    // Read the bundle content to inline it (avoiding file:// protocol issues in CI)
    const bundlePath = join(packageDir, 'dist', 'blok.umd.js');
    const bundleContent = await readFile(bundlePath, 'utf-8');

    // Create a simple HTML page with inlined bundle
    const testHtmlPath = join(tempDir, 'test-browser.html');

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Blok Browser Test</title>
  <style>
    #editor {
      border: 1px solid #ccc;
      padding: 20px;
      min-height: 200px;
    }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script>${bundleContent}</script>
  <script>
    window.testResult = {
      initialized: false,
      error: null
    };

    try {
      if (typeof Blok === 'undefined') {
        throw new Error('Blok is not defined');
      }

      const editor = new Blok({
        holder: 'editor',
        tools: {},
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Test paragraph'
              }
            }
          ]
        }
      });

      window.testResult.initialized = true;
      window.testResult.editor = editor;
    } catch (error) {
      window.testResult.error = error.message;
      console.error('Editor initialization failed:', error);
    }
  </script>
</body>
</html>
    `;

    await writeFile(testHtmlPath, htmlContent);

    // Launch browser
    if (verbose) {
      console.log('  Launching browser...');
    }

    browser = await chromium.launch({ headless: true });
    details.browserLaunched = true;

    page = await browser.newPage();

    // Capture console messages
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const errorText = msg.text();
        details.consoleErrors.push(errorText);
        details.noConsoleErrors = false;
        if (verbose) {
          console.log(`  ✗ Console error: ${errorText}`);
        }
      }
    });

    // Load the test page
    if (verbose) {
      console.log('  Loading test page...');
    }

    await page.goto(`file://${testHtmlPath}`, { waitUntil: 'networkidle' });
    details.pageLoaded = true;

    // Wait a bit for the editor to initialize
    await page.waitForTimeout(2000);

    // Check test result
    const testResult = await page.evaluate(() => window.testResult);

    if (testResult.error) {
      details.errors.push(`Browser initialization failed: ${testResult.error}`);
      if (verbose) {
        console.log(`  ✗ Editor initialization failed: ${testResult.error}`);
      }
    } else if (testResult.initialized) {
      details.editorInitialized = true;
      if (verbose) {
        console.log('  ✓ Editor initialized successfully');
      }
    } else {
      details.errors.push('Editor did not initialize (unknown error)');
      if (verbose) {
        console.log('  ✗ Editor did not initialize');
      }
    }

    // Check for the editor element
    const editorExists = await page.$('#editor');
    if (!editorExists) {
      details.errors.push('Editor element not found');
    }

    await browser.close();

    // Determine if all checks passed
    const allPassed = details.browserLaunched &&
                      details.pageLoaded &&
                      details.editorInitialized &&
                      details.noConsoleErrors;

    if (allPassed) {
      return {
        passed: true,
        message: 'Browser smoke test passed successfully',
        details
      };
    } else {
      return {
        passed: false,
        message: `Browser smoke test failed: ${details.errors.join('; ')}`,
        details
      };
    }

  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        // Ignore close errors
      }
    }

    return {
      passed: false,
      message: `Browser smoke test failed: ${error.message}`,
      details
    };
  }
}
