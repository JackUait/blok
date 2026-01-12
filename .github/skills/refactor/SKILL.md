---
description: Run after completing a task to clean up your changes
---

# Refactor Recent Changes

Review and fix issues in your recent changes.

## Scope

Analyze uncommitted changes (staged + unstaged). If working tree is clean, analyze changes since the last commit.

## Process

1. Run `git diff HEAD` to identify changed files (or `git diff HEAD~1` if working tree is clean)
2. Read each changed file
3. Analyze for issues using the categories below
4. Auto-fix all high-priority issues directly
5. Report lower-priority issues at the end without fixing

## Issue Categories

Analyze for:

1. Dead, unused, or redundant code
2. Unnecessary complexity - suggest simpler alternatives
3. Implementation correctness and efficiency
4. Best practice deviations (readability, maintainability, performance)
5. TypeScript typing issues:
   - Overly broad types (`any`, `unknown`)
   - Missing or incorrect generics
   - Unsafe type assertions
   - Null/undefined handling

## Priority Classification

**High priority (auto-fix):**
- Dead/unused code and imports
- Type safety issues (`any`, missing null checks, unsafe assertions)
- Complexity reductions (redundant conditionals, repeated code)
- Naming improvements for clarity
- Structural improvements (reordering, breaking up large functions)

**Lower priority (report only):**
- Style preferences without clear benefit
- Speculative optimizations
- Changes that would significantly alter the approach

## Output Format

1. Briefly state what files you're reviewing
2. Make fixes silently - don't narrate each change
3. After all fixes, summarize what you changed
4. List any lower-priority issues you didn't fix, with brief explanations
