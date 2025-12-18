import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');

/**
 * Script to migrate namespace imports (import * as _) to named imports
 * for better tree-shaking.
 *
 * Usage:
 *   node scripts/migrate-namespace-imports.mjs          # Dry run (preview changes)
 *   node scripts/migrate-namespace-imports.mjs --write  # Apply changes
 */

const isDryRun = !process.argv.includes('--write');

if (isDryRun) {
  console.log('DRY RUN MODE - No files will be modified');
  console.log('Run with --write to apply changes\n');
}

/**
 * Find all TypeScript files in src directory
 */
async function findSourceFiles() {
  const files = await glob('**/*.ts', {
    cwd: srcDir,
    ignore: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
    absolute: true,
  });
  return files;
}

/**
 * Parse a file and find namespace imports along with their usages
 */
function analyzeFile(content, filePath) {
  const results = [];

  // Match all namespace imports: import * as alias from 'path'
  const namespaceImportRegex = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let importMatch;

  while ((importMatch = namespaceImportRegex.exec(content)) !== null) {
    const [fullImport, alias, importPath] = importMatch;

    // Skip non-utils imports unless they're tooltip, caret, or draw
    const isUtilsImport = importPath.includes('utils') ||
                          importPath.endsWith('/draw') ||
                          importPath.includes('tooltip') ||
                          importPath.includes('caret');

    if (!isUtilsImport) {
      continue;
    }

    // Find all usages of this alias (e.g., _.isFunction, tooltip.show)
    // Use word boundary to avoid partial matches
    const usagePattern = new RegExp(`(?<![a-zA-Z0-9_])${alias}\\.([a-zA-Z_][a-zA-Z0-9_]*)`, 'g');
    const usages = new Set();
    let usageMatch;

    // Remove comments to avoid false positives (e.g., Tooltip.stories.ts in JSDoc)
    const contentWithoutComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '')  // Block comments
      .replace(/\/\/.*$/gm, '');          // Line comments

    while ((usageMatch = usagePattern.exec(contentWithoutComments)) !== null) {
      usages.add(usageMatch[1]);
    }

    if (usages.size > 0) {
      results.push({
        fullImport,
        alias,
        importPath,
        usages: [...usages].sort(),
        importStart: importMatch.index,
        importEnd: importMatch.index + fullImport.length,
      });
    }
  }

  return results;
}

/**
 * Generate the new content with named imports
 */
function transformFile(content, analyses) {
  let newContent = content;

  // Sort analyses by import position (descending) to replace from end to start
  // This prevents position shifts from affecting subsequent replacements
  const sortedAnalyses = [...analyses].sort((a, b) => b.importStart - a.importStart);

  for (const analysis of sortedAnalyses) {
    const { fullImport, alias, importPath, usages } = analysis;

    // Generate named import
    const namedImport = `import { ${usages.join(', ')} } from '${importPath}'`;

    // Replace the import statement
    newContent = newContent.replace(fullImport, namedImport);

    // Replace all alias usages with direct function calls
    // Use word boundary to avoid partial matches
    for (const fn of usages) {
      const usageRegex = new RegExp(`(?<![a-zA-Z0-9_])${alias}\\.${fn}(?![a-zA-Z0-9_])`, 'g');
      newContent = newContent.replace(usageRegex, fn);
    }
  }

  return newContent;
}

/**
 * Check for potential naming conflicts
 * Returns only real conflicts where the same identifier is declared as a variable/function
 * AND also used from the namespace we're migrating
 */
