# User Resolver for Block Edit Attribution

**Date:** 2026-04-11
**Status:** Approved

## Problem

The current `user.name` config field stores a plain display name string directly on each block's `lastEditedBy` field. This is insufficient when multiple editors collaborate on a document — blocks edited by different users all store raw name strings, with no stable identity, no way to handle name changes, and no mechanism to resolve display info for users other than the current one.

## Design

### Config API

Replace `user?: { name: string }` with two new config fields:

```typescript
user?: {
  /** Stable unique identifier for the current editor */
  id: string;
};

/**
 * Resolves a user ID to display info. Called when Blok needs to
 * show who edited a block (e.g., block settings footer).
 * Return null/undefined for unknown users.
 */
resolveUser?: (id: string) => UserInfo | Promise<UserInfo | null> | null;
```

### New Type: UserInfo

```typescript
interface UserInfo {
  /** Display name — the only field Blok reads today */
  name: string;
  /** Host app can attach any additional fields */
  [key: string]: unknown;
}
```

### Behavior Matrix

| `user.id` | `resolveUser` | Block stores | Footer shows |
|-----------|---------------|-------------|--------------|
| Set | Set | ID | Resolved name + date |
| Set | Not set | ID | Date only |
| Not set | Set or not | Nothing | Date only (if `lastEditedAt` exists) |

### Resolver Contract

- Accepts sync or async return: `UserInfo | Promise<UserInfo | null> | null`
- Blok normalizes internally with `Promise.resolve()`
- Null/undefined return = unknown user, fall back to date-only display
- Host app is responsible for caching if needed
- May be called each time block settings open — expected to be cheap or cached by host

### Block Data Model

No structural changes:

- **Internal:** `lastEditedBy?: string | null` — semantics change from display name to user ID
- **Output:** `lastEditedBy?: string` — same field, value is now a user ID
- **`lastEditedAt?: number`** — unchanged

### Mutation Flow

In `BlockManager.notifyBlockChanged()`:

```typescript
// before
block.lastEditedBy = this.config.user?.name ?? null;

// after
block.lastEditedBy = this.config.user?.id ?? null;
```

### Display Flow (Block Settings Footer)

`BlockSettings.createEditMetadataFooter()`:

1. If `block.lastEditedBy` is set and `config.resolveUser` exists:
   - Call `Promise.resolve(config.resolveUser(block.lastEditedBy))`
   - Result has `name` → use `I18n.t('blockSettings.lastEditedBy', { name })`
   - Result is null/undefined → fall back to `I18n.t('blockSettings.lastEdited')`
2. Otherwise → `I18n.t('blockSettings.lastEdited')` (date only)

Footer renders date immediately, updates with name once the resolver promise settles.

### Unchanged Areas

- **Saver / Renderer** — no changes, `lastEditedBy` is still a string
- **Yjs sync** — no changes, same field name and type
- **I18n** — no changes, same two translation keys
- **Block class** — no structural changes

### Backwards Compatibility

The output format doesn't structurally change. Existing saved data with display name strings in `lastEditedBy` will fail to resolve through the resolver (the resolver won't recognize a display name as a valid ID), gracefully falling back to date-only display.

## Not In Scope

- Avatar rendering in the footer
- Full edit history (array of editors)
- Caching layer inside Blok
- `created_by` / `createdBy` tracking

## Test Plan

### Unit Tests

1. `user.id` is stored on blocks during mutation (not a display name)
2. `resolveUser` is called with the correct ID when block settings open
3. Sync resolver → footer shows resolved name + date
4. Async resolver → footer updates after promise resolves
5. Resolver returns null → footer shows date only
6. No resolver configured → footer shows date only
7. No user configured → no attribution
8. Resolver with extra fields → Blok only reads `name`, no errors

### E2E Tests

- Update `block-settings-edit-metadata.spec.ts` for new config shape

### Existing Tests to Update

- `test/unit/components/modules/toolbar/blockSettings.test.ts`
- `test/unit/types/block-edit-metadata.test.ts`
