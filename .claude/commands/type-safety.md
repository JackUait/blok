---
name: type-safety
description: Use when writing or modifying TypeScript code, when seeing any/as/! in code, when asked to fix types, or when adding functions to files with weak typing patterns
---

# TypeScript Type Safety

## Overview

**Fix ALL TypeScript errors. No exceptions. No partial fixes.**

This means:
- Every compiler error (TS2554, TS2345, TS2339, etc.)
- Every weak type pattern (`any`, `as`, non-null assertion, `@ts-ignore`)
- Every file your changes break

The "consistency" argument is a trap. Bad patterns don't become acceptable because they're widespread.

## Iteration Loop

**The skill runs in rounds until all errors are resolved or issues are proven impossible.**

```
ROUND 1 → ROUND 2 → ... → ROUND N → COMPLETE (or IMPOSSIBLE)
```

Each round executes Phases 1-4 (Scoring → Batching → Distribution → Verification). After verification, check termination conditions:

**Continue to next round if:**
- Errors remain AND progress was made AND no errors are stuck

**Stop with SUCCESS if:**
- Zero errors remain (both `check-types` and `check:eslint` pass)

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

## Phase 1: Scoring

**Step 1: Run compiler and ESLint checks**
```bash
# TypeScript compiler errors
$HOME/.bun/bin/bun run check-types 2>&1

# ESLint TypeScript rules (catches issues grep may miss)
$HOME/.bun/bin/bun run check:eslint -- --format compact 2>&1
```

Parse output to count:
- Compiler errors per file (TS*)
- ESLint TypeScript errors per file (`@typescript-eslint/*`)

**Step 2: Scan files for weak patterns**

For each file, use grep to count occurrences (excluding lines that are comments):

```bash
# any types - matches ": any" or "<any>" or "as any"
grep -E ':\s*any\b|<any>|as\s+any\b' "$file" | grep -v '^\s*//' | wc -l

# as Type assertions - matches "as SomeType" (but not "as any" which is counted above)
grep -E '\bas\s+[A-Z][a-zA-Z0-9]*' "$file" | grep -v '^\s*//' | grep -v 'as\s+any' | wc -l

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
num_agents = max(1, ceil(total_points / 10))
```

The `max(1, ...)` ensures at least 1 agent is always spawned.

Example: 63 total points → `ceil(63/10)` = 7 agents
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
- One file with 10+ points → Gets dedicated subagent

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
$HOME/.bun/bin/bun run check-types 2>&1

# ESLint TypeScript rules
$HOME/.bun/bin/bun run check:eslint -- --format compact 2>&1
```

This catches:
- Cascade errors from type changes
- Issues subagents missed
- Cross-file breakages
- ESLint TypeScript violations (no-non-null-assertion, no-explicit-any, etc.)

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
Final check-types: PASS
Final check:eslint: PASS
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

1. For each file, run BOTH checks:
   $HOME/.bun/bin/bun run check-types 2>&1 | grep -E "{file_pattern}"
   $HOME/.bun/bin/bun run check:eslint {file_path} -- --format compact

   ESLint catches TypeScript issues that the compiler doesn't enforce:
   - @typescript-eslint/no-non-null-assertion (all ! assertions)
   - @typescript-eslint/no-explicit-any (all any types)
   - @typescript-eslint/consistent-type-assertions (as casts)
   - @typescript-eslint/ban-ts-comment (@ts-ignore, @ts-expect-error)

2. Scan each file for weak patterns (any, as, !, @ts-ignore)

3. Create TodoWrite checklist with ALL issues across your files

4. Fix every issue - no exceptions, no partial fixes

5. After fixing all files, verify BOTH checks pass:
   $HOME/.bun/bin/bun run check-types 2>&1 | grep -E "{file_pattern}"
   $HOME/.bun/bin/bun run check:eslint {file_path} -- --format compact

6. Report:
   - Files fixed
   - Issues resolved (compiler errors, ESLint errors, weak patterns)
   - Any cascade errors discovered in OTHER files (main agent handles these)

## Core Rules

**Forbidden - fix the underlying issue instead:**
- any types: Use specific type, generic, or unknown with narrowing
- as Type assertions: Use type guards, discriminated unions, or proper inference
- Non-null assertions: Use null checks, optional chaining, or early returns
- @ts-ignore / @ts-expect-error: Fix the actual type error

**Cascade Rule:**
If your fix breaks other files outside your batch, note them in your report but don't fix them. The main agent will handle cascades.

**No partial fixes:**
Fix ALL issues in your files. Don't skip any.
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
| **Any TS error** | **If `check-types` reports it, fix it** | **No exceptions** |

### Cascade Rule: Fix What You Break

**If your changes break other files, those must be fixed too.**

Example: You change a function signature from `getUser(id: string)` to `getUser(id: string, includeMetadata: boolean)`. This breaks 12 callers across 8 files.

**WRONG:** "I fixed the function, the callers are a separate issue"
**CORRECT:** Fix all 12 callers. You broke them, you fix them.

For subagents: If cascade errors are in files outside your batch, report them. The main agent will handle them in a follow-up round.

### Forbidden Constructs

**NEVER use these - fix the underlying type issue instead:**

- **`any`** → Use specific type, generic `<T>`, or `unknown` with narrowing
- **`as Type`** → Use type guards, discriminated unions, or proper inference
- **Non-null assertion (x!)** → Use null checks, optional chaining, or early returns
- **@ts-ignore / @ts-expect-error** → Fix the actual type error

### The Consistency Trap

```
RED FLAG: "I should match the existing pattern"
```

When you see code like this:
```typescript
// Existing file with 50+ functions like:
export function parseUserData(response: any): any { ... }
export function parseChannelData(response: any): any { ... }
```

**WRONG response:** Add your function with `any` to "match the pattern"

**CORRECT response:** Add your function with proper types. Every function you write has proper types, period.

```typescript
// Your new function - properly typed regardless of neighbors
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

