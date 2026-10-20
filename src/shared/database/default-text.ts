/**
 * English defaults for a new database (en.json). Shared code cannot import the locale JSON,
 * so these are literals; test/unit/shared/database/schema-ops.test.ts pins them to en.json.
 */
export const DATABASE_DEFAULT_TEXT = {
  titleProperty: 'Title',
  /** A second data source's title property (research/23 §10). */
  sourceTitleProperty: 'Name',
  statusProperty: 'Status',
  statusNotStarted: 'Not started',
  statusInProgress: 'In progress',
  statusDone: 'Done',
  statusGroupTodo: 'To-do',
  statusGroupInProgress: 'In progress',
  statusGroupComplete: 'Complete',
  viewBoard: 'Board',
  viewTypeBoard: 'Board',
  viewTypeList: 'List',
  viewTypeTable: 'Table',
  viewTypeGallery: 'Gallery',
  viewTypeCalendar: 'Calendar',
  viewTypeTimeline: 'Timeline',
  viewTypeChart: 'Chart',
  viewTypeFeed: 'Feed',
  viewTypeForm: 'Form',
  viewTypeMap: 'Map',
  duplicatePropertyName: '{name} (copy)',
} as const;
