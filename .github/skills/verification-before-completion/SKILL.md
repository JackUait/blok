---
name: verification-before-completion
description: Use before declaring any task complete - ensure work actually meets requirements
---

# Verification Before Completion

## Overview

Saying "done" means verified done. Not "probably done." Not "should work."

**Core principle:** Claims without evidence are worthless. Verify before declaring success.

## When to Use

Before saying:
- "Done"
- "Fixed"  
- "Implemented"
- "Complete"
- "Ready for review"

## The Verification Checklist

### 1. Code Quality

```bash
yarn lint        # No errors or warnings
yarn test        # All tests pass
```

- [ ] TypeScript compiles without errors
- [ ] ESLint passes without warnings
- [ ] All existing tests pass
- [ ] No console.log/debugger statements left

### 2. Test Coverage

- [ ] New code has tests
- [ ] Tests actually test the new behavior
- [ ] Edge cases considered
- [ ] Error paths tested

### 3. Requirements Met

- [ ] Re-read the original request
- [ ] Does implementation match what was asked?
- [ ] Any scope items missed?
- [ ] Any assumptions that need confirmation?

### 4. Manual Verification

- [ ] Run the code/feature manually
- [ ] Test the happy path
- [ ] Test at least one error case
- [ ] Test in relevant browsers (for E2E)

### 5. Documentation

- [ ] Code comments where needed
- [ ] Types properly documented
- [ ] README updated if behavior changed
- [ ] Changelog entry if significant

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| "Tests pass, so it works" | Tests might not cover this change |
| "It works locally" | Environment differences |
| "I'm pretty sure it's fine" | Pretty sure ≠ verified |
| "User can test it" | Shipping uncertainty |
| Skipping manual test | Automated tests miss things |

## Red Flags - Not Actually Done

Stop and re-verify if:

- You can't demonstrate the feature working
- You haven't run the code yourself
- You're not sure about edge cases
- Tests were changed to pass (not fixed properly)
- You're rushing to declare done

## Quick Verification Flow

For typical Blok changes:

```bash
# 1. Code compiles
yarn build

# 2. Lint passes
yarn lint

# 3. Unit tests pass
yarn test

# 4. E2E tests pass (at minimum chrome)
yarn e2e:chrome

# 5. Manual check in browser
yarn serve
# Then test the feature manually
```

## Declaring Done

Only say "done" when you can answer YES to all:

1. **Compiles?** No type errors
2. **Lints?** No warnings
3. **Tests?** All passing, new code tested
4. **Works?** Manually verified
5. **Matches request?** Re-read original, confirmed

Then and only then:

> "Complete. [Summary of what was done]. Verified: lint passes, tests pass, manually tested [specific scenario]."

## Incomplete Completion

If you can't fully verify:

> "Partially complete. Done: [x, y]. Remaining: [z]. Blocked by: [reason]."

Honest about state is better than false claims of done.
