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
git diff <base-branch>...HEAD --stat
git log <base-branch>...HEAD --oneline
git diff <base-branch>...HEAD
```

## Description Format

```markdown
## Summary

### Bug Fixes
<fix-related bullets>

### Features
<feature-related bullets>

### Tests
<test-related bullets>

### Refactoring
<refactor-related bullets>

### Documentation
<documentation-related bullets>

### Configuration
<config/build-related bullets>
```

## Critical Rules

1. **Concise but complete** - One line per change or related group of changes
2. **Cover EVERY commit** - Verify all commits are represented
3. **No vague language** - No "various fixes", "improvements", or "see commits"
4. **Categorize changes** - Group by type (Bug Fixes, Features, Tests, etc.)

## Formula

For each commit or related commits, write ONE line:

```
<verb> <what> <context/detail>
```

**Verbs**: Fix, Add, Remove, Update, Refactor, Extract, Simplify, Improve

**Examples**:
- `Fix toolbar closing when clicking outside horizontal bounds`
- `Add E2E test for toolbar rubber-band hover interaction`
- `Remove non-null assertions from test assertions`
- `Update list item spacing to match paragraph height`
- `Simplify list spacing assertions to class name checks`

## Category Guidelines

| Category | When to Use | Verbs |
|----------|-------------|-------|
| **Bug Fixes** | Resolving defects, incorrect behavior | Fix, Correct, Resolve |
| **Features** | New functionality, capabilities | Add, Introduce, Implement |
| **Tests** | Test coverage, test improvements | Add, Improve, Simplify |
| **Refactoring** | Code structure changes without behavior change | Refactor, Extract, Consolidate |
| **Performance** | Speed, optimization improvements | Optimize, Improve, Reduce |
| **Documentation** | Docs, comments, guides | Add, Update, Expand |
| **Configuration** | Build, config, tooling | Update, Configure, Add |

## Example - Good (Categorized + Complete)

```markdown
## Summary

### Bug Fixes
- Fix toolbar closing when clicking outside editor horizontal bounds
- Fix list item vertical spacing to match paragraph height

### Features
- Add cross-block selection rectangle bounds calculation
- Add git command skills for description and worktree cleanup

### Tests
- Add E2E test for toolbar rubber-band hover interaction
- Add E2E test coverage for UI module behaviors
- Add ESLint disable comments for justified class selector usage
- Simplify list spacing assertions to class name checks
- Remove non-null assertions from test assertions
- Improve flaky test selector and remove unnecessary null check

### Refactoring
- Improve block hover controller debouncing and boundary detection
```

11 bullets, 11 commits covered. Each line is one concise change. Organized by category.

## Example - Bad (Too Vague)

```markdown
## Summary
- Fix various bugs
- Improve tests
- Refactor UI modules
```

**Missing**: What bugs? Which tests? What refactoring? No categories.

## Example - Bad (Too Verbose)

```markdown
## Summary
- Fix toolbar closing when clicking outside editor horizontal bounds by checking clientX against editor bounds in click handler located in src/components/modules/toolbar/index.ts
```

Too much detail. Keep it to one line.

## Execute

After generating the description, you MUST create or update the PR on GitHub:

```bash
# Create new PR
gh pr create --title "Title" --body "description"

# OR update existing PR (via REST API - more reliable for multi-line bodies)
gh api --method PATCH \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  /repos/OWNER/REPO/pulls/<pr-number> \
  -f body="description"
```

**Do NOT consider the task complete until the PR description has been updated on GitHub.**

**Note**: The `gh pr edit` command can have issues with complex multi-line descriptions due to shell parsing. The REST API method above is more reliable for full descriptions.
