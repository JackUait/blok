# Database Property Model Design

Redesign the database tool's data model, adapter interface, and model layer to support a shared property-based data layer. Board columns become derived from select property options. Rows are shared across all views. Each view is a presentation config over the same data.

This replaces the kanban-specific `KanbanAdapter`, `KanbanData`, `KanbanCardData`, and `KanbanColumnData` types with view-agnostic equivalents.

## Data Model

Three shared layers plus per-view configuration:

### Property Schema

Defines the columns of the database. User-configurable. Shared across all views.

```typescript
type PropertyType = 'title' | 'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url' | 'richText';

interface SelectOption {
  id: string;
  label: string;
  color?: string;
  position: string;
}

type PropertyConfig = SelectPropertyConfig;

interface SelectPropertyConfig {
  options: SelectOption[];
}

interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  position: string;
  config?: PropertyConfig;
}
```

- Every database has exactly one `title` property (required, cannot be deleted).
- `select` and `multiSelect` properties carry a `config.options` array.
- Other types have no config.
- Position uses fractional indexing for ordering.

### Rows

The actual data entries. Shared across all views.

```typescript
type PropertyValue = string | number | boolean | string[] | OutputData | null;

interface DatabaseRow {
  id: string;
  position: string;
  properties: Record<string, PropertyValue>;
}
```

- Property values are keyed by property ID (not name). Renaming a property doesn't touch rows.
- Select properties store option IDs, not labels. Renaming an option doesn't touch rows.
- Missing properties are treated as null.
- `title` property values are strings.
- `richText` property values are `OutputData` (nested Blok content). This replaces the old `description` field.
- `multiSelect` values are arrays of option IDs.

### View Configs

Per-view presentation settings.

```typescript
type ViewType = 'board' | 'table' | 'gallery' | 'list';

interface SortConfig {
  propertyId: string;
  direction: 'asc' | 'desc';
}

interface FilterConfig {
  propertyId: string;
  operator: string;
  value: PropertyValue;
}

interface DatabaseViewConfig {
  id: string;
  name: string;
  type: ViewType;
  position: string;
  groupBy?: string;              // property ID (board view groups by this)
  sorts: SortConfig[];
  filters: FilterConfig[];
  visibleProperties: string[];   // property IDs shown in this view
}
```

- Board views require `groupBy` pointing to a select, multiSelect, or checkbox property.
- Board "columns" are derived from the groupBy property's select options. There is no separate column concept.
- `visibleProperties` controls which properties appear on cards (board), as columns (table), etc.

### Top-Level Structure

```typescript
interface DatabaseData extends BlockToolData {
  schema: PropertyDefinition[];
  rows: Record<string, DatabaseRow>;
  views: DatabaseViewConfig[];
  activeViewId: string;
}
```

- `rows` is a Record (keyed by row ID) for O(1) lookup. Same pattern as the old `cardMap`.
- `schema` is an array sorted by position.
- `views` is an array sorted by position.

## Adapter Interface

Replaces `KanbanAdapter` with `DatabaseAdapter`.

```typescript
interface DatabaseAdapter {
  // Load the full database state
  loadDatabase(): Promise<{
    schema: PropertyDefinition[];
    rows: DatabaseRow[];
    views: DatabaseViewConfig[];
  }>;

  // Row operations (shared data)
  createRow(params: {
    id: string;
    properties: Record<string, PropertyValue>;
    position: string;
  }): Promise<DatabaseRow>;

  updateRow(params: {
    rowId: string;
    properties: Record<string, PropertyValue>;
  }): Promise<DatabaseRow>;

  moveRow(params: {
    rowId: string;
    position: string;
  }): Promise<DatabaseRow>;

  deleteRow(params: {
    rowId: string;
  }): Promise<void>;

  // Property schema operations (shared)
  createProperty(params: {
    id: string;
    name: string;
    type: PropertyType;
    position: string;
    config?: PropertyConfig;
  }): Promise<PropertyDefinition>;

  updateProperty(params: {
    propertyId: string;
    changes: Partial<Pick<PropertyDefinition, 'name' | 'config'>>;
  }): Promise<PropertyDefinition>;

  deleteProperty(params: {
    propertyId: string;
  }): Promise<void>;

  // View operations (per-view config)
  createView(params: {
    id: string;
    name: string;
    type: ViewType;
    position: string;
    groupBy?: string;
    sorts?: SortConfig[];
    filters?: FilterConfig[];
    visibleProperties?: string[];
  }): Promise<DatabaseViewConfig>;

  updateView(params: {
    viewId: string;
    changes: Partial<Pick<DatabaseViewConfig,
      'name' | 'type' | 'position' | 'groupBy' | 'sorts' | 'filters' | 'visibleProperties'
    >>;
  }): Promise<DatabaseViewConfig>;

  deleteView(params: {
    viewId: string;
  }): Promise<void>;
}

interface DatabaseConfig {
  adapter?: DatabaseAdapter;
}
```

### Board Action Mapping

| User action (board view) | Adapter call |
|--------------------------|-------------|
| Click "+ New Page" | `createRow({ properties: { [groupByPropId]: optionId } })` |
| Drag card to another column | `updateRow({ properties: { [groupByPropId]: newOptionId } })` |
| Drag card within same column | `moveRow({ position })` |
| Edit card title | `updateRow({ properties: { [titlePropId]: "..." } })` |
| Delete card | `deleteRow({ rowId })` |
| Rename column | `updateProperty({ config: { options: updatedOptions } })` |
| Add column | `updateProperty({ config: { options: [...existing, newOption] } })` |
| Delete column | `updateProperty({ config: { options: filteredOptions } })` |
| Add/rename/delete view | `createView()` / `updateView()` / `deleteView()` |

