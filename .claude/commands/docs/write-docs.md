---
name: writing-user-documentation
description: Use when writing user-facing documentation for code changes, features, or project updates. Use when documentation needs to be clear to intelligent readers unfamiliar with the codebase.
---

# Writing User Documentation

## Overview

Write clear, concise documentation that helps users understand what your software does and how to use it—without needing to read the source code.

**Core principle:** Documentation is for users, not developers. Focus on outcomes, not implementation.

## When to Use

```
User-facing change? → Write docs
Internal refactor?  → Skip docs
```

**Write documentation for:**
- New features or functionality
- Breaking changes or migration guides
- API changes that affect consumers
- Common pitfalls and how to avoid them
- Usage examples that aren't obvious

**Skip documentation for:**
- Internal implementation details
- Variable renames or refactoring
- Bug fixes with no user impact
- Changes obvious from code inspection

## Quick Reference

| Section | Content | Example |
|---------|---------|---------|
| **What** | What problem does this solve? | "Validates email addresses before submission" |
| **How** | How to use it (concise) | "Call `validateEmail(email)` returns boolean" |
| **Examples** | Concrete usage | `validateEmail("user@example.com") // true` |
| **Pitfalls** | Common mistakes | "Doesn't validate MX records, only format" |

## Writing Guidelines

### Assume Intelligent But Unfamiliar Readers

Readers are smart developers who don't know your codebase. They understand programming concepts but not your project's specifics.

```markdown
# Good - Assumes general knowledge
The BlockManager creates and deletes blocks using the `create()` method.

# Bad - Assumes internal knowledge
BM handles block lifecycle via the internal registry.
```

### Prioritize Visual Scannability

Readers skim documentation. Make structure visible:

```markdown
## Creating a Block

Call `createBlock()` with a type:

```typescript
const block = createBlock('paragraph');
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| type | string | Block type name |
| data | object | Optional initial data |

### Example

```typescript
const block = createBlock('header', { text: 'Hello' });
```
```

### Focus on What and How, Not Why or How-It-Works

```markdown
# Good - User-facing
Press `/` to open the command palette. Type a block name to insert it.

# Bad - Implementation detail
The slash handler dispatches a SHOW_PALETTE event, which renders
the toolbox component with filtered options based on keystrokes.
```

### Use Plain Language and Consistent Terminology

Pick a term and stick to it:

```markdown
# Bad - Inconsistent
The editor creates a new block. The block is added to the content.
Blocks can be removed. Deleting a block...

# Good - Consistent
The editor creates blocks. Blocks are added to content. Blocks can be deleted.
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| **Implementation details** | Focus on user outcomes, not code paths |
| **Missing examples** | Add one concrete example for each concept |
| **Wall of text** | Use headings, lists, and tables to break up content |
| **Assuming context** | Define terms on first use; link to related docs |
| **Over-explaining** | One good example > three mediocre ones |
| **No structure** | Always use headings for sections; tables for reference |

## Before and After

### Before (Too Technical)

```markdown
The Core class initializes all modules and wires up the EventsDispatcher.
Modules extend the Module base class and emit events through the dispatcher.
The BlockManager module handles block CRUD operations.
```

### After (User-Focused)

```markdown
## Block Management

Create, update, and delete blocks through the BlockManager:

```typescript
const block = blockManager.create('paragraph', { text: 'Hello' });
blockManager.update(block.id, { text: 'Updated' });
blockManager.delete(block.id);
```
```
