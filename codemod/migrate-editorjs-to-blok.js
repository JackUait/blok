#!/usr/bin/env node

/**
 * EditorJS to Blok Codemod
 *
 * This script automates the migration from EditorJS to Blok.
 * It transforms imports, class names, selectors, data attributes, and text references.
 *
 * Usage:
 *   npx blok-codemod [path] [options]
 *
 * Options:
 *   --dry-run    Show changes without modifying files
 *   --verbose    Show detailed output
 *   --help       Show help
 *
 * Examples:
 *   npx blok-codemod ./src
 *   npx blok-codemod ./src --dry-run
 *   npx blok-codemod .
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const FILE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.css', '.scss', '.less'];

// Import transformations
const IMPORT_TRANSFORMS = [
  // Main EditorJS import
  {
    pattern: /from\s+['"]@editorjs\/editorjs['"]/g,
    replacement: "from '@jackuait/blok'",
  },
  {
    pattern: /require\s*\(\s*['"]@editorjs\/editorjs['"]\s*\)/g,
    replacement: "require('@jackuait/blok')",
  },
  // Header tool (now bundled)
  {
    pattern: /import\s+(\w+)\s+from\s+['"]@editorjs\/header['"];?\n?/g,
    replacement: '// Header is now bundled with Blok: use Blok.Header\n',
    note: 'Header tool is now bundled',
  },
  // Paragraph tool (now bundled)
  {
    pattern: /import\s+(\w+)\s+from\s+['"]@editorjs\/paragraph['"];?\n?/g,
    replacement: '// Paragraph is now bundled with Blok: use Blok.Paragraph\n',
    note: 'Paragraph tool is now bundled',
  },
];

// Type import transformations (order matters - more specific patterns first)
const TYPE_TRANSFORMS = [
  { pattern: /EditorJS\.EditorConfig/g, replacement: 'BlokConfig' },
  { pattern: /EditorConfig/g, replacement: 'BlokConfig' },
];

// Class name transformations
const CLASS_NAME_TRANSFORMS = [
  // Constructor
  { pattern: /new\s+EditorJS\s*\(/g, replacement: 'new Blok(' },
  // Type annotations
  { pattern: /:\s*EditorJS(?![a-zA-Z])/g, replacement: ': Blok' },
  // Generic type parameters
  { pattern: /<EditorJS>/g, replacement: '<Blok>' },
];

// CSS class transformations
const CSS_CLASS_TRANSFORMS = [
  // Editor wrapper classes
  { pattern: /\.codex-editor(?![\w-])/g, replacement: '.blok-editor' },
  { pattern: /\.codex-editor--narrow/g, replacement: '.blok-editor--narrow' },
  { pattern: /\.codex-editor--rtl/g, replacement: '.blok-editor--rtl' },
  // CE prefix classes (commonly used)
  { pattern: /\.ce-block(?![\w-])/g, replacement: '[data-blok-testid="block-wrapper"]' },
  { pattern: /\.ce-block--selected/g, replacement: '[data-blok-selected="true"]' },
  { pattern: /\.ce-block--stretched/g, replacement: '[data-blok-stretched="true"]' },
  { pattern: /\.ce-block__content/g, replacement: '[data-blok-testid="block-content"]' },
  { pattern: /\.ce-toolbar(?![\w-])/g, replacement: '[data-blok-testid="toolbar"]' },
  { pattern: /\.ce-toolbar__plus/g, replacement: '[data-blok-testid="plus-button"]' },
  { pattern: /\.ce-toolbar__settings-btn/g, replacement: '[data-blok-testid="settings-toggler"]' },
  { pattern: /\.ce-toolbar__actions/g, replacement: '[data-blok-testid="toolbar-actions"]' },
  { pattern: /\.ce-inline-toolbar/g, replacement: '[data-blok-testid="inline-toolbar"]' },
  { pattern: /\.ce-popover(?![\w-])/g, replacement: '[data-blok-testid="popover-container"]' },
  { pattern: /\.ce-popover-item/g, replacement: '[data-blok-testid="popover-item"]' },
];

// Data attribute transformations
const DATA_ATTRIBUTE_TRANSFORMS = [
  // Core data attributes
  { pattern: /data-id(?=["'\]=\s\]])/g, replacement: 'data-blok-id' },
  { pattern: /data-item-name/g, replacement: 'data-blok-item-name' },
  { pattern: /data-empty/g, replacement: 'data-blok-empty' },
  // Cypress/test selectors
  { pattern: /\[data-cy=["']?editorjs["']?\]/g, replacement: '[data-blok-testid="blok-editor"]' },
  { pattern: /data-cy=["']?editorjs["']?/g, replacement: 'data-blok-testid="blok-editor"' },
];

// Selector transformations for JavaScript/TypeScript query strings
const SELECTOR_TRANSFORMS = [
  // querySelector patterns
  { pattern: /\[data-id=/g, replacement: '[data-blok-id=' },
  { pattern: /\[data-item-name=/g, replacement: '[data-blok-item-name=' },
  { pattern: /\[data-empty\]/g, replacement: '[data-blok-empty]' },
  { pattern: /\[data-empty=/g, replacement: '[data-blok-empty=' },
];

// Default holder transformation
const HOLDER_TRANSFORMS = [
  // HTML id attribute
  { pattern: /id=["']editorjs["']/g, replacement: 'id="blok"' },
  // JavaScript string literals for holder
  { pattern: /holder:\s*['"]editorjs['"]/g, replacement: "holder: 'blok'" },
  { pattern: /getElementById\s*\(\s*['"]editorjs['"]\s*\)/g, replacement: "getElementById('blok')" },
];

// Bundled tools - add new tools here as they are bundled with Blok
const BUNDLED_TOOLS = ['Header', 'Paragraph'];

// Tool configuration transformations
const TOOL_CONFIG_TRANSFORMS = [
  // Handle class property syntax
  { pattern: /class:\s*Header(?!Config)/g, replacement: 'class: Blok.Header' },
  { pattern: /class:\s*Paragraph(?!Config)/g, replacement: 'class: Blok.Paragraph' },
  // Handle standalone tool references in tools config (e.g., `paragraph: Paragraph`)
  { pattern: /(\bheader\s*:\s*)Header(?!Config)(?=\s*[,}\n])/g, replacement: '$1Blok.Header' },
  { pattern: /(\bparagraph\s*:\s*)Paragraph(?!Config)(?=\s*[,}\n])/g, replacement: '$1Blok.Paragraph' },
];

// Text transformations for "EditorJS" string references
const TEXT_TRANSFORMS = [
  // Replace exact "EditorJS" text (preserves case-sensitive matching)
  { pattern: /EditorJS(?![a-zA-Z])/g, replacement: 'Blok' },
  // Replace #editorjs with #blok (e.g., in CSS ID selectors or anchor links)
  { pattern: /#editorjs(?![a-zA-Z0-9_-])/g, replacement: '#blok' },
];

// ============================================================================
// Utility Functions
// ============================================================================

function log(message, verbose = false) {
  if (verbose || !global.isVerbose) {
    console.log(message);
  }
}

function logVerbose(message) {
  if (global.isVerbose) {
    console.log(`  ${message}`);
  }
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);

    // Skip node_modules, dist, and hidden directories
    if (file === 'node_modules' || file === 'dist' || file === 'build' || file.startsWith('.')) {
      return;
    }

    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (FILE_EXTENSIONS.includes(ext)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

function applyTransforms(content, transforms, fileName) {
  let result = content;
  const changes = [];

  transforms.forEach(({ pattern, replacement, note }) => {
    const matches = result.match(pattern);
    if (matches) {
      changes.push({
        pattern: pattern.toString(),
        count: matches.length,
        note,
      });
      result = result.replace(pattern, replacement);
    }
  });

  return { result, changes };
}

/**
 * Ensures that Blok is properly imported when bundled tools (Blok.Header, Blok.Paragraph, etc.) are used.
 * This function checks if the content uses any Blok.* tool references and ensures there's a proper import.
 *
 * Handles the following scenarios:
 * 1. No existing @jackuait/blok import -> adds `import Blok from '@jackuait/blok'`
 * 2. Named imports only (e.g., `import { BlokConfig } from '@jackuait/blok'`) -> adds Blok default import
 * 3. Default import with different name -> adds Blok to named imports
 * 4. Already has Blok default import -> no changes needed
 */
