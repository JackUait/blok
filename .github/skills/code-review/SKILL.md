---
name: code-review
description: Use when preparing code for review or responding to review feedback
---

# Code Review

## Overview

Good reviews catch issues early. Giving and receiving reviews are both skills.

## Part 1: Preparing for Review

Before requesting review, verify:

### Self-Review Checklist

- [ ] `yarn lint` passes
- [ ] `yarn test` passes  
- [ ] `yarn e2e` passes (or at minimum `yarn e2e:chrome`)
- [ ] Read your own diff as if you're the reviewer
- [ ] No debugging code left (console.log, debugger)
- [ ] No commented-out code
- [ ] No TODO comments without issue references
- [ ] Changes are focused (single concern per PR)

### Code Quality

- [ ] Variable/function names are clear
- [ ] Complex logic has comments explaining WHY
- [ ] No magic numbers (use constants)
- [ ] Types are explicit (no `any`)
- [ ] Error cases handled

### Testing

- [ ] New code has tests
- [ ] Tests are readable
- [ ] Edge cases covered
- [ ] Tests would fail if feature broken

### Documentation

- [ ] Public APIs documented
- [ ] Breaking changes noted
- [ ] README updated if needed

## Part 2: Receiving Review Feedback

### Mindset

- Feedback is about code, not you
- Reviewers are helping, not attacking
- "I don't understand" means unclear, not wrong

### Responding to Comments

**For each comment:**

1. **Read carefully** - understand what's being asked
2. **Respond explicitly** - don't leave comments unaddressed
3. **Take action** - either change code or explain why not

**Response types:**

- "Done" - made the change
- "Good catch, fixed" - made change, acknowledged value
- "I considered that, but [reason]" - explain decision (not defensive)
- "Could you clarify?" - if unclear what's being asked

### Common Review Feedback

| Feedback | Response Pattern |
|----------|------------------|
| "This is unclear" | Add comment or rename. Don't argue it's clear. |
| "Add tests" | Add tests. Coverage matters. |
| "This could be simpler" | Consider the suggestion. Often they're right. |
| "Why this approach?" | Explain reasoning, or reconsider if can't. |
| "Nitpick: [style]" | Usually just fix it, not worth debating. |

### Resolving Disagreements

1. State your position clearly
2. Understand their position fully
3. Find common ground or escalate to third party
4. Don't get personal

## Blok-Specific Review Points

### TypeScript

- No `@ts-ignore`
- No `any` type
- No `!` non-null assertions
- Proper use of `type` imports

### Testing

- Unit tests use Vitest patterns
- E2E tests use resilient locators
- Tests are in correct directory (`test/unit/` or `test/playwright/tests/`)

### DOM/Accessibility

- Semantic HTML elements
- ARIA attributes where needed
- Keyboard accessible

### Performance

- No unnecessary re-renders
- Event listeners cleaned up
- No memory leaks in lifecycle hooks

## Pre-Review Summary

Write a summary for reviewers:

```markdown
## Changes

- Added block duplication feature
- New method: `BlockManager.duplicate()`
- New toolbar button with keyboard shortcut

## Testing

- Unit tests for duplicate logic
- E2E test for user flow
- Manually tested in Chrome, Firefox, Safari

## Notes for Reviewers

- Approach X was considered but rejected because Y
- This is related to issue #123
```

This helps reviewers focus on important decisions.
