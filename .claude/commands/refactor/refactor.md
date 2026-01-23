---
description: MANDATORY - ALWAYS run after completing any work. Use when finishing any task to review and clean up code changes made in the current chat session
---

# Refactor Current Session Changes

**MANDATORY:** This skill MUST be run after completing ANY implementation work. No exceptions.

Review and fix issues in code changed during this chat session only.

## Scope

**CRITICAL:** Only analyze files changed in the current chat session. Use the baseline state captured at session start.

## Process

1. **Read baseline state:** The SessionStart hook captures initial git state to `.claude/hooks/session-state.json`
2. **Get current changes:** Run `git diff --name-only HEAD` to see all currently modified files
3. **Compare:** Session-only changes = current files minus baseline files
4. Read each session-only changed file
5. Analyze for issues using the categories below
6. Auto-fix all high-priority issues directly
7. Report lower-priority issues at the end without fixing

**The start-chat hook automatically creates the baseline.** To get session-only files:

```bash
# Read baseline files (captured at session start)
if [ -f ".claude/hooks/session-state.json" ]; then
  BEFORE_FILES=$(jq -r '.modified_files[]?' .claude/hooks/session-state.json 2>/dev/null || echo "")
fi

# Get current changes
CURRENT_FILES=$(git diff --name-only HEAD)

# Filter to session-only changes (files changed since baseline)
if [ -n "$BEFORE_FILES" ]; then
  SESSION_FILES=$(comm -13 <(echo "$BEFORE_FILES" | sort) <(echo "$CURRENT_FILES" | sort))
else
  # No baseline = use all changes
  SESSION_FILES="$CURRENT_FILES"
fi
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