function ensureBlokImport(content) {
  // Check if content uses any Blok.* tool (e.g., Blok.Header, Blok.Paragraph)
  const blokToolPattern = new RegExp(`Blok\\.(${BUNDLED_TOOLS.join('|')})`, 'g');
  const usesBlokTools = blokToolPattern.test(content);

  if (!usesBlokTools) {
    return { result: content, changed: false };
  }

  // Check if Blok is already available as a default import
  // Matches: import Blok from '@jackuait/blok' or import Blok, { ... } from '@jackuait/blok'
  const hasBlokDefaultImport = /import\s+Blok\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"]@jackuait\/blok['"]/.test(content);

  if (hasBlokDefaultImport) {
    return { result: content, changed: false };
  }

  // Check for existing @jackuait/blok import patterns
  const namedOnlyImportPattern = /import\s*\{([^}]+)\}\s*from\s*['"]@jackuait\/blok['"];?/;
  const defaultWithNamedPattern = /import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*['"]@jackuait\/blok['"];?/;
  const defaultOnlyPattern = /import\s+(\w+)\s+from\s*['"]@jackuait\/blok['"];?/;

  let result = content;

  // Case 1: Named imports only -> add Blok default import
  // e.g., `import { BlokConfig } from '@jackuait/blok'` -> `import Blok, { BlokConfig } from '@jackuait/blok'`
  const namedOnlyMatch = content.match(namedOnlyImportPattern);
  if (namedOnlyMatch) {
    const namedImports = namedOnlyMatch[1];
    result = content.replace(
      namedOnlyImportPattern,
      `import Blok, {${namedImports}} from '@jackuait/blok';`
    );
    return { result, changed: true };
  }

  // Case 2: Default import with different name + named imports -> add Blok to named imports
  // e.g., `import Editor, { BlokConfig } from '@jackuait/blok'` -> `import Editor, { Blok, BlokConfig } from '@jackuait/blok'`
  const defaultWithNamedMatch = content.match(defaultWithNamedPattern);
  if (defaultWithNamedMatch) {
    const defaultName = defaultWithNamedMatch[1];
    const namedImports = defaultWithNamedMatch[2];
    // Check if Blok is already in named imports
    if (!/\bBlok\b/.test(namedImports)) {
      result = content.replace(
        defaultWithNamedPattern,
        `import ${defaultName}, { Blok, ${namedImports.trim()} } from '@jackuait/blok';`
      );
      return { result, changed: true };
    }
    return { result: content, changed: false };
  }

  // Case 3: Default import only with different name -> add Blok to named imports
  // e.g., `import Editor from '@jackuait/blok'` -> `import Editor, { Blok } from '@jackuait/blok'`
  const defaultOnlyMatch = content.match(defaultOnlyPattern);
  if (defaultOnlyMatch) {
    const defaultName = defaultOnlyMatch[1];
    if (defaultName !== 'Blok') {
      result = content.replace(
        defaultOnlyPattern,
        `import ${defaultName}, { Blok } from '@jackuait/blok';`
      );
      return { result, changed: true };
    }
    return { result: content, changed: false };
  }

  // Case 4: No @jackuait/blok import at all -> add new import at the top (after any existing imports)
  // Find the last import statement to insert after it
  const importStatements = content.match(/^import\s+.+from\s+['"][^'"]+['"];?\s*$/gm);
  if (importStatements && importStatements.length > 0) {
    const lastImport = importStatements[importStatements.length - 1];
    const lastImportIndex = content.lastIndexOf(lastImport);
    const insertPosition = lastImportIndex + lastImport.length;
    result =
      content.slice(0, insertPosition) +
      "\nimport Blok from '@jackuait/blok';" +
      content.slice(insertPosition);
  } else {
    // No imports found, add at the very beginning (after shebang if present)
    const shebangMatch = content.match(/^#!.*\n/);
    if (shebangMatch) {
      result = shebangMatch[0] + "import Blok from '@jackuait/blok';\n" + content.slice(shebangMatch[0].length);
    } else {
      result = "import Blok from '@jackuait/blok';\n" + content;
    }
  }

  return { result, changed: true };
}

function transformFile(filePath, dryRun = false) {
  const content = fs.readFileSync(filePath, 'utf8');
  let transformed = content;
  const allChanges = [];

  const ext = path.extname(filePath).toLowerCase();
  const isStyleFile = ['.css', '.scss', '.less'].includes(ext);
  const isHtmlFile = ext === '.html';
  const isJsFile = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'].includes(ext);

  // Apply import transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, IMPORT_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'imports' })));
  }

  // Apply type transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, TYPE_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'types' })));
  }

  // Apply class name transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, CLASS_NAME_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'class-names' })));
  }

  // Apply CSS class transforms (all files)
  {
    const { result, changes } = applyTransforms(transformed, CSS_CLASS_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'css-classes' })));
  }

  // Apply data attribute transforms (JS/TS/HTML)
  if (isJsFile || isHtmlFile) {
    const { result, changes } = applyTransforms(transformed, DATA_ATTRIBUTE_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'data-attributes' })));
  }

  // Apply selector transforms (JS/TS)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, SELECTOR_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'selectors' })));
  }

  // Apply holder transforms (JS/TS/HTML)
  if (isJsFile || isHtmlFile) {
    const { result, changes } = applyTransforms(transformed, HOLDER_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'holder' })));
  }

  // Apply tool config transforms (JS/TS only)
  if (isJsFile) {
    const { result, changes } = applyTransforms(transformed, TOOL_CONFIG_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'tool-config' })));
  }

  // Ensure Blok is imported if bundled tools are used (JS/TS only)
  if (isJsFile) {
    const { result, changed } = ensureBlokImport(transformed);
    if (changed) {
      transformed = result;
      allChanges.push({ category: 'imports', pattern: 'ensureBlokImport', count: 1, note: 'Added Blok import for bundled tools' });
    }
  }

  // Apply text transforms (JS/TS/HTML) - replace "EditorJS" with "Blok"
  if (isJsFile || isHtmlFile) {
    const { result, changes } = applyTransforms(transformed, TEXT_TRANSFORMS, filePath);
    transformed = result;
    allChanges.push(...changes.map((c) => ({ ...c, category: 'text' })));
  }

  const hasChanges = transformed !== content;

  if (hasChanges && !dryRun) {
    fs.writeFileSync(filePath, transformed, 'utf8');
  }

  return {
    filePath,
    hasChanges,
    changes: allChanges,
  };
}

