# Recursive Popover Search

**Date:** 2026-03-16
**Status:** Approved

## Problem

`PopoverDesktop` search only covers top-level items. Nested children (e.g., "Convert to" submenu items in block settings) are invisible to search. Users cannot find conversion targets or other nested items by typing.

There are two search entry points:
1. **`SearchInput`** — used when `params.searchable` is true (e.g., block settings tunes menu). Scores items internally and emits results to `onSearch`.
2. **`filterItems()`** — used by the Toolbox for slash-command search. Scores items and calls `onSearch`.

Both paths must support recursive search.

## Solution: Virtual Promotion

Make `PopoverDesktop` recursively search nested children via both search paths. Matching child items are temporarily "promoted" to the top level with a group label separator showing the parent chain. This is a generic popover-level solution — any popover with nested children benefits automatically.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Scope | Generic in `PopoverDesktop` — benefits all popovers |
| Surfacing | Promote matching children to top level with group label |
| Deduplication | Both top-level and child matches appear (no dedup) |
| Scoring | Unified — children interleaved with top-level items by score |
| Recursion depth | Fully recursive to arbitrary depth |
| Display order | Top-level items first, then promoted groups ordered by best score in group |

## Algorithm

### 1. Promoted Item Cache

Child items are built **once** on first non-empty search and cached until the popover is hidden or destroyed. This avoids rebuilding DOM elements on every keystroke.

```
// New state on PopoverDesktop:
private promotedItemCache: {
  items: PopoverItemDefault[];      // built from children params
  parentChains: Map<PopoverItemDefault, string[]>;  // item → parent chain
} | null = null;

private promotedSeparators: HTMLElement[] = [];
```

**Cache lifecycle:**
- **Created** on first call to `filterItems(query)` or `onSearch` with non-empty query (if cache is null)
- **Reused** on subsequent keystrokes — only scoring/filtering changes, not item construction
- **Destroyed** on `filterItems('')`, `hide()`, or `destroy()` — all promoted items' DOM elements are removed and instances destroyed

### 2. Building the Cache

Recursively walk the item tree using the existing `buildItems()` method:

```
buildPromotedItemCache():
  cache = { items: [], parentChains: new Map() }

  collectChildren(items, parentChain):
    for each item in items:
      if item is not PopoverItemDefault: continue
      if not item.hasChildren: continue

      label = item.title ?? item.name ?? ''
      newChain = [...parentChain, label]

      // Build real PopoverItemDefault instances from children params
      // Use default render params (not parent popover's) for correct styling
      childInstances = buildItems(item.children)

      for each child in childInstances:
        if child is PopoverItemDefault:
          // Skip permanently hidden items
          if child.name and isNamePermanentlyHidden(child.name): continue
          cache.items.push(child)
          cache.parentChains.set(child, newChain)

          // Recurse into child's own children (arbitrary depth)
          if child.hasChildren:
            collectChildren([child], newChain)

  collectChildren(this.items, [])
  return cache
```

**Render params for promoted items:** Promoted items must use **default render params** (empty `{}`), not the parent popover's `itemsRenderParams`. This prevents incorrect styling (e.g., inline toolbar params leaking to promoted block settings children). Since `buildItems()` reads `this.itemsRenderParams`, the implementation should construct promoted `PopoverItemDefault` instances directly rather than going through `buildItems()`:

```
// Instead of this.buildItems(item.children), construct directly:
for each childParam in item.children:
  if childParam.type is Default or undefined:
    new PopoverItemDefault(childParam)  // no render params = default styling
```

**`buildItems()` accessibility:** Not needed for promoted items (constructed directly). Remains `protected` on `PopoverAbstract` for other uses.

### 3. Dual-Path Search Integration

**Path A — `filterItems()` (slash search):**

```
filterItems(query):
  if query is '':
    cleanupPromotedItems()
    // existing: pass all items to onSearch
    return

  // Build cache if needed
  if promotedItemCache is null:
    promotedItemCache = buildPromotedItemCache()

  // Score top-level items (existing logic)
  topLevelScored = this.itemsDefault
    .map(item => ({ item, score: scoreSearchMatch(item, query) }))
    .filter(score > 0)
    .sort by score desc

  // Score promoted items from cache
  promotedScored = promotedItemCache.items
    .map(item => ({ item, score: scoreSearchMatch(item, query), chain: parentChains.get(item) }))
    .filter(score > 0)
    .sort by score desc

  // Pass both to onSearch
  onSearch({ query, topLevelItems: topLevelScored, promotedItems: promotedScored })
```