## DatabaseModel

Single instance per database block. Holds schema, rows, and view configs.

### Public API

```
// Schema
getSchema(): PropertyDefinition[]
getProperty(propertyId): PropertyDefinition | undefined
addProperty(name, type, config?): PropertyDefinition
updateProperty(propertyId, changes): void
deleteProperty(propertyId): void

// Rows
getOrderedRows(): DatabaseRow[]
getRow(rowId): DatabaseRow | undefined
addRow(properties): DatabaseRow
updateRow(rowId, properties): void
moveRow(rowId, position): void
deleteRow(rowId): void

// View-oriented queries
getRowsGroupedBy(propertyId): Map<string, DatabaseRow[]>
getSelectOptions(propertyId): SelectOption[]

// Views
getViews(): DatabaseViewConfig[]
getView(viewId): DatabaseViewConfig | undefined
addView(name, type, config?): DatabaseViewConfig
updateView(viewId, changes): void
deleteView(viewId): void

// Snapshot
snapshot(): DatabaseData
```

### Key Behaviors

- `getRowsGroupedBy(propertyId)` groups rows by the value of a select/multiSelect/checkbox property. Each key is an option ID (or `"true"`/`"false"` for checkbox). Rows with no value go under `""` (empty string). Rows within each group are sorted by position.
- `getSelectOptions(propertyId)` returns the options array from a select/multiSelect property's config, sorted by option position.
- One model for the entire block, not one per view. Switching views changes which config the renderer uses.
- Duplicating a view clones the view config only, not the rows.
- Deleting a property removes it from the schema and strips that property's values from all rows.

### Validation

`validate(savedData)` returns true when:
- `schema` has at least one `title` property
- `views` is non-empty
- Every board view has a `groupBy` that references an existing select, multiSelect, or checkbox property in the schema

### Default State

When a database block is created with no data:

- **Schema**: 2 properties — `title` (type: title) and `Status` (type: select, options: Not started/gray, In progress/blue, Done/green)
- **Rows**: empty
- **Views**: 1 Board view, groupBy = Status property ID

This produces the same initial UI as the current tool.

## Backend Sync

`DatabaseBackendSync` is rewritten to use `DatabaseAdapter` instead of `KanbanAdapter`.

- Immediate sync for discrete actions: createRow, deleteRow, moveRow, createProperty, updateProperty, deleteProperty, createView, updateView, deleteView
- Debounced sync (500ms) for text edits: updateRow when changing title or text property values
- No-adapter mode: all methods are silent no-ops
- Same error handling pattern (safeCall wrapper with onError callback)

## File Changes

| File | Change |
|------|--------|
| `types.ts` | **Rewrite.** All new types. |
| `database-model.ts` | **Rewrite.** Single model with schema/rows/views. |
| `database-backend-sync.ts` | **Rewrite.** Row/property/view sync methods. |
| `index.ts` | **Significant update.** Single model, board queries via getRowsGroupedBy. |
| `database-view.ts` | **Moderate update.** createBoard() receives grouped rows + select options. |
| `database-card-drawer.ts` | **Moderate update.** Opens with DatabaseRow. |
| `database-tab-bar.ts` | **Minor update.** Uses DatabaseViewConfig. |
| `database-card-drag.ts` | **Rename only.** card → row in result type. |
| `database-column-drag.ts` | **Rename only.** column → group in result type. |
| `database-column-controls.ts` | **Minor update.** Operates on select options. |
| `database-view-popover.ts` | **No change.** |
| `database-keyboard.ts` | **No change.** |

## Testing

Tests are written first (TDD). Three test files are rewritten, others are updated.

### Rewritten Tests

**`database-model.test.ts`** — Core model tests:
- Default database has title + status properties, empty rows, one board view
- `addRow()` creates row with auto ID + position, property values stored
- `updateRow()` merges partial property changes
- `getRowsGroupedBy(statusPropId)` returns rows grouped by their status option ID
- Rows with no value for the groupBy property go into an empty-string group
- `getSelectOptions()` returns options from a select property's config
- Adding an option to a select property adds a board "column"
- Deleting a select option removes it from schema; rows with that value get cleared
- `addView()` creates view config with type + groupBy
- `snapshot()` returns deep copy of schema + rows + views
- `addProperty()` / `deleteProperty()` updates schema without touching row values for other properties

**`database-backend-sync.test.ts`** — Sync tests:
- Row sync: createRow, updateRow (debounced), moveRow, deleteRow
- Property sync: createProperty, updateProperty, deleteProperty
- View sync: createView, updateView, deleteView
- No-adapter mode: all methods are no-ops
- Debounce: multiple updateRow calls coalesce
- Flush and destroy clean up pending timers

**`database.test.ts`** — Integration tests:
- Render/save/validate roundtrip with DatabaseData
- Single model shared across views (change in one view reflected in another)
- Board actions translate to row/property operations
- View switching with shared data
- Drawer opens with DatabaseRow
- Default state matches expected initial UI
- Validate rejects empty views / views without groupBy property

### Updated Tests

- `database-view.test.ts` — createBoard() receives grouped rows + select options
- `database-card-drawer.test.ts` — Opens with DatabaseRow
- `database-tab-bar.test.ts` — Uses DatabaseViewConfig
- `database-card-drag.test.ts` — Result type: card → row
- `database-column-drag.test.ts` — Result type: column → group
- `database-column-controls.test.ts` — Callbacks reference property options

### Unchanged Tests

- `database-view-popover.test.ts` — Already works with type strings
- `database-keyboard.test.ts` — No data model dependency
