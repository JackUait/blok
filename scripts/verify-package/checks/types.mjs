import { access, writeFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Verify TypeScript type definitions are valid and accessible
 * @param {string} packageDir - Path to node_modules/@jackuait/blok
 * @param {string} tempDir - Temporary directory
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkTypes(packageDir, tempDir, verbose = false) {
  const details = {
    typeFiles: [],
    missingTypeFiles: [],
    typescriptCompilation: false,
    errors: []
  };

  try {
    // Check for required type definition files
    const requiredTypeFiles = [
      'types/index.d.ts',
      'types/locales.d.ts',
      'types/blok.d.ts'
    ];

    for (const typeFile of requiredTypeFiles) {
      const fullPath = join(packageDir, typeFile);
      try {
        await access(fullPath);
        details.typeFiles.push(typeFile);
        if (verbose) {
          console.log(`  ✓ Found type file: ${typeFile}`);
        }
      } catch (error) {
        details.missingTypeFiles.push(typeFile);
        if (verbose) {
          console.log(`  ✗ Missing type file: ${typeFile}`);
        }
      }
    }

    // Create a test TypeScript file that uses the package types
    const testTsFile = join(tempDir, 'test-types.ts');
    const testTsConfig = join(tempDir, 'tsconfig.json');

    // Write a test TypeScript file
    await writeFile(testTsFile, `
import type { BlokConfig } from '@jackuait/blok';
import Blok from '@jackuait/blok';
import { loadLocale } from '@jackuait/blok/locales';

// Test that types are properly accessible
const config: BlokConfig = {
  holder: 'editor',
  tools: {}
};

// Test constructor type
const editor: Blok = new Blok(config);

// Test locale loading type
const locale = loadLocale('en');

// This file should compile without errors if types are correct
console.log('Type checking passed');
`);

    // Write a minimal tsconfig.json
    await writeFile(testTsConfig, JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'node',
        strict: true,
        skipLibCheck: false,
        esModuleInterop: true,
        noEmit: true
      },
      include: ['test-types.ts']
    }, null, 2));

    // Run TypeScript compiler to check types
    if (verbose) {
      console.log('  Running TypeScript type checking...');
    }

    try {
      const { stdout, stderr } = await execAsync(
        'npx tsc --noEmit',
        { cwd: tempDir, timeout: 30000 }
      );

      details.typescriptCompilation = true;

      if (verbose && stdout) {
        console.log('  ✓ TypeScript compilation successful');
      }
    } catch (error) {
      details.errors.push(`TypeScript compilation failed: ${error.message}`);
      if (verbose) {
        console.log(`  ✗ TypeScript compilation failed:`);
        console.log(error.stderr || error.stdout || error.message);
      }
    }

    // Check results
    if (details.missingTypeFiles.length > 0) {
      return {
        passed: false,
        message: `Missing type files: ${details.missingTypeFiles.join(', ')}`,
        details
      };
    }

    if (!details.typescriptCompilation) {
      return {
        passed: false,
        message: 'TypeScript type checking failed',
        details
      };
    }

    return {
      passed: true,
      message: 'Type definitions verified successfully',
      details
    };

  } catch (error) {
    return {
      passed: false,
      message: `Type check failed: ${error.message}`,
      details
    };
  }
}