**Path B — `SearchInput` (searchable popover):**

Modify the `addSearch()` method to intercept `SearchInputEvent.Search` and augment results with promoted items before passing to `onSearch`:

```
addSearch():
  // existing SearchInput creation...

  this.search.on(SearchInputEvent.Search, (data) => {
    // Build cache if needed
    if data.query !== '' and promotedItemCache is null:
      promotedItemCache = buildPromotedItemCache()

    if data.query === '':
      cleanupPromotedItems()
      onSearch({ query, topLevelItems: data.items, promotedItems: [] })
      return

    // Score promoted items against the query
    promotedScored = promotedItemCache.items
      .map(item => ({ item, score: scoreSearchMatch(item, query), chain }))
      .filter(score > 0)
      .sort by score desc

    onSearch({ query, topLevelItems: data.items, promotedItems: promotedScored })
  })
```

### 4. DOM Rendering (`onSearch`)

The `onSearch` handler signature changes to accept both top-level and promoted results:

```
onSearch({ query, topLevelItems, promotedItems }):
  isEmptyQuery = query === ''
  isNothingFound = topLevelItems.length === 0 and promotedItems.length === 0

  // 1. Handle top-level items (existing logic — hide/show/reorder)
  //    ... existing hide non-matches, reorder by rank ...

  // 2. Detach previous separators and promoted item elements from DOM
  //    (don't destroy cache — just move elements out so they can be re-appended)
  for each separator in promotedSeparators: separator.remove()
  promotedSeparators = []
  for each item in promotedItemCache.items: item.getElement()?.remove()

  // 3. If there are promoted matches, render them
  if promotedItems.length > 0:
    // Group by parentChain string
    groups = groupBy(promotedItems, item => chain.join(' › '))

    // Order groups by best score within each group
    sortedGroups = groups.sort by max score in group desc

    for each [label, groupItems] in sortedGroups:
      separator = createGroupSeparator(label)
      promotedSeparators.push(separator)
      nodes.items.appendChild(separator)

      for each { item } in groupItems (sorted by score desc):
        el = item.getElement()
        if el: nodes.items.appendChild(el)

  // 4. "Nothing found" — shown only when BOTH top-level and promoted are empty
  toggleNothingFoundMessage(isNothingFound)

  // 5. Update flipper with all visible elements in display order
  flippableElements = [
    ...topLevelMatchElements,
    ...visiblePromotedItemElements,
  ]
  flipper.deactivate()
  flipper.activate(flippableElements)
  if flippableElements.length > 0:
    flipper.focusItem(0, { skipNextTab: true })
```

### 5. Group Separator

A lightweight DOM element distinct from `PopoverItemSeparator`:

```html
<div data-blok-promoted-group-label
     role="separator"
     class="px-3 pt-2.5 pb-1 text-[11px] font-medium uppercase
            tracking-wide text-gray-text/50 cursor-default">
  Convert to
</div>
```

- `role="separator"` for screen reader accessibility
- `data-blok-promoted-group-label` as boolean marker (label text in `textContent` only)
- For deeper nesting, label shows the chain: `Parent › Child group`
- If a parent has no title and no name, its group is labeled with an empty string (separator still shown for visual grouping)

Visual example:

```
+-----------------------+
| search: head          |
| --------------------- |
|  Heading              |  <- top-level match (score 90)
|  Header               |  <- top-level match (score 75)
|                       |
|  CONVERT TO           |  <- group separator
|  Heading 1            |  <- promoted child (score 90)
|  Heading 2            |  <- promoted child (score 85)
|  Heading 3            |  <- promoted child (score 80)
+-----------------------+
```

### 6. Cleanup

```
cleanupPromotedItems():
  // Remove group separator elements from DOM
  for each separator in promotedSeparators:
    separator.remove()
  promotedSeparators = []

  // Remove promoted item DOM elements and destroy instances
  if promotedItemCache is not null:
    for each item in promotedItemCache.items:
      item.getElement()?.remove()   // explicit DOM removal (destroy() doesn't do this)
      item.destroy()                // free listeners/tooltips
    promotedItemCache = null
```

**Cleanup triggers:**
- `filterItems('')` — query cleared
- `hide()` — popover closes (call `cleanupPromotedItems()` before `super.hide()`)
- `destroy()` — popover torn down (call `cleanupPromotedItems()` before `super.destroy()`)

