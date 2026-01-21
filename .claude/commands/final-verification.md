---
name: final-verification
description: Use when asked to find, audit, or fix accessibility (a11y) issues in a codebase, when reviewing components for WCAG compliance, or when seeing eslint jsx-a11y warnings
---

**MANDATORY: Run this AFTER `/refactor` completes, BEFORE declaring any work complete.**

## Commands (Copy-Paste)

```bash
# Create or update worktree for master branch
git worktree add ../blok-master master 2>/dev/null || true

# Compare your changes against master
cd ../blok-master
git checkout master
git diff ../blok

# Test SOMETHING in both branches to catch behavioral regressions
cd ../blok-master && yarn test [affected-test]
cd ../blok && yarn test [affected-test]
```

## What You're Checking

1. **Diff review**: Understand what changed relative to master
2. **Behavioral verification**: Run the same test in both branches - results should match
3. **No regressions**: If master passes and your branch fails, you broke something

## When to Run This

- After `/refactor` completes
- Before `git push`
- Before saying "done" or "complete"

## What NOT to Do

- Do NOT skip this "to save time"
- Do NOT run only on your branch (comparison is meaningless)
- Do NOT assume "no diff means safe" (still test)

## If Tests Differ

Master passes, your branch fails? You introduced a regression. Fix it before pushing.

## Cleanup After Verification

```bash
# Remove worktree when done (optional)
rm -rf ../blok-master
git worktree remove ../blok-master
```
