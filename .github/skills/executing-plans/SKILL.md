---
name: executing-plans
description: Use when executing a written plan - one task at a time with verification checkpoints
---

# Executing Plans

## Overview

Execute plans one task at a time. Verify after each. Never skip ahead.

**Core principle:** A task isn't done until it's verified. Verification isn't optional.

## The Process

### Before Starting

1. **Review the full plan** - understand the big picture
2. **Check prerequisites** - all requirements met?
3. **Identify current task** - which task is next?

### For Each Task

1. **Announce the task**
   > "Starting Task N: [description]"

2. **Execute the steps**
   - Follow steps as written
   - If blocked, note it and adapt
   - Don't jump to later tasks

3. **Verify completion**
   - Check all verification criteria
   - Run tests mentioned
   - Document any deviations

4. **Mark complete**
   > "Task N complete. [any notes]"

5. **Move to next task**

### After All Tasks

1. **Run final verification** - all criteria from plan
2. **Summary of changes** - what was done
3. **Any surprises** - deviations from plan

## Checkpoints

After each task, ask:

- [ ] Did the task succeed?
- [ ] Are all tests passing?
- [ ] Is the code in a working state?
- [ ] Should I commit at this point?
- [ ] Does the plan need updating?

If any answer is "no" or "unsure", stop and address before continuing.

## Handling Deviations

**Plan says one thing, reality says another?**

1. **Small deviation**: Note it, proceed
   > "Note: Used alternative approach because [reason]"

2. **Medium deviation**: Update plan, then proceed
   > "Updating plan: Task 3 now requires [new steps]"

3. **Large deviation**: Stop, reassess
   > "Significant issue discovered. Need to revise plan before continuing."

**Never silently deviate** - document everything.

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| Skipping verification | Don't know if actually done |
| "I'll run tests at the end" | Bugs compound, harder to fix |
| Jumping ahead to "easy" tasks | Dependencies not met |
| Not updating plan | Reality diverges from documentation |
| "It worked when I did it" | No proof for others |

## Red Flags

Stop execution if:

- Two consecutive tasks fail verification
- You're unsure what the current task means
- Dependencies from earlier tasks are missing
- Scope has grown significantly

## Blok-Specific Execution

### Verification Commands

After code changes:
```bash
yarn lint        # Must pass - no type errors, no lint errors
yarn test        # Unit tests
yarn e2e:chrome  # Quick E2E check
```

### Commit Points

Good times to commit:
- After each completed task (if all tests pass)
- Before starting a risky change
- After fixing an unexpected issue

### When Stuck

1. Check error messages carefully
2. Use `systematic-debugging` skill if needed
3. Review the plan - is the task correctly specified?
4. Ask user for guidance if blocked > 10 minutes

## Progress Tracking

Keep visible progress:

```markdown
## Execution Status

- [x] Task 1: Add duplicate method - Done
- [x] Task 2: Add toolbar button - Done  
- [ ] Task 3: Write E2E test - In Progress
- [ ] Task 4: Update documentation - Pending
```

Update after each task completion.

## Completion

Execution is complete when:

- [ ] All tasks marked done
- [ ] All verifications passed
- [ ] Final verification from plan passed
- [ ] `yarn lint` passes
- [ ] `yarn test` passes
- [ ] Summary provided to user
