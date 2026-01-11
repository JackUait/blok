---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior - before proposing fixes
---

# Systematic Debugging

## Overview

Find the root cause. Fix it once. Move on.

**Core principle:** Never fix symptoms. Find the actual source of the problem.

**If you haven't traced the bug to its origin, you haven't debugged it.**

## When to Use

- Test failures
- Runtime errors
- Unexpected behavior
- Performance issues
- "It works locally but not in CI"
- Any time something isn't working as expected

## The Four Phases

### Phase 1: Investigate (Don't Touch Code Yet)

**DO NOT write any fix until you complete this phase.**

1. **Reproduce reliably**
   - Can you make it happen consistently?
   - What's the minimal reproduction?
   - What are the exact steps?

2. **Gather evidence**
   - Error messages (full text)
   - Stack traces
   - Console output
   - Relevant logs
   - Recent changes

3. **State the problem clearly**
   - Expected behavior: [what should happen]
   - Actual behavior: [what actually happens]
   - Difference: [the gap]

### Phase 2: Hypothesize

1. **Form a single hypothesis**
   - "The bug is caused by X because Y"
   - Be specific, not vague

2. **Predict what you'll see if hypothesis is correct**
   - "If X is the cause, then when I do Y, I should see Z"

3. **Design a test for the hypothesis**
   - How will you verify/falsify?

### Phase 3: Verify

1. **Test your hypothesis**
   - Add logging at key points
   - Check state at each step
   - Verify assumptions

2. **If hypothesis WRONG:**
   - Record what you learned
   - Form new hypothesis with new information
   - Return to Phase 2

3. **If hypothesis CONFIRMED:**
   - You've found the root cause
   - Proceed to Phase 4

### Phase 4: Fix

1. **Write failing test first**
   - Test that reproduces the bug
   - Must fail before fix
   - Use TDD skill

2. **Implement single fix**
   - Address root cause only
   - ONE change at a time
   - No "while I'm here" improvements

3. **Verify fix**
   - Test passes now?
   - No other tests broken?
   - Issue actually resolved?

4. **If fix doesn't work:**
   - STOP
   - How many fixes have you tried?
   - If ≥ 3: Step back, question assumptions

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| "Let me try this quick fix" | Symptom-treating, not root cause |
| "I'll add some logging and see" | Unfocused investigation |
| "Maybe it's X, let me change that" | Guessing without hypothesis |
| "Fixed it!" (no test) | Can't verify, might regress |
| Multiple simultaneous changes | Can't tell what worked |
| "Works now, moving on" | Without understanding why |

## Red Flags - You're Off Track

Stop and restart investigation if:

- You've tried 3+ fixes without success
- You're changing code without understanding why
- Each "fix" breaks something else
- You can't explain the root cause to someone else
- You're copying solutions from Stack Overflow without understanding

## Blok-Specific Debugging

### Common Issues

**Block rendering issues:**
```typescript
// Check block data structure
console.log(JSON.stringify(block.data, null, 2));
// Verify block tool is registered
console.log(this.editor.tools.available);
```

**Event handling issues:**
```typescript
// Add listener debugging
this.listeners.on('block-changed', (data) => {
  console.log('Block changed:', data);
});
```

**E2E test failures:**
```bash
# Run with UI for debugging
yarn e2e:ui

# Check specific test
yarn e2e:chrome -- --grep "test name"
```

### Debug Commands

```bash
# Unit tests with verbose output
yarn test -- --reporter=verbose

# E2E with trace
yarn e2e -- --trace on

# View last trace
npx playwright show-trace test-results/*/trace.zip
```

## Root Cause Tracing

When you find a symptom, ask: "What caused THIS?"

```
Symptom: Test timeout
    ↓ What caused this?
State not reset between tests
    ↓ What caused this?
Cleanup function not called
    ↓ What caused this?
afterEach hook missing
    ↓ ROOT CAUSE
```

Keep asking until you reach the origin.

## Verification Checklist

Before declaring "fixed":

- [ ] Root cause identified and documented
- [ ] Failing test written that catches the bug
- [ ] Single, targeted fix implemented
- [ ] Test now passes
- [ ] All other tests still pass
- [ ] Can explain to someone else why it was broken
- [ ] `yarn lint` passes
- [ ] Manual verification confirms fix
