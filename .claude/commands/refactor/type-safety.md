---
name: type-safety
description: Use when writing or modifying TypeScript code, when asked to fix types, or when adding functions to files with weak typing patterns. Focuses on compiler errors and critical weak patterns (any, @ts-ignore).
---

# TypeScript Type Safety

## Overview

**Fix ALL TypeScript errors in the specified files without introducing breaking changes to public APIs.**

This means:
- Compiler errors (TS2554, TS2345, TS2339, etc.) in target files
- Critical weak type patterns (`any` in new code, excessive `@ts-ignore`)
- Cascade errors ONLY in directly modified files

**CRITICAL: Preserve public API contracts.** Don't change exported function signatures, interface shapes, or type definitions in ways that break downstream consumers.

**CRITICAL: NEVER use grep filtering to check for errors.** Grep patterns are fragile and silently drop errors that don't match. Always run full `yarn lint:types` and `yarn lint` and parse the complete output.

**Pragmatic approach:** Focus on real type safety issues.

## Public API Preservation

**NEVER break public APIs when fixing types.** A type safety fix that breaks downstream code is worse than the original type error.

### What Counts as a Public API

**Public APIs include:**
- Exported function signatures
- Exported interface/type definitions
- Exported class declarations
- Component props (for libraries/frameworks)
- Return types of exported functions
- Parameter types of exported functions

**Internal code (safe to improve):**
- Private functions
- Internal helpers
- Implementation details within functions
- Local variable types
- Non-exported utilities

### Breaking vs. Non-Breaking Changes

