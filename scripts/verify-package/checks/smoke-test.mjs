import { join } from 'path';
import { pathToFileURL } from 'url';
import { JSDOM } from 'jsdom';

/**
 * Verify basic editor functionality works in Node.js environment with JSDOM
 * @param {string} packageDir - Path to node_modules/@jackuait/blok
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkSmokeTest(packageDir, verbose = false) {
  const details = {
    constructorAvailable: false,
    canInstantiate: false,
    hasAPI: false,
    errors: []
  };

  try {
    // Set up JSDOM environment
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="editor"></div></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
      resources: 'usable'
    });

    global.window = dom.window;
    global.document = dom.window.document;
    // Use Object.defineProperty for navigator since it may be read-only in newer Node.js
    try {
      global.navigator = dom.window.navigator;
    } catch {
      Object.defineProperty(global, 'navigator', {
        value: dom.window.navigator,
        configurable: true,
        writable: true
      });
    }
    global.HTMLElement = dom.window.HTMLElement;
    global.Element = dom.window.Element;
    global.Node = dom.window.Node;
    global.MutationObserver = dom.window.MutationObserver;
    global.requestAnimationFrame = dom.window.requestAnimationFrame;

    // Import the package (using named export)
    const modulePath = join(packageDir, 'dist', 'blok.mjs');
    const { Blok } = await import(pathToFileURL(modulePath).href);

    // Check constructor is available
    if (typeof Blok === 'function') {
      details.constructorAvailable = true;
      if (verbose) {
        console.log('  ✓ Blok constructor is available');
      }
    } else {
      details.errors.push('Blok is not a constructor function');
      return {
        passed: false,
        message: 'Blok constructor not available',
        details
      };
    }

    // Try to instantiate the editor
    if (verbose) {
      console.log('  Testing editor instantiation...');
    }

    try {
      const editor = new Blok({
        holder: 'editor',
        tools: {},
        data: {
          blocks: []
        }
      });

      details.canInstantiate = true;

      if (verbose) {
        console.log('  ✓ Editor instantiated successfully');
      }

      // Check if the editor has expected API methods
      const expectedMethods = ['save', 'clear', 'render', 'destroy'];
      const missingMethods = [];

      for (const method of expectedMethods) {
        if (typeof editor[method] !== 'function') {
          missingMethods.push(method);
        }
      }

      if (missingMethods.length === 0) {
        details.hasAPI = true;
        if (verbose) {
          console.log('  ✓ All expected API methods are available');
        }
      } else {
        details.errors.push(`Missing API methods: ${missingMethods.join(', ')}`);
        if (verbose) {
          console.log(`  ✗ Missing API methods: ${missingMethods.join(', ')}`);
        }
      }

      // Clean up
      try {
        await editor.destroy();
      } catch (error) {
        // Ignore cleanup errors
      }

    } catch (error) {
      details.errors.push(`Editor instantiation failed: ${error.message}`);
      if (verbose) {
        console.log(`  ✗ Editor instantiation failed: ${error.message}`);
      }
    }

    // Clean up global variables
    delete global.window;
    delete global.document;
    delete global.navigator;
    delete global.HTMLElement;
    delete global.Element;
    delete global.Node;
    delete global.MutationObserver;
    delete global.requestAnimationFrame;

    // Determine if all checks passed
    const allPassed = details.constructorAvailable &&
                      details.canInstantiate &&
                      details.hasAPI;

    if (allPassed) {
      return {
        passed: true,
        message: 'Smoke test passed successfully',
        details
      };
    } else {
      return {
        passed: false,
        message: `Smoke test failed: ${details.errors.join('; ')}`,
        details
      };
    }

  } catch (error) {
    return {
      passed: false,
      message: `Smoke test failed: ${error.message}`,
      details
    };
  }
}