**Idempotency:** `cleanupPromotedItems()` must be idempotent (no-op when cache is already null). When a searchable popover hides, cleanup may fire twice: once from `SearchInput.clear()` emitting an empty-query event via `applySearch('')`, and once from the explicit `hide()` call. The null-check on `promotedItemCache` handles this naturally.

**`originalItemOrder` interaction:** The existing `originalItemOrder` cache (used to restore DOM order on query clear) must be captured *before* any promoted items are appended to `nodes.items`. Since `originalItemOrder` is set in `reorderItemsByRank()` on first non-empty search, and promoted items are appended *after* top-level reordering in `onSearch`, the ordering is correct: original children are captured first, promoted items are never included in the snapshot.

### 7. Click Handling

Override `getTargetItem()` in `PopoverDesktop` to also search promoted items:

```ts
protected override getTargetItem(event: Event): PopoverItemDefault | PopoverItemHtml | undefined {
  const allItems = this.promotedItemCache !== null
    ? [...this.items, ...this.promotedItemCache.items]
    : this.items;

  return allItems
    .filter(item => item instanceof PopoverItemDefault || item instanceof PopoverItemHtml)
    .find(item => {
      const itemEl = item.getElement();
      return itemEl !== null && event.composedPath().includes(itemEl);
    });
}
```

**Promoted items with their own children:** If a promoted child item itself has `hasChildren`, clicking it would trigger `showNestedItems()`. This is valid — the nested popover opens normally using the promoted item's `children` params. The promoted item functions as a regular item in the flat list, the only difference is how it got there.

### 8. Flipper (Keyboard Navigation)

After rendering, flipper is updated with all visible elements in DOM order:

```
flippableElements = [...topLevelMatchElements, ...promotedItemElements]
flipper.deactivate()
flipper.activate(flippableElements)
flipper.focusItem(0, { skipNextTab: true })
```

## Edge Cases

| Case | Handling |
|------|----------|
| Parent item also matches query | Appears as top-level result (with chevron). Children appear separately in promoted group below. |
| Permanently hidden items | Skipped during cache construction via `isNamePermanentlyHidden()` check |
| Empty children array | Skipped — items with `hasChildren === false` are not recursed into |
| `PopoverItemHtml` with children | Parent has no title for scoring (never matches). Children walked recursively. Group label uses parent's `name` or empty string. |
| Mobile popover | `PopoverMobile` uses base no-op `filterItems()`. Unaffected. |
| Nested popover `searchable: true` | Independent feature. Recursive search works on static `children` params from the parent's item tree. |
| Lazily populated children | Not searched — we access `item.children` which returns static `PopoverItemParams[]` from construction time. |
| Promoted item with own children | Works normally — clicking opens nested popover via existing `showNestedItems()`. |
| Rapid keystrokes | Cache is built once; only scoring runs per keystroke. No DOM element churn. |
| "Nothing found" message | Shown only when both top-level AND promoted results are empty. |
| Parent with no title and no name | Group separator is still rendered with empty label text. |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/utils/popover/popover-desktop.ts` | Core: cache management, recursive collection, `onSearch` with promoted rendering, cleanup in `hide`/`destroy`, override `getTargetItem`, modify `addSearch` to intercept SearchInput events |
| `src/components/constants/data-attributes.ts` | Add `promotedGroupLabel` boolean data attribute |

**No changes to:**

- `popover-abstract.ts` — `buildItems()` is already protected and accessible
- Type definitions — no new public types
- Toolbox, BlockSettings, InlineToolbar — popover handles everything
- Search scoring algorithm — reused as-is
- PopoverItem / PopoverItemDefault — unchanged
- PopoverMobile — unaffected
- SearchInput — unchanged (PopoverDesktop intercepts its events)

## New Tests

`test/unit/components/utils/popover/recursive-search.test.ts`:

- Collects items from nested children into cache
- Scores and sorts unified results across top-level and promoted
- Creates group separators with correct labels
- Handles multi-level nesting (parent chain with `›`)
- Skips permanently hidden items during cache construction
- Promoted items with own children can open nested popovers
- Cleans up promoted items on query clear
- Cleans up promoted items on hide/destroy
- Click delegation works for promoted items
- Flipper includes promoted items in correct order
- Empty children are skipped
- Parent items that match appear alongside promoted children
- "Nothing found" only when both top-level and promoted are empty
- Cache is reused across keystrokes (not rebuilt)
- Both search paths work: `filterItems()` and `SearchInput`
- Group separator has `role="separator"` attribute