**Breaking (DON'T DO):**
```typescript
// BEFORE - exported API
export function getUser(id: string): User | null

// AFTER - breaking change! Callers now must handle Promise
export function getUser(id: string): Promise<User | null>
```

**Non-Breaking (SAFE):**
```typescript
// BEFORE - internal implementation with weak types
function parseResponse(data: any): User {
    return { id: data.id, name: data.name };
}

// AFTER - proper types, no public API change
function parseResponse(data: unknown): User {
    if (!isValidUserData(data)) throw new ValidationError();
    return { id: data.id, name: data.name };
}
```

### Strategies for Public API Boundaries

**When encountering `any` at public API boundaries:**

1. **Document and defer (preferred for established APIs):**
```typescript
// TODO: Type safety - this accepts any for historical compatibility
// Consider adding a strongly-typed alternative in v2.0
export function legacyTransform(data: any): Result {
    // Implementation unchanged
}
```

2. **Add separate legacy function (gradual migration path):**
```typescript
// Internal implementation - single source of truth
function processUserImpl(user: User): ProcessedUser {
    return { id: user.id, name: user.name.toUpperCase() };
}

// New typed version
export function processUser(user: User): ProcessedUser {
    return processUserImpl(user);
}

// Legacy version for backward compatibility - can be deprecated later
export function processUserLegacy(data: unknown): ProcessedUser {
    if (isUser(data)) {
        return processUserImpl(data);
    }
    throw new TypeError('Invalid user data');
}
```

**Note:** TypeScript overloads don't exist at runtime. You cannot call an "overload" from within another overload - both signatures resolve to the same implementation function. Use a separate internal implementation function to avoid code duplication.

3. **Widen, don't narrow (for return types):**
```typescript
// If changing return type, make it broader, not stricter
// BEFORE: Exported returns SpecificType
// AFTER: Exported returns SpecificType | undefined is BREAKING
// INSTEAD: Keep original signature, fix internal implementation
```

### Cascade Rule Amendment (RESTRICTED)

**Rule:** "Fix cascades ONLY in files you directly modify. Don't chase errors into unrelated files."

- Modified file A, which breaks file B that imports from A? Fix file B.
- Modified file A, which breaks file C that imports from B? STOP - that's out of scope.
- User specified 3 files? Only work on those 3 files and their direct imports.

**Signal for stopping:**
```typescript
// If the cascade goes more than 2 levels deep from modified files,
// stop and report. The user can decide if broader changes are needed.
```

## Iteration Loop

**The skill runs in rounds until all errors are resolved or issues are proven impossible.**

```
ROUND 1 → ROUND 2 → ... → ROUND N → COMPLETE (or IMPOSSIBLE)
```

Each round executes Phases 1-4 (Scoring → Batching → Distribution → Verification). After verification, check termination conditions:

**Continue to next round if:**
- Errors remain AND progress was made AND no errors are stuck

**Stop with SUCCESS if:**
- Zero errors remain (both `lint:types` and `lint` pass)

**Stop with IMPOSSIBLE if:**
- Zero progress: Current round resolved 0 points
- Stuck errors: Same error signatures appear after 2 consecutive fix attempts

### State Tracking

Maintain across rounds:

```
round_number: 1, 2, 3, ...
points_per_round: [76, 23, 5, 0]  # Points at start of each round
error_history: {
  "src/foo.ts:42:TS2345": [1, 2],     # Appeared in rounds 1 and 2
  "src/bar.ts:17:TS2339": [2],         # Appeared only in round 2
}
```

**Error signature format:** `{file}:{line}:{error_code}` or `{file}:{line}:{eslint_rule}`

### Termination Logic (after each round's Phase 4)

```python
points_resolved = points_per_round[-2] - points_per_round[-1]  # Previous - current

if current_points == 0:
    STOP: SUCCESS

if points_resolved == 0:
    STOP: IMPOSSIBLE (no progress)

stuck_errors = [e for e in error_history if len(error_history[e]) >= 2]
if stuck_errors and all errors are in stuck_errors:
    STOP: IMPOSSIBLE (all remaining errors are stuck)

# Otherwise: continue to next round with remaining errors
```

## Argument Handling

**Parse $ARGUMENTS for file paths:**
- `/type-safety src/foo.ts src/bar.ts` - Fix specific files
- `/type-safety src/components/` - Expand directory to all `*.ts` and `*.tsx` files
- `/type-safety` (no args) - Prompt user for files or work on current file

**Expansion rules:**
- Split arguments by whitespace
- For directories, glob `**/*.ts` and `**/*.tsx`
- Validate each file exists before proceeding

## Red Flags - You're About to Miss Errors

**STOP and reconsider if you're thinking:**

- "Grep filtering is good enough" → NO: Use full output, grep drops errors
- "That file looks clean" → NO: Only lint:types output counts, visual inspection misses things
- "The subagent said it fixed the file" → NO: Verify with actual lint output, not trust
- "Most errors are fixed, that's good enough" → NO: Either ALL errors are fixed or continue to next round
- "This error is probably from another file" → NO: Check the file path in the error output
- "The grep pattern should match" → NO: Grep patterns are fragile, use full output
- "I'll catch remaining errors in the next run" → NO: That's exactly what we're trying to avoid
- "no-unsafe-assignment isn't a real type error" → NO: It IS a real type error, fix it
- "This is just test code, no-unsafe-* doesn't matter" → NO: Fix unsafe violations even in tests

**All of these mean: Re-read the full lint output and count EVERY error.**

## Phase 1: Scoring

**Step 1: Run compiler and ESLint checks (CAPTURE FULL OUTPUT)**
```bash
# TypeScript compiler errors - capture FULL output, NO grep filtering
yarn lint:types 2>&1

# ESLint TypeScript rules - capture FULL output, NO grep filtering
yarn lint 2>&1
```

**CRITICAL: Do NOT use grep filtering at this stage.** The full output is needed to:
- Catch all errors regardless of format
- Handle edge cases in error messages
- Ensure nothing is silently dropped

Parse output to count:
- Compiler errors per file (TS*)
- ESLint TypeScript errors per file (`@typescript-eslint/*`)

**Step 2: Scan files for weak patterns**

For each file, use grep to count occurrences (excluding lines that are comments):

```bash
# any types - matches ": any" or "<any>" or "as any"
grep -E ':\s*any\b|<any>|as\s+any\b' "$file" | grep -v '^\s*//' | wc -l
# Non-null assertions - matches identifier, ) or ] followed by ! then punctuation
# Note: ] must be first in BOTH character classes to be literal
# Pattern catches: obj!, func()!, arr[0]! followed by . , ; ) ] } = < etc.
grep -E '(\w|[])])!\s*[].,:;)}<>=]' "$file" | grep -v '^\s*//' | wc -l

# @ts-ignore and @ts-expect-error
grep -E '@ts-ignore|@ts-expect-error' "$file" | wc -l
```

**Note:** ESLint rules like `@typescript-eslint/no-non-null-assertion` catch non-null assertions that grep patterns may miss (e.g., complex expressions). Always verify with ESLint output.

**Step 3: Calculate scores**

Points per issue type:
- Compiler error (TS*): 3 points
- ESLint TypeScript error: 2 points (dedup with grep findings)
- `any` type: 2 points
- `as` assertion: 1 point
- Non-null assertion (x!): 1 point
- `@ts-ignore` or `@ts-expect-error`: 1 point

**Step 4: Display score table**

```
File                          | Compiler | ESLint | any | Assertions | Total
------------------------------|----------|--------|-----|------------|------
src/components/modal.tsx      |    6     |   2    |  4  |     2      |  32
src/utils/api.ts              |    0     |   3    |  8  |     3      |  25
src/hooks/useChannel.ts       |    3     |   0    |  1  |     0      |  11
src/actions/posts.ts          |    0     |   1    |  2  |     1      |   8
```

## Phase 2: Batching

**CRITICAL: You MUST ALWAYS spawn subagents. Never skip Phase 3 (Distribution). Even for a single file with 0 points, spawn exactly 1 subagent.**

**Step 1: Calculate agent count**
```
num_agents = max(1, ceil(total_points / 20))
```

The `max(1, ...)` ensures at least 1 agent is always spawned.

Example: 63 total points → `ceil(63/20)` = 4 agents
Example: 0 total points → `max(1, 0)` = 1 agent

**Step 2: Sort files by score (descending)**

Largest files first ensures heavy files get placed before bins fill up.

**Step 3: Bin-pack using first-fit decreasing**

```
target_per_agent = total_points / num_agents

For each file (largest first):
  - Find agent with lowest current load that won't exceed target by >50%
  - If none found, assign to agent with lowest current load
  - Add file to that agent's batch
```

**Edge cases (ALL cases still spawn subagents):**
- Single file → 1 subagent (still use Task tool)
- All files score 0 → 1 subagent handles all (verification pass via subagent)
- One file with 22+ points → Gets dedicated subagent

## Phase 3: Distribution

**THIS PHASE IS MANDATORY. You MUST use the Task tool to spawn subagents. Do NOT skip this phase or attempt to fix types directly yourself.**

**Step 1: Create TodoWrite for tracking**

One todo item per agent batch:
```
- [ ] Agent 1: modal.tsx (28 pts)
- [ ] Agent 2: api.ts (19 pts)
- [ ] Agent 3: useChannel.ts, posts.ts (16 pts)
```

**Step 2: Spawn subagents in parallel**

Use the Task tool to launch all subagents simultaneously. Each receives:
1. Its batch of files
2. The subagent instructions (see template below)
3. Current round number (for context in multi-round runs)

**Step 3: Wait for completion**

Block until all subagents finish. Mark todos complete as each agent reports back.

## Phase 4: Verification & Iteration Control

**Step 1: Collect subagent reports**

Each subagent reports:
- Files fixed
- Issues resolved by category
- Any cascade errors discovered in files outside their batch

**Step 2: Run verification**

```bash
# TypeScript compiler - capture ALL errors, not just target files
yarn lint:types 2>&1

# ESLint TypeScript rules
yarn lint 2>&1
```

**CRITICAL: Parse the full output to verify:**
1. For EACH file that was assigned to a subagent, check it appears ZERO times in the error output
2. If ANY assigned file still has errors, the subagent failed - add it to the next round
3. Do NOT accept "partial fixes" - either the file has zero errors or it needs more work

This catches:
- Cascade errors from type changes
- Issues subagents missed
- Cross-file breakages
- ESLint TypeScript violations (no-non-null-assertion, no-explicit-any, no-unsafe-assignment, no-unsafe-member-access, no-unsafe-call, etc.)
- Subagents that returned incomplete fixes

**Step 3: Update state and check termination**

```
1. Count current points (same scoring as Phase 1)
2. Record points_per_round.append(current_points)
3. Extract error signatures from output, update error_history
4. Check termination conditions:
```

**If current_points == 0:**
```
→ STOP: SUCCESS
→ Go to Step 5 (Final Report)
```

**If points_resolved == 0 (no progress this round):**
```
→ STOP: IMPOSSIBLE (no progress)
→ Go to Step 5 (Final Report with impossible errors)
```

**If all remaining errors are stuck (appeared in 2+ consecutive rounds):**
```
→ STOP: IMPOSSIBLE (stuck errors)
→ Go to Step 5 (Final Report with stuck error details)
```

**Otherwise:**
```
→ CONTINUE: Increment round_number
→ Go to Phase 1 with remaining errors as new target files
→ Include any NEW files discovered via cascade errors
```

**Step 4: Prepare next round (if continuing)**

- Collect all files with remaining errors (original + cascade)
- These become the input files for Phase 1 of the next round
- Subagents from previous round are done; new round spawns fresh subagents

**Step 5: Final Report**

**On SUCCESS:**
```
Type Safety Complete ✓

Rounds: 3
Round 1: 76 pts → 23 pts (53 resolved)
Round 2: 23 pts → 5 pts (18 resolved)
Round 3: 5 pts → 0 pts (5 resolved)

Total: 76 points resolved across 4 files
Final lint:types: PASS
Final lint: PASS
```

**On IMPOSSIBLE (no progress):**
```
Type Safety Incomplete - No Progress

Rounds: 2
Round 1: 76 pts → 12 pts (64 resolved)
Round 2: 12 pts → 12 pts (0 resolved) ← STOPPED

Remaining errors (12 pts) - require manual intervention:
  src/legacy/parser.ts:142 - TS2345: Argument of type 'unknown' is not assignable...
  src/legacy/parser.ts:156 - TS2339: Property 'data' does not exist on type 'never'
  src/legacy/types.d.ts:23 - TS2314: Generic type 'Response' requires 1 type argument

These errors could not be resolved automatically. Likely causes:
- Circular type dependencies
- Missing type definitions from external packages
- Fundamental type design issues requiring architectural changes
```

**On IMPOSSIBLE (stuck errors):**
```
Type Safety Incomplete - Stuck Errors

Rounds: 3
Round 1: 76 pts → 23 pts (53 resolved)
Round 2: 23 pts → 8 pts (15 resolved)
Round 3: 8 pts → 8 pts (0 resolved) ← same errors persist

Stuck errors (attempted 2+ times without resolution):
  src/api/client.ts:89 - TS2345 [rounds 2, 3]
  src/api/client.ts:102 - TS2322 [rounds 2, 3]

These specific errors were attempted multiple times but could not be fixed.
Manual investigation required.
```

## Subagent Instructions Template

When spawning subagents via Task tool, provide these instructions:

```
Fix all type safety issues in these files:
{file_list}

Scores (for context):
{score_breakdown}

## Process

1. Run FULL checks WITHOUT grep filtering - capture all errors:
   yarn lint:types 2>&1
   yarn lint 2>&1

2. From the output, extract ONLY errors related to your files:
   - Match file paths exactly (e.g., "src/components/Modal.tsx")
   - Capture the full error message and line number
   - Create a TodoWrite checklist of ALL errors found

3. Scan each file for critical weak patterns (any, @ts-ignore, ! assertions)

4. Fix issues pragmatically:
   - Compiler errors MUST be fixed
   - `any` types MUST be replaced
   - `@ts-ignore` SHOULD be removed if the underlying error is fixable or replace with `@ts-expect-error` with description if the error it's not fixable
   - `@typescript-eslint/no-unsafe-*` violations MUST be fixed (no-unsafe-assignment, no-unsafe-member-access, no-unsafe-call, no-unsafe-return, no-unsafe-argument)

5. After fixing, run FULL verification again:
   yarn lint:types 2>&1
   yarn lint 2>&1

6. Verify that NONE of your assigned files appear in the error output. If any do, return to step 2.

7. Report:
   - Files fixed
   - Issues resolved (compiler errors, ESLint errors, weak patterns)
   - Any cascade errors discovered in OTHER files (main agent handles these)
   - Issues left unfixed with justification

## Core Rules

**Forbidden - fix the underlying issue instead:**
- any types: Use specific type, generic, or unknown with narrowing
- as Type assertions: Use type guards, discriminated unions, or proper inference
- Non-null assertions: Use null checks, optional chaining, or early returns
- @ts-ignore / @ts-expect-error: Fix the actual type error

**CRITICAL: Public API Preservation**
DON'T change exported function signatures, interfaces, or types that have multiple callers.
- Check if the function/type is exported
- Check if it has multiple callers
- If both true: STOP and report to main agent - this is a breaking change

**Cascade Rule (RESTRICTED):**
Only fix cascade errors in direct imports of modified files. Don't chase errors beyond level 3.

**ZERO TOLERANCE FOR ERRORS IN YOUR FILES:**
If after your fixes, ANY error appears in lint:types or lint output for a file you were assigned, you are NOT done.
Do NOT return with "partial fixes" - either fix the error or explain why it's impossible.
```

## Core Rules

### What Counts as a Type Error

**ALL of these are type errors you MUST fix:**

| Error Code | Description | Example |
|------------|-------------|---------|
| TS2554 | Wrong number of arguments | `foo()` when `foo(x: string)` expected |
| TS2345 | Type not assignable to parameter | `foo(123)` when `foo(x: string)` expected |
| TS2339 | Property doesn't exist on type | `obj.nope` when `nope` isn't in the type |
| TS2741 | Missing required property | `{a: 1}` when `{a: number, b: string}` expected |
| TS2322 | Type not assignable to variable | `const x: string = 123` |
| TS2532 | Object possibly undefined | `obj.prop` when `obj` might be undefined |
| TS2531 | Object possibly null | `obj.prop` when `obj` might be null |
| TS7006 | Parameter implicitly has 'any' type | `function foo(x) {}` |
| **Any TS error** | **If `lint:types` reports it, fix it** | **No exceptions** |
| `@typescript-eslint/no-unsafe-assignment` | Unsafe assignment of an `any` value | `const x: string = anyValue` |
| `@typescript-eslint/no-unsafe-member-access` | Unsafe access of property on `any` | `anyValue.property` |
| `@typescript-eslint/no-unsafe-call` | Unsafe call of function typed as `any` | `anyValue()` |
| `@typescript-eslint/no-unsafe-return` | Unsafe return of `any` from typed function | `return anyValue` |
| `@typescript-eslint/no-unsafe-argument` | Unsafe pass of `any` as typed argument | `foo(anyValue)` |

**Note:** If `lint:types` reports a compiler error, fix it. These are genuine type issues.

### Cascade Rule: Fix What You Break (RESTRICTED)

**If your changes break other files, fix those files ONLY if they directly import from a modified file.**

Example: You change a **private/internal** function signature from `parseUser(id: string)` to `parseUser(id: string, includeMetadata: boolean)`. This breaks 12 callers across 8 files.

**WRONG:** "I fixed the function, the callers are a separate issue"
**CORRECT:** Fix all 12 callers. You broke them, you fix them.

**BUT** if `src/services/userService.ts` breaks `src/components/UserProfile.tsx` which breaks `src/components/Avatar.tsx`:

- Fix `src/components/Avatar.tsx`? **No**, that's 3 levels deep. Stop and report.

**Public API exception:** If the function is exported and has multiple callers, ask user first.

For subagents: If cascade errors are in files outside your batch, report them. The main agent will handle them in a follow-up round.

### Forbidden Constructs

**Fix or justify:**
- **`any`** → Use specific type, generic `<T>`, or `unknown` with narrowing
- **@ts-ignore / @ts-expect-error** → Fix the actual error or document why it's necessary
- **Non-null assertion (x!)** → Use null checks, optional chaining, or early returns
- **Unsafe assignment/call/member-access** → Fix the underlying type issue that makes ESLint flag this

**Unsafe ESLint violations that MUST be fixed:**
- `@typescript-eslint/no-unsafe-assignment` → Type the source correctly or use proper narrowing
- `@typescript-eslint/no-unsafe-member-access` → Type the object or use type guards
- `@typescript-eslint/no-unsafe-call` → Type the function or validate before calling
- `@typescript-eslint/no-unsafe-return` → Ensure return type matches or use proper typing
- `@typescript-eslint/no-unsafe-argument` → Type the argument or fix the parameter type

**Generally acceptable:**
- **`as Type`** → OK for narrowing after validation, or working with untyped external APIs

### The Consistency Trap (PRAGMATIC)

```
RED FLAG: "I should match the existing pattern"
```

When you see code like this:
```typescript
// Existing file with 50+ functions like:
export function parseUserData(response: any): any { ... }
export function parseChannelData(response: any): any { ... }
```

**Context matters:**
- Adding a NEW function to a legacy module? Use proper types for your addition.
- Refactoring the entire module? Consider gradual improvement.
- Just fixing a bug? Don't introduce new `any`, but also don't rewrite everything.

```typescript
// Your new function - properly typed
interface Post {
    id: string;
    message: string;
    userId: string;
    createAt: number;
}

export function parsePostData(response: unknown): Post {
    // Validate and narrow the type
    if (!isPost(response)) {
        throw new Error('Invalid post data');
    }
    return {
        id: response.id,
        message: response.message,
        userId: response.user_id,
        createAt: response.create_at,
    };
}
```

### Generic Functions and `as T`

Using `as T` inside generic functions bypasses type safety. Consider the context:

```typescript
// WRONG - hides the lie inside the function
async function fetchData<T>(endpoint: string): Promise<T> {
    const response = await fetch(`/api/${endpoint}`);
    return response.json() as T;  // Still lying to TypeScript
}
```

**Better approaches when practical:**

1. **Runtime validation (safest):**
```typescript
import {z} from 'zod';

async function fetchData<T>(endpoint: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetch(`/api/${endpoint}`);
    const data = await response.json();
    return schema.parse(data);
}
```

2. **Explicit unknown with caller narrowing:**
```typescript
async function fetchData(endpoint: string): Promise<unknown> {
    const response = await fetch(`/api/${endpoint}`);
    return response.json();
}

// Caller validates
const data = await fetchData('users');
if (isUserArray(data)) {
    // Now properly narrowed
}
```

3. **Endpoint-specific functions with `as` (acceptable):**
```typescript
async function fetchUsers(): Promise<User[]> {
    const response = await fetch('/api/users');
    return response.json() as User[];  // Acceptable for known APIs
}
```

Use judgment based on your project's needs. Strict validation isn't always necessary.

## Fixing Existing Types

When asked to fix types or when you encounter weak types in code you're modifying:

### Step 1: Define the Shape
```typescript
interface ApiResponse {
    items: Item[];
}

interface Item {
    id: string;
    name: string;
    metadata: Record<string, unknown> | null;
}
```

### Step 2: Replace `any` Parameters
```typescript
// Before
function process(data: any, options: any): any

// After
function process(data: ApiResponse, options: ProcessOptions): ProcessedItem[]
```

### Step 3: Remove Inline `any` Casts
```typescript
// Before
data.items.map((item: any) => ...)

// After - type flows from parameter
data.items.map((item) => ...)  // item is Item
```

### Step 4: Handle Nullable Values
```typescript
// Before
const width = container!.offsetWidth;

// After
if (!container) return;
const width = container.offsetWidth;  // Type narrowed
```

## Guidance - When to Be Pragmatic

Type safety is important, but pragmatism matters too. Use judgment based on context.

### Compiler Errors

These MUST be fixed:
- TS errors in files you're actively modifying
- Errors that break the build

Use discretion for:
- Errors in legacy/tolerance zones (test files, deprecated code)
- Errors that would require extensive refactoring for minimal gain

### Weak Type Patterns

Prefer strong types, but be pragmatic:

| Situation | Guidance |
|-----------|----------|
| New code you're writing | Use proper types |
| Bug fix in existing function | Fix the bug, don't introduce new `any` |
| Working with untyped external APIs | Use `as` assertions only at the API boundary, then type properly |
| Test files | `any` is acceptable only for test setup/fixtures, NOT for code under test |
| Legacy integration layers | Document and add strict types at the boundary |

**CRITICAL:** ESLint `no-unsafe-*` violations (no-unsafe-assignment, no-unsafe-member-access, no-unsafe-call, etc.) MUST be fixed even in test code. These indicate actual type unsafety that can hide bugs.

### Cascade Errors

Fix cascade errors in:
- Direct imports of modified files (2 levels)

Skip cascade errors in:
- Files beyond 2 levels of import depth
- Unrelated modules

### Public API Changes

Always ask user before changing:
- Exported function signatures with multiple callers
- Interface definitions used across modules

### Iteration Limits

Maximum 5 rounds. If errors remain after 5 rounds, report and stop.

## Quick Reference

```typescript
// Handling unknown API responses
const data: unknown = await response.json();
if (isValidResponse(data)) { /* narrowed */ }

// Nullable refs
if (!ref.current) return;
// ref.current is now non-null

// Optional properties
const value = obj.prop ?? defaultValue;

// Type guards
function isUser(x: unknown): x is User {
    return typeof x === 'object' && x !== null && 'id' in x && 'name' in x;
}

// Discriminated unions
type Result = { success: true; data: Data } | { success: false; error: Error };
if (result.success) { /* result.data available */ }
```
