---
name: minimal-solution-only
description: Use when reviewing code for over-engineering, after completing a feature, or when code feels too complex for the stated task
---

# Minimal Solution Review

Review code and remove anything that doesn't directly contribute to the stated task.

## What to Remove

- **Unused logic**: Code paths never executed for this task
- **Redundant abstractions**: Classes/interfaces that add indirection without value
- **Dead code**: Commented code, unused imports, unreachable branches
- **Premature optimizations**: Caching, pooling, or performance tricks without measured need
- **Unnecessary configuration**: Options, flags, or settings not required by the task
- **Speculative features**: TODOs, "future-proofing", extensibility for hypothetical requirements
- **Convenience wrappers**: Aliases, shortcuts, or helpers that duplicate existing functionality

## Red Flags - You're Rationalizing

Stop and reconsider if you think:

| Thought | Reality |
|---------|---------|
| "This is production code" | Production needs simplicity more than complexity |
| "This makes it robust" | Robust = handling real failures, not hypothetical ones |
| "A senior developer wrote this" | Seniority doesn't justify over-engineering |
| "The team might need this later" | Delete it. They can add it when they need it. |
| "It's good practice" | Good practice is minimal code that works |
| "This is core infrastructure" | If it's not used by the task, it's not core |
| "It distinguishes failure modes" | Only if the task requires distinguishing them |

## Process

1. **State the task explicitly** - Write it down. "The task is: ___"
2. **For each file/function, ask**: Does this directly contribute to that task?
3. **If uncertain, remove it** - Code that might be useful isn't useful yet
4. **Show the final minimal code** - Not just a list of what to remove

## Preserve

- **Tests** - Never remove tests. Tests verify the task works correctly.
- Correctness (code must still work)
- Clarity (code should remain readable)
- Maintainability (reasonable structure, not spaghetti)

Do not change behavior. Only remove what isn't needed.
