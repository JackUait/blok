---
name: test-driven-development
description: Use when implementing any feature or bugfix - write tests first, watch them fail, then implement
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## When to Use

**Always:**
- New features
- Bug fixes  
- Refactoring
- Behavior changes

**Exceptions (ask user first):**
- Throwaway prototypes
- Configuration files
- Generated code

Thinking "skip TDD just this once"? Stop. That's rationalization.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Delete means delete

## Red-Green-Refactor

### RED - Write Failing Test

1. Write ONE test for ONE behavior
2. Test should fail for the right reason (feature missing, not syntax error)
3. Test should be clear and readable
4. Use real code, not mocks (unless unavoidable)

**Watch the test fail.** This proves it tests something real.

### GREEN - Make It Pass

1. Write MINIMAL code to pass the test
2. Don't add anything the test doesn't require
3. "Fake it till you make it" is fine initially
4. Just make the test pass, nothing more

### REFACTOR - Clean Up

1. Remove duplication
2. Improve naming
3. Simplify structure
4. **Keep tests passing**

Repeat the cycle for the next behavior.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Already manually tested" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Need to explore first" | Fine. Then throw away exploration. Start with TDD. |
| "Test too hard to write" | Listen to the test. Hard to test = hard to use. |
| "TDD will slow me down" | TDD faster than debugging. |
| "Keep code as reference" | You'll adapt it. That's testing after. Delete. |

## Red Flags - STOP and Start Over

If you notice:

- Code exists before test
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "This is different because..."
- Test passes immediately on first run

**Delete the code. Start over with TDD.**

## Blok-Specific Patterns

### Unit Tests (Vitest)

Location: `test/unit/`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ComponentName', () => {
  beforeEach(() => {
    // Setup
  });

  it('should [expected behavior]', () => {
    // Arrange
    // Act  
    // Assert
    expect(result).toBe(expected);
  });
});
```

### E2E Tests (Playwright)

Location: `test/playwright/tests/`

```typescript
import { test, expect } from '@playwright/test';

test('user can [action]', async ({ page }) => {
  await page.goto('/');
  
  // Use resilient locators
  await page.getByRole('button', { name: 'Add Block' }).click();
  
  await expect(page.getByTestId('block')).toBeVisible();
});
```

### Commands

```bash
yarn test           # Run unit tests
yarn test:watch     # Watch mode
yarn e2e            # Run E2E tests (all browsers)
yarn e2e:chrome     # Chromium only
```

## Verification Checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason
- [ ] Wrote minimal code to pass
- [ ] All tests pass
- [ ] No linting errors (`yarn lint`)
- [ ] Tests use real code (mocks only if unavoidable)

Can't check all boxes? You skipped TDD. Start over.

## When Stuck

| Problem | Solution |
|---------|----------|
| Don't know how to test | Write the wished-for API. Write assertion first. |
| Test too complicated | Design too complicated. Simplify interface. |
| Must mock everything | Code too coupled. Use dependency injection. |
| Test setup huge | Extract helpers. Still complex? Simplify design. |