Using `as T` inside generic functions is still a type assertion lie:

```typescript
// WRONG - hides the lie inside the function
async function fetchData<T>(endpoint: string): Promise<T> {
    const response = await fetch(`/api/${endpoint}`);
    return response.json() as T;  // Still lying to TypeScript
}
```

**CORRECT approaches:**

1. **Runtime validation (safest):**
```typescript
import {z} from 'zod';

async function fetchData<T>(endpoint: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetch(`/api/${endpoint}`);
    const data = await response.json();
    return schema.parse(data);  // Runtime validation
}
```

2. **Explicit unknown with caller narrowing:**
```typescript
async function fetchData(endpoint: string): Promise<unknown> {
    const response = await fetch(`/api/${endpoint}`);
    return response.json();
}

// Caller is responsible for validation
const data = await fetchData('users');
if (isUserArray(data)) {
    // Now properly narrowed
}
```

3. **Type-specific functions (when validation overhead matters):**
```typescript
async function fetchUsers(): Promise<User[]> {
    const response = await fetch('/api/users');
    return response.json() as User[];  // Acceptable ONLY with comment:
    // API contract guarantees User[] shape - see /api/users endpoint spec
}
```

Option 3 is acceptable ONLY when:
- The function is endpoint-specific (not generic)
- There's a documented API contract
- You add a comment explaining why the assertion is safe

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

## Red Flags - Stop and Reconsider

If you're thinking any of these, STOP:

### Skipping Compiler Errors

| Thought | Reality |
|---------|---------|
| "This is a logic error, not a type error" | If `check-types` reports it, it's a type error. Fix it. |
| "Wrong arguments isn't really a type issue" | TS2554 is literally a type error. Fix it. |
| "The types are fine, just incompatible" | Incompatible types IS TS2345. Fix it. |
| "That error is in a different file" | Your change broke it. Fix it. |
| "Fixing callers is out of scope" | You broke them. They're in scope now. |
| "I'll just fix the ones in this file" | Run full `check-types`. Fix ALL errors. |
| "The other errors existed before" | If they show in `check-types`, fix them. |
| "That's too many files to change" | Then change them all. That's the job. |

### Weak Type Patterns

| Thought | Reality |
|---------|---------|
| "Just this once won't hurt" | Every `any` spreads. Stop it here. |
| "I'll fix it later" | You won't. Fix it now. |
| "The existing code uses any" | Your code doesn't. |
| "It's just internal code" | Internal code has the most maintenance burden. |
| "Runtime validation is overkill" | Then use proper types with explicit unknown. |
| "The generic with as T is isolated" | The lie still propagates to every caller. |
| "Adding types will take too long" | Taking shortcuts creates tech debt that takes longer. |
| "The user said no refactor" | Adding types to one function isn't a refactor. |
| "The bug fix is unrelated to types" | You're touching the function. Type it. |

### Partial Fixes

| Thought | Reality |
|---------|---------|
| "I fixed the main ones, that's enough" | Fix ALL of them. No partial fixes. |
| "The file has too many to fix" | Then fix them all. That's the job. |
| "I'll skip verification this time" | Verification is mandatory. Run it. |
| "check-types passed on this file" | Run it on the whole project. Fix all errors. |
| "Those errors are unrelated to my changes" | They're in `check-types` output. Fix them. |

### Skipping Subagent Deployment

| Thought | Reality |
|---------|---------|
| "It's just one file, I'll fix it directly" | Spawn a subagent. That's the process. |
| "The score is 0, no subagent needed" | Spawn a subagent anyway. Verification matters. |
| "Spawning an agent is overkill here" | The Task tool is mandatory. Use it. |
| "I can do this faster myself" | Subagents are the process. Follow it. |
| "This is a simple fix" | Simple fixes still go through subagents. |

### Stopping Too Early

| Thought | Reality |
|---------|---------|
| "One round should be enough" | Keep iterating until zero errors or impossible. |
| "The remaining errors are minor" | Zero errors means zero. Keep going. |
| "These cascade errors aren't my problem" | They appeared from your fixes. Fix them. |
| "I've done 3 rounds, that's plenty" | There's no round limit. Only zero errors or impossible. |
| "These errors look hard, probably impossible" | Try at least 2 rounds before declaring impossible. |

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
