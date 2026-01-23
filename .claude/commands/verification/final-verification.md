---
name: final-verification
description: Use when about to say work is "done", "complete", or "finished", when considering git push, or when a session appears to be ending with code changes
---

**MANDATORY: Run this AFTER `/refactor` completes, BEFORE declaring any work complete.**

**Violating the letter of these rules is violating the spirit of these rules.**

## What This Does

Compares your branch against master to catch regressions BEFORE they reach production.

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
- **ALWAYS when any code changed**

## What NOT to Do

- Do NOT skip this "to save time"
- Do NOT run only on your branch (comparison is meaningless)
- Do NOT assume "no diff means safe" (still test)
- Do NOT defer this to "next session"

## If Tests Differ

Master passes, your branch fails? You introduced a regression. Fix it before pushing.

## Cleanup After Verification

```bash
# Remove worktree when done (optional)
rm -rf ../blok-master
git worktree remove ../blok-master
```

## Rationalizations vs Reality

| Excuse | Reality |
|--------|---------|
| "Chat is too long, instructions are far down" | You're reading them right now. |
| "User is in a hurry" | Half-done work wastes MORE time later. |
| "It's just a small change" | Small changes break things too. |
| "I'll do it in next session" | That leaves work stranded. |
| "No diff means nothing changed" | Still test - behavior can change without diff. |
| "I already verified manually" | Manual verification misses edge cases. |
| "Push can wait, user can do it" | Work NOT complete until push succeeds. |

## Red Flags - You're About to Violate The Rules

If you catch yourself thinking ANY of these, STOP and run verification NOW:

- "Chat is too long, I can't find the instructions"
- "User is in a hurry, I'll skip verification this time"
- "It's just a small change, doesn't need full process"
- "I'll do the verification in the next session"
- "I already manually verified it works"
- "The push can wait, user can do it"
- "Final verification takes too long"
- "Tests already pass, verification is redundant"

**All of these mean: You're rationalizing. Run verification NOW.**

## Work Is NOT Complete Until

- [ ] Verification run against master
- [ ] No regressions found
- [ ] `git push` succeeded
- [ ] `git status` shows "up to date with origin"

**If ANY box is unchecked:** Work is NOT complete. Do it NOW.
