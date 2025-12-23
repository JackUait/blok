# Hybrid Action-Change Grouping for Undo/Redo

## Problem

The current undo/redo system creates a checkpoint every time the action type changes (e.g., insert → delete). This results in overly granular undo entries when users make quick corrections like typing a few characters, then pressing backspace once or twice to fix a typo.

## Solution

Introduce a threshold-based checkpoint strategy: when action type changes, wait until the user performs **3 characters** of the new action type before creating a checkpoint at the switch point.

## Behavior

When the action type changes (insert ↔ delete-back ↔ delete-fwd):
1. Don't checkpoint immediately
2. Track how many characters of the new action type have occurred
3. Create checkpoint only when threshold (3) is reached
4. Checkpoint is placed at the switch point, splitting the two action types into separate entries

### Example

| Action | Buffer State | History Entries |
|--------|--------------|-----------------|
| Type "hello" | `hello` | (pending insert) |
| Backspace ×1 | `hell` | (pending: 1 delete) |
| Backspace ×2 | `hel` | (pending: 2 deletes) |
| Backspace ×3 | `he` | **Checkpoint!** Entry 1: "hello" |
| Backspace ×4 | `h` | (pending delete) |
| Type "i" | `hi` | (pending: 1 insert) |

**Undo sequence:** `hi` → `h` → `he` → `hello` → (empty)

## Implementation

### Changes to `src/components/modules/history.ts`

1. **Add constant:**
   ```typescript
   const ACTION_CHANGE_THRESHOLD = 3;
   ```

2. **Add state tracking:**
   ```typescript
   private pendingActionCount = 0;
   ```

3. **Modify `handleBlockMutation()`:**
   - When `currentActionType` changes from previous:
     - Increment `pendingActionCount`
     - If `pendingActionCount >= ACTION_CHANGE_THRESHOLD`:
       - Create checkpoint (record state before the pending actions)
       - Reset `pendingActionCount` to 0
       - Update `currentActionType`
     - Else:
       - Continue accumulating (no checkpoint yet)
   - When action type stays the same:
     - Reset `pendingActionCount` to 0 (threshold only applies to transitions)

4. **Reset on checkpoint:**
   - Any checkpoint (debounce expiry, immediate action, block change) resets `pendingActionCount` to 0

### What stays the same

- **200ms debounce** for continuous same-action typing
- **Immediate checkpoints** for `format`, `structural`, `paste`, `cut` actions
- **Block change** creates checkpoint
- **Caret position** stored on previous entry

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Type 2, delete 2, type 2, delete 2... | All grouped together (threshold never reached) |
| Type 10 chars, delete 3+ | Split: typing entry, then deletion entry |
| Type 2 chars, paste | Immediate checkpoint (paste is always immediate) |
| Type 2 chars, switch blocks | Checkpoint on block change (existing behavior) |
| Debounce expires with pending chars | Creates entry including pending chars |
| Type 2, delete 2, wait 200ms | Debounce creates entry with all 4 actions grouped |

### Immediate checkpoint actions (unchanged)

These actions always create an immediate checkpoint regardless of threshold:
- `format` (bold, italic, link, etc.)
- `structural` (Enter, block splits/merges)
- `paste`
- `cut`

## Testing

Add E2E tests covering:
1. Quick correction (type, delete <3, type) stays grouped
2. Intentional deletion (type, delete 3+) creates separate entries
3. Threshold resets after checkpoint
4. Immediate actions still checkpoint immediately
5. Debounce expiry with pending actions groups correctly
