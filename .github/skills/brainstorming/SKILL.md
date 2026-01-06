---
name: brainstorming
description: Use BEFORE any creative work - creating features, building components, adding functionality, or modifying behavior
---

# Brainstorming

## Overview

**Never implement before understanding. Never code before designing.**

Brainstorming is Socratic design refinement. You ask questions, surface assumptions, explore alternatives, and reach clear requirements BEFORE writing code.

## When to Use

- Creating new features
- Building new components
- Adding functionality
- Modifying existing behavior
- Any task that changes what the code does

**NOT needed for:**
- Pure refactoring (same behavior, different structure)
- Bug fixes with clear root cause
- Mechanical changes (renaming, moving files)

## The Process

### Phase 1: Clarify Intent

Ask questions to understand what the user actually wants:

1. **What problem are we solving?** (Not "what feature" - the underlying need)
2. **Who is affected?** (Users, developers, both?)
3. **What does success look like?** (Observable outcome)
4. **What are the constraints?** (Time, compatibility, dependencies)

Don't assume. Ask.

### Phase 2: Surface Assumptions

State your assumptions explicitly:

- "I'm assuming we want to support X..."
- "I'm assuming backward compatibility is required..."
- "I'm assuming performance matters more than simplicity..."

Get confirmation or correction before proceeding.

### Phase 3: Explore Alternatives

For any non-trivial decision:

1. **Option A**: [approach] - Pros: ... Cons: ...
2. **Option B**: [approach] - Pros: ... Cons: ...
3. **Recommendation**: [which and why]

Don't just present your preferred solution. Show the tradeoffs.

### Phase 4: Agree on Approach

Summarize the agreed approach before implementation:

- Problem we're solving
- Approach we're taking
- Key decisions made
- Out of scope (explicitly)

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| "I'll just start coding" | You don't know what you're building |
| "The user said X, so I'll do X" | Users often describe solutions, not problems |
| "This is obvious" | Obvious to you ≠ obvious to user |
| "I'll figure it out as I go" | Exploration without direction wastes time |

## Red Flags

Stop and brainstorm MORE if you notice:

- Uncertainty about what to build
- Multiple valid approaches with unclear winner
- Scope creeping during implementation
- User clarifying "that's not what I meant"

## Example Dialogue

**User**: "Add a undo feature to the editor"

**Good response**:
> Before I implement undo, let me understand the requirements:
> 
> 1. Should undo be block-level (undo one block's changes) or global (undo any recent change)?
> 2. How many levels of undo do we need?
> 3. Should undo work across sessions or just the current session?
> 4. Are there operations that should NOT be undoable?

**Bad response**: *Immediately starts implementing an undo stack*

## Completion Criteria

Brainstorming is complete when:

- [ ] Problem is clearly stated
- [ ] Assumptions are confirmed
- [ ] Approach is agreed
- [ ] Scope is defined (including what's out of scope)
- [ ] User has said "yes, proceed" or equivalent

Now proceed to implementation (using appropriate skills like TDD).
