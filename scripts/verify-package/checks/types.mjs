import { access, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Add a package to the dependencies in package.json
 * This prevents npm from removing it as "extraneous" when installing other packages
 */
async function addToPackageJson(tempDir, packageName) {
  const pkgPath = join(tempDir, 'package.json');
  const pkgContent = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent);
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies[packageName] = '*';
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
}

/**
 * Verify TypeScript type definitions are valid and accessible
 * @param {string} packageDir - Path to node_modules/@jackuait/blok
 * @param {string} tempDir - Temporary directory
 * @param {string} packageName - Package name (e.g., '@jackuait/blok')
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<{passed: boolean, message: string, details: object}>}
 */
export async function checkTypes(packageDir, tempDir, packageName, verbose = false) {
  const details = {
    typeFiles: [],
    missingTypeFiles: [],
    typescriptCompilation: false,
    errors: []
  };

  try {
    // Check for required type definition files
    // Note: types/blok.d.ts is not needed - the Blok class is exported from types/index.d.ts
    const requiredTypeFiles = [
      'types/index.d.ts',
      'types/locales.d.ts'
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

    // Write a test TypeScript file (using named imports)
    // Note: We use a simple test that verifies types are accessible.
    // The package includes src/ files which TypeScript may try to compile,
    // so we add @types/node to handle process.env references.
    await writeFile(testTsFile, `
import type { BlokConfig, OutputData } from '@jackuait/blok';
import { Blok } from '@jackuait/blok';
import { loadLocale } from '@jackuait/blok/locales';

// Test that types are properly accessible
const config: BlokConfig = {
  holder: 'editor',
  tools: {}
};

// Test constructor type (Blok is both a type and a value when using class)
const editor: Blok = new Blok(config);

// Test API return types
const outputPromise: Promise<OutputData> = editor.save();

// Test locale loading function is callable
const localeLoading = loadLocale('en');

// This file should compile without errors if types are correct
console.log('Type checking passed');
`);

    // Write a minimal tsconfig.json
    // Use "bundler" moduleResolution to properly resolve ESM subpath exports
    // Use skipLibCheck: true to skip checking node_modules types (standard practice)
    await writeFile(testTsConfig, JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
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
      // First, add the blok package to package.json so npm doesn't remove it as "extraneous"
      // when we install TypeScript
      await addToPackageJson(tempDir, packageName);

      // Install TypeScript and @types/node
      // @types/node is needed because the package includes src/ files that reference process.env
      await execAsync('npm install typescript@latest @types/node', { cwd: tempDir, timeout: 60000 });

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