function checkConflicts(content, usages, alias) {
  const conflicts = [];

  for (const fn of usages) {
    // Check if the function name is already used as a top-level variable/function/parameter
    // Look for declarations like: const fn =, let fn =, var fn =, function fn(, class fn {
    // Be more specific to reduce false positives - require assignment or definition
    const declarationPatterns = [
      new RegExp(`(?:const|let|var)\\s+${fn}\\s*=`, 'm'),  // Variable declaration with assignment
      new RegExp(`function\\s+${fn}\\s*\\(`, 'm'),          // Function declaration
      new RegExp(`class\\s+${fn}\\s*[{<]`, 'm'),            // Class declaration
    ];

    let hasConflict = false;
    for (const pattern of declarationPatterns) {
      if (pattern.test(content)) {
        // Found a declaration - but is it a conflict?
        // It's only a conflict if the name would shadow our import
        // Check if the declaration is NOT assigning from another namespace (like $.isEmpty)
        const line = content.split('\n').find(l => pattern.test(l));
        if (line) {
          // If the line contains "= alias." where alias is different from our target alias,
          // it's not a true conflict (e.g., "const isEmpty = $.isEmpty" when migrating _ import)
          const otherAliasAssignment = new RegExp(`=\\s*[a-zA-Z_][a-zA-Z0-9_]*\\.${fn}`);
          if (otherAliasAssignment.test(line) && !line.includes(`${alias}.${fn}`)) {
            // This is assigning from a different namespace, not a conflict
            continue;
          }
          hasConflict = true;
          break;
        }
      }
    }

    if (hasConflict) {
      conflicts.push(fn);
    }
  }

  return [...new Set(conflicts)];
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('Scanning source files...\n');

  const files = await findSourceFiles();
  let totalFiles = 0;
  let totalImports = 0;
  let totalFunctions = 0;
  const allUsedFunctions = new Set();
  const fileResults = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const analyses = analyzeFile(content, filePath);

    if (analyses.length === 0) {
      continue;
    }

    const relativePath = path.relative(rootDir, filePath);
    totalFiles++;

    for (const analysis of analyses) {
      totalImports++;
      totalFunctions += analysis.usages.length;
      analysis.usages.forEach(fn => allUsedFunctions.add(fn));

      // Check for conflicts
      const conflicts = checkConflicts(content, analysis.usages, analysis.alias);

      fileResults.push({
        filePath,
        relativePath,
        analysis,
        conflicts,
        content,
      });
    }
  }

  // Print summary
  console.log('='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Files to modify: ${totalFiles}`);
  console.log(`Namespace imports to convert: ${totalImports}`);
  console.log(`Total function usages: ${totalFunctions}`);
  console.log(`Unique functions used: ${allUsedFunctions.size}`);
  console.log('\nUnique functions:', [...allUsedFunctions].sort().join(', '));
  console.log('='.repeat(60));
  console.log('');

  // Group by file for cleaner output
  const byFile = new Map();
  for (const result of fileResults) {
    if (!byFile.has(result.relativePath)) {
      byFile.set(result.relativePath, []);
    }
    byFile.get(result.relativePath).push(result);
  }

  // Print details and apply changes
  for (const [relativePath, results] of byFile) {
    console.log(`\n${relativePath}:`);

    let content = results[0].content;
    let hasConflicts = false;

    for (const { analysis, conflicts } of results) {
      console.log(`  ${analysis.alias} from '${analysis.importPath}'`);
      console.log(`    Functions: ${analysis.usages.join(', ')}`);

      if (conflicts.length > 0) {
        console.log(`    CONFLICTS: ${conflicts.join(', ')}`);
        hasConflicts = true;
      }
    }

    if (hasConflicts) {
      console.log('  SKIPPED - Manual review needed due to conflicts');
      continue;
    }

    // Transform the file
    const analyses = results.map(r => r.analysis);
    const newContent = transformFile(content, analyses);

    if (!isDryRun) {
      fs.writeFileSync(results[0].filePath, newContent);
      console.log('  UPDATED');
    } else {
      console.log('  Would update (dry run)');
    }
  }

  console.log('\n' + '='.repeat(60));
  if (isDryRun) {
    console.log('DRY RUN COMPLETE - Run with --write to apply changes');
  } else {
    console.log('MIGRATION COMPLETE');
    console.log('\nNext steps:');
    console.log('  1. yarn lint       # Check for any issues');
    console.log('  2. yarn build      # Verify compilation');
    console.log('  3. yarn test       # Verify behavior');
  }
  console.log('='.repeat(60));
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
