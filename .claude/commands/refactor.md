---
description: Use when finishing a task to review and clean up code changes made in the current chat session
---

# Refactor Current Session Changes

Review and fix issues in code changed during this chat session only.

## Scope

**CRITICAL:** Only analyze files changed in the current chat session. Use git to establish a baseline.

## Process

1. **Establish baseline:** Run `git diff --name-only HEAD` to capture files already changed before this session
2. **Get current changes:** Run `git diff --name-only HEAD` again (in parallel with step 1 if this is first check)
3. **Compare:** Changed files = current minus baseline. Skip files that were already modified
4. If working tree is clean at baseline, use `git diff --name-only HEAD~1..HEAD` for session files
5. Read each changed file
6. Analyze for issues using the categories below
7. Auto-fix all high-priority issues directly
8. Report lower-priority issues at the end without fixing

**Example baseline capture (run once per session):**
```bash
# Capture initial state - files changed before this chat
BEFORE_FILES=$(git diff --name-only HEAD) || echo ""

# Later - get current state and filter to session changes only
CURRENT_FILES=$(git diff --name-only HEAD)
SESSION_FILES=$(comm -13 <(echo "$BEFORE_FILES" | sort) <(echo "$CURRENT_FILES" | sort))
```

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
