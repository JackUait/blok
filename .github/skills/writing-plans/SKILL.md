---
name: writing-plans
description: Use when task requires multiple steps, touches multiple files, or takes more than 15 minutes
---

# Writing Plans

## Overview

Break complex work into bite-sized tasks. Each task should be completable in one focused session.

**Core principle:** A good plan makes execution obvious. If you're unsure what to do next, the plan isn't detailed enough.

## When to Use

- Multi-file changes
- New features
- Refactoring
- Any task estimated > 15 minutes
- When user asks for a plan

**NOT needed for:**
- Single-file, single-function changes
- Quick fixes with obvious implementation
- Tasks you can hold entirely in your head

## Plan Structure

### 1. Overview

One paragraph describing:
- What we're building/changing
- Why (the problem it solves)
- High-level approach

### 2. Prerequisites

What must be true before starting:
- [ ] Dependencies installed
- [ ] Required understanding
- [ ] Existing code reviewed

### 3. Tasks

Each task should be:
- **Atomic**: Completable in one sitting
- **Testable**: Clear success criteria
- **Ordered**: Dependencies explicit
- **Small**: 15-30 minutes each

Format:
```markdown
### Task N: [Verb] [What]

**Files:** `path/to/file.ts`

**Steps:**
1. [Specific action]
2. [Specific action]
3. [Specific action]

**Verification:**
- [ ] [How to know it's done]
```

### 4. Verification

How to verify the entire plan succeeded:
- Tests to run
- Manual checks
- User acceptance criteria

## Example Plan

```markdown
# Plan: Add Block Duplication Feature

## Overview

Add ability to duplicate any block in the editor. User clicks 
duplicate button, and an exact copy appears below the original.

## Prerequisites

- [ ] Understand Block class lifecycle hooks
- [ ] Review existing block creation in blockManager.ts
- [ ] Check if duplicate functionality conflicts with existing features

## Tasks

### Task 1: Add duplicate method to BlockManager

**Files:** `src/components/modules/blockManager.ts`

**Steps:**
1. Add `duplicate(blockId: string)` method
2. Get block data via `block.save()`
3. Create new block with same tool and data
4. Insert after original block

**Verification:**
- [ ] Unit test passes: blockManager.duplicate creates copy
- [ ] No TypeScript errors

### Task 2: Add duplicate button to block toolbar

**Files:** `src/components/modules/ui.ts`

**Steps:**
1. Add duplicate icon to block toolbar
2. Wire click handler to call blockManager.duplicate
3. Add appropriate ARIA label

**Verification:**
- [ ] Button visible in toolbar
- [ ] Click creates duplicate block

### Task 3: Write E2E test

**Files:** `test/playwright/tests/block-duplicate.spec.ts`

**Steps:**
1. Create test that adds block, clicks duplicate
2. Verify two blocks exist with same content
3. Verify new block is after original

**Verification:**
- [ ] E2E test passes in all browsers

## Final Verification

- [ ] `yarn lint` passes
- [ ] `yarn test` passes  
- [ ] `yarn e2e` passes
- [ ] Manual test: can duplicate paragraph, header, list blocks
```

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| Vague tasks ("implement feature") | Unclear when done |
| Too large tasks (> 1 hour) | Lose focus, hard to verify |
| Missing dependencies | Tasks blocked by earlier work |
| No verification | Don't know if done |
| Plan not updated as you learn | Reality diverged from plan |

## Red Flags

Stop and revise plan if:

- You're unsure what to do next
- Task is taking much longer than expected
- You discover missing prerequisites
- Scope has changed significantly

## Living Document

The plan should evolve:

1. **Before starting**: Write initial plan
2. **During execution**: Update as you learn
3. **After each task**: Mark complete, note surprises
4. **If blocked**: Add new tasks or revise existing

A plan that doesn't change probably isn't being used.

## Completion Criteria

Plan is complete when:

- [ ] Overview explains what and why
- [ ] Tasks are atomic (< 30 min each)
- [ ] Each task has clear verification
- [ ] Dependencies between tasks are explicit
- [ ] Final verification defined
- [ ] User has approved the plan

Now execute using the `executing-plans` skill.
