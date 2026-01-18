---
name: find-errors
description: Use when asked to find files with specific errors, search for error patterns across the codebase, or list files containing error references. Outputs results to batched .md files.
---

# Find Errors

## Overview

Search the entire codebase for specific error patterns and write results to `.md` files. Batches results (10 files per output) to keep outputs focused and actionable.

## Core Pattern

### Before (Results Not Saved)
```
# Agent lists files with errors in chat
Found 25 files with "TODO" errors:
- src/file1.ts
- src/file2.ts
...
# Results lost in chat history, not actionable
```

### After (Results Written to Files)
```
# Agent writes results to .md files
Created: errors_001.md (10 files)
Created: errors_002.md (10 files)
Created: errors_003.md (5 files)
# Results preserved, can be processed systematically
```

## Implementation

### Step 1: Parse Arguments

`$ARGUMENTS` contains the search pattern:
- `/find-errors TS2345` - Search for TypeScript error TS2345
- `/find-errors "TODO"` - Search for TODO comments
- `/find-errors @ts-ignore` - Search for type suppressions

### Step 2: Search the Codebase

Use Grep to find all files containing the pattern:
```bash
# Search with pattern from $ARGUMENTS (all file types)
grep -r "$ARGUMENTS" /path/to/project
```

### Step 3: Batch Results (10 per file)

Collect all matching file paths and split into batches of 10.

### Step 4: Write Output Files

Create numbered output files:
```
errors-batch-1.md
errors-batch-2.md
errors-batch-3.md
...
```

Each file contains ONLY the file paths (one per line):
```markdown
src/file1.ts
src/file2.tsx
src/utils/helper.ts
...
```

### Step 5: Report Summary

Report number of batches created and total files found:
```
Found 25 files with "$ARGUMENTS"
Created 3 batch files:
- errors-batch-1.md (10 files)
- errors-batch-2.md (10 files)
- errors-batch-3.md (5 files)
```

## Quick Reference

| Argument | Action |
|----------|--------|
| Pattern (e.g., `TS2345`) | Search .md files for this pattern |
| None | Prompt user for search pattern |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Not batching results | Always create batches of 10 |
| Including extra content | Output files must contain ONLY paths |
| Not searching all files | Search entire codebase, not just specific file types |
| Not reporting summary | Always show batch count and file count |

## Iron Rule

**Output files MUST contain ONLY file paths. One per line. No headers, no explanations, no extra formatting.**

Example of correct output:
```markdown
# Correct - ONLY paths
src/file1.ts
src/file2.tsx
src/utils/helper.ts
```

Example of incorrect output:
```markdown
# Incorrect - has header
## Files Found
src/file1.ts
src/file2.tsx
```