function updatePackageJson(packageJsonPath, dryRun = false) {
  if (!fs.existsSync(packageJsonPath)) {
    return { hasChanges: false, changes: [] };
  }

  const content = fs.readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(content);
  const changes = [];

  // Track dependencies to remove
  const depsToRemove = ['@editorjs/editorjs', '@editorjs/header', '@editorjs/paragraph'];
  const devDepsToRemove = [...depsToRemove];

  // Check and update dependencies
  if (pkg.dependencies) {
    depsToRemove.forEach((dep) => {
      if (pkg.dependencies[dep]) {
        changes.push({ action: 'remove', type: 'dependencies', package: dep });
        delete pkg.dependencies[dep];
      }
    });

    // Add @jackuait/blok if not present
    if (!pkg.dependencies['@jackuait/blok']) {
      changes.push({ action: 'add', type: 'dependencies', package: '@jackuait/blok' });
      pkg.dependencies['@jackuait/blok'] = 'latest';
    }
  }

  // Check and update devDependencies
  if (pkg.devDependencies) {
    devDepsToRemove.forEach((dep) => {
      if (pkg.devDependencies[dep]) {
        changes.push({ action: 'remove', type: 'devDependencies', package: dep });
        delete pkg.devDependencies[dep];
      }
    });
  }

  const hasChanges = changes.length > 0;

  if (hasChanges && !dryRun) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  return { hasChanges, changes };
}

