---
name: git-pr-description
description: Use when creating or updating a pull request description for a branch. Required before gh pr create.
---

# Git PR Description

## When to Use

- Creating a new PR (`gh pr create`)
- Updating an existing PR description
- User asks to generate PR description

## Process

```bash
# Run in parallel for context
git status
git diff <base-branch>...HEAD
git log <base-branch>...HEAD --oneline
```

## Description Format

```markdown
## Summary
<2-3 bullet points per major feature area - what changed AND why>

## Changes
<key files modified with brief explanation - REQUIRED for multi-file changes>

## Test Plan
- [ ] Test [specific behavior] via [test method]
```

## Critical Rules

1. **Cover EVERY commit** - Run `git log <base>...HEAD --oneline | wc -l` and verify each commit is represented
2. **Describe what AND why** - Don't just list commit messages
3. **Be specific** - No "see commits", "various fixes", or "none"
4. **Always include test plan** - Specific verification steps

## Execute

After generating the description, create or update the PR:

```bash
# Create new PR
gh pr create --title "Title" --body "description"

# OR update existing PR
gh pr edit <pr-number> --body "description"
```
