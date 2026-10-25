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
  /** The view the "Map view" toolbox entry starts with (research/20 §1a); Add view names a map "Map". */
  viewMapSeed: 'Map view',
  /** The place property a new map adds (research/20 §1a). */
  placeProperty: 'Place',
  /** First views of the "/" Database entries (research/28 §3). */
  viewBoardSeed: 'Board view',
  viewGallerySeed: 'Gallery view',
  viewListSeed: 'List view',
  viewFeedSeed: 'Feed view',
  viewCalendarSeed: 'Calendar view',
  viewTimelineSeed: 'Timeline view',
  viewFormBuilder: 'Form builder',
  viewResponses: 'Responses',
  /** Properties those entries add (research/28 §3). */
  assignProperty: 'Assign',
  createdProperty: 'Created',
  tagsProperty: 'Tags',
  dateProperty: 'Date',
  questionProperty: 'Question {number}',
  respondentProperty: 'Respondent',
  submissionTimeProperty: 'Submission time',
  optionLabel: 'Option {number}',
  duplicatePropertyName: '{name} (copy)',
  /** The other side a two-way relation adds. */
  relationReverseName: 'Related to {name}',
} as const;