// ============================================================================
// Main Execution
// ============================================================================

function printHelp() {
  console.log(`
EditorJS to Blok Codemod

Usage:
  npx blok-codemod [path] [options]

Arguments:
  path          Directory or file to transform (default: current directory)

Options:
  --dry-run     Show changes without modifying files
  --verbose     Show detailed output for each file
  --help        Show this help message

Examples:
  npx blok-codemod ./src
  npx blok-codemod ./src --dry-run
  npx blok-codemod . --verbose

What this codemod does:
  • Transforms EditorJS imports to Blok imports
  • Updates type names (EditorConfig → BlokConfig)
  • Replaces 'new EditorJS()' with 'new Blok()'
  • Converts CSS selectors (.ce-* → [data-blok-*])
  • Updates data attributes (data-id → data-blok-id)
  • Changes default holder from 'editorjs' to 'blok'
  • Updates package.json dependencies
  • Converts bundled tool imports (Header, Paragraph)
  • Ensures Blok is imported when using bundled tools (Blok.Header, etc.)

Note: After running, you may need to manually:
  • Update any custom tool implementations
  • Review and test the changes
  • Run 'npm install' or 'yarn' to update dependencies
`);
}

function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const help = args.includes('--help') || args.includes('-h');

  global.isVerbose = verbose;

  if (help) {
    printHelp();
    process.exit(0);
  }

  // Get target path
  const targetPath = args.find((arg) => !arg.startsWith('--')) || '.';
  const absolutePath = path.resolve(targetPath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: Path does not exist: ${absolutePath}`);
    process.exit(1);
  }

  console.log('\n🔄 EditorJS to Blok Migration\n');
  console.log(`📁 Target: ${absolutePath}`);
  console.log(`🔍 Mode: ${dryRun ? 'Dry run (no changes will be made)' : 'Live'}\n`);

  const stats = {
    filesScanned: 0,
    filesModified: 0,
    totalChanges: 0,
  };

  // Get all files to process
  let files = [];
  if (fs.statSync(absolutePath).isDirectory()) {
    files = getAllFiles(absolutePath);
  } else {
    files = [absolutePath];
  }

  stats.filesScanned = files.length;

  console.log(`📝 Scanning ${files.length} files...\n`);

  // Process each file
  files.forEach((filePath) => {
    const result = transformFile(filePath, dryRun);

    if (result.hasChanges) {
      stats.filesModified++;
      stats.totalChanges += result.changes.length;

      const relativePath = path.relative(absolutePath, filePath);
      console.log(`✏️  ${relativePath}`);

      if (verbose) {
        result.changes.forEach((change) => {
          console.log(`    - [${change.category}] ${change.count} occurrence(s)`);
          if (change.note) {
            console.log(`      Note: ${change.note}`);
          }
        });
      }
    }
  });

  // Process package.json
  const packageJsonPath = path.join(
    fs.statSync(absolutePath).isDirectory() ? absolutePath : path.dirname(absolutePath),
    'package.json'
  );

  const pkgResult = updatePackageJson(packageJsonPath, dryRun);
  if (pkgResult.hasChanges) {
    console.log(`\n📦 package.json updates:`);
    pkgResult.changes.forEach((change) => {
      const symbol = change.action === 'add' ? '+' : '-';
      console.log(`    ${symbol} ${change.package} (${change.type})`);
    });
  }

  // Print summary
  console.log('\n' + '─'.repeat(50));
  console.log('\n📊 Summary:\n');
  console.log(`   Files scanned:  ${stats.filesScanned}`);
  console.log(`   Files modified: ${stats.filesModified}`);
  console.log(`   Total changes:  ${stats.totalChanges}`);

  if (dryRun) {
    console.log('\n⚠️  Dry run complete. No files were modified.');
    console.log('   Run without --dry-run to apply changes.\n');
  } else {
    console.log('\n✅ Migration complete!\n');
    console.log('📋 Next steps:');
    console.log('   1. Run `npm install` or `yarn` to update dependencies');
    console.log('   2. Review the changes in your codebase');
    console.log('   3. Test your application thoroughly');
    console.log('   4. Check MIGRATION.md for any manual updates needed\n');
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  transformFile,
  updatePackageJson,
  applyTransforms,
  ensureBlokImport,
  BUNDLED_TOOLS,
  IMPORT_TRANSFORMS,
  TYPE_TRANSFORMS,
  CLASS_NAME_TRANSFORMS,
  CSS_CLASS_TRANSFORMS,
  DATA_ATTRIBUTE_TRANSFORMS,
  SELECTOR_TRANSFORMS,
  HOLDER_TRANSFORMS,
  TOOL_CONFIG_TRANSFORMS,
  TEXT_TRANSFORMS,
};
