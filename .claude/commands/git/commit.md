---
name: git-commit
description: Use when creating git commits for code changes. Use after completing tests, refactor, and verification. Required before pushing changes.
---

# Git Commit

## Overview
Create clean, descriptive git commits following project conventions.

**Use when:**
- All tests pass (unit + E2E if applicable)
- `/refactor` has been run
- Verification complete (for branches)
- Ready to push or continue work

**Do NOT use when:**
- Tests are failing
- Mid-refactoring without testing
- Just to checkpoint broken code

## Core Pattern

```bash
# Run in parallel for context
git status
git diff
git log -5 --oneline

# Analyze changes and draft commit message
# Stages all relevant files
# Creates commit with message + co-author tag
git status
```

## Commit Message Format

**Structure:**
```
<type>: <summary>
```

**Types:**
- `fix:` Bug fixes
- `test:` Test changes only
- `docs:` Documentation
- `refactor:` Code restructuring without behavior change
- `feat:` New features
- `chore:` Build/config, dependencies

**Summary rules:**
- Lowercase after type prefix
- 50 chars or less
- Imperative mood ("fix" not "fixed" or "fixes")
- Describe what/why, not how

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Committing failing tests | Fix tests first, then commit |
| Vague messages ("updates", "fix stuff") | Be specific about what changed |
| Missing Co-Authored-By tag | Always include it |
| Committing secrets/credentials | Check .env, credentials.json |
| Using `git commit --amend` | Create NEW commits only |

## Quick Reference

```bash
# Stage and commit in one
git add <files> && git commit -m "type: message"

# Interactive staging
git add -i  # or git add -p for patch-by-patch

# View staged changes
git diff --staged
```

## Real-World Impact

Good commits enable:
- `git bisect` to find bugs
- Clear change history
- Meaningful release notes
- Easy code reverts
