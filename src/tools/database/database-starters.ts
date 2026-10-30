import type { DatabaseIcon, DatabaseRowData, DatabaseStarterId, DatabaseViewConfig, PropertyDefinition, PropertyType, ViewType } from './types';

/**
 * The database templates of Notion's "New database" panel and its "More
 * templates" gallery (research/27 §1, research/30 §10). Every name, option,
 * view and sample row is as measured with the Customize defaults kept. A chip
 * or view card only adds or leaves out its property or view (research/30 B8).
 * All 21 templates of the gallery are listed (research/31 §7, research/33 §3).
 */
export type StarterId = DatabaseStarterId;

/** A Customize chip or view card. */
export interface StarterChoice {
  id: string;
  labelKey: string;
  on: boolean;
  /** A property type or a view layout, for its icon. */
  kind: PropertyType | ViewType;
}

export interface StarterMeta {
  id: StarterId;
  nameKey: string;
  /** The gallery card's one-line description (research/27 §1e). */
  descriptionKey: string;
  /**
   * The gallery card's preview (research/30 §10a): column names, and option
   * pills drawn in column `pillColumn` (a board's group headers without columns).
   */
  thumbnail: { columns: string[]; pills: Array<[string, string]>; pillColumn?: number };
  /** The panel tile tint (research/26 §2). */
  tint: DatabaseIcon['color'];
  glyph: DatabaseIcon['glyph'];
  /** The View settings row "Undo … database". Projects showed "Turn into" there instead (research/27:81). */
  undoKey?: string;
  /** Its confirm dialog (research/33 §3.10). Only the Tasks wording was measured; Skills has no body. */
  undoTitleKey?: string;
  undoDescriptionKey?: string;
  /** Empty: the template has no Customize step. */
  features: StarterChoice[];
  views: StarterChoice[];
}

type Translate = (key: string, vars?: Record<string, string>) => string;

export interface StarterBodyBlock {
  tool: 'header' | 'paragraph' | 'list';
  data: Record<string, unknown>;
}

export interface StarterRow {
  id: string;
  data: DatabaseRowData;
  body: StarterBodyBlock[];
}

export interface StarterBuild {
  title: string;
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
  rows: StarterRow[];
  /** Page templates; the first is the default. */
  templates: StarterRow[];
  icon: DatabaseIcon;
  /** Properties the Customize preview draws last, whatever their schema place (research/31 §8). */
  previewLast?: string[];
}

export interface StarterBuildOptions {
  t: Translate;
  newId: () => string;
  /** The database's own title property id: rows and the backend already name it. */
  titleId: string;
  /** Picked chips. Absent: the measured defaults. */
  features?: ReadonlySet<string>;
  /** Picked view cards. Absent: the measured defaults. */
  views?: ReadonlySet<string>;
}

const choice = (id: string, labelKey: string, on: boolean, kind: StarterChoice['kind']): StarterChoice => ({ id, labelKey, on, kind });

const STATUS_PILLS: Array<[string, string]> = [
  ['tools.database.defaultStatusNotStarted', 'gray'], ['tools.database.defaultStatusInProgress', 'blue'], ['tools.database.defaultStatusDone', 'green'],
];

export const DATABASE_STARTERS: readonly StarterMeta[] = [
  {
    id: 'tasks',
    nameKey: 'tools.database.starterTasks',
    descriptionKey: 'tools.database.starterTasksDescription',
    thumbnail: { columns: ['tools.database.starterTaskName', 'tools.database.defaultStatusProperty', 'tools.database.starterAssignee'], pills: STATUS_PILLS, pillColumn: 1 },
    tint: 'green',
    glyph: 'check',
    undoKey: 'tools.database.starterUndoTasks',
    undoTitleKey: 'tools.database.starterUndoTasksTitle',
    undoDescriptionKey: 'tools.database.starterUndoTasksDescription',
    features: [
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('taskType', 'tools.database.starterTaskType', true, 'multiSelect'),
      choice('effort', 'tools.database.starterEffortLevel', true, 'select'),
      choice('description', 'tools.database.formQuestionDescription', true, 'text'),
      choice('updatedAt', 'tools.database.starterUpdatedAt', false, 'lastEditedTime'),
      choice('pastDue', 'tools.database.starterPastDue', false, 'checkbox'),
      choice('attachFile', 'tools.database.starterAttachFile', false, 'files'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllTasks', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('mine', 'tools.database.starterViewMyTasks', true, 'table'),
      choice('checklist', 'tools.database.starterViewChecklist', false, 'list'),
    ],
  },
  {
    id: 'projects',
    nameKey: 'tools.database.starterProjects',
    descriptionKey: 'tools.database.starterProjectsDescription',
    thumbnail: { columns: [], pills: STATUS_PILLS },
    tint: 'blue',
    glyph: 'timeline',
    features: [
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('team', 'tools.database.starterTeam', true, 'multiSelect'),
      choice('dates', 'tools.database.starterStartAndEndDates', true, 'date'),
      choice('assignee', 'tools.database.starterAssignee', true, 'person'),
      choice('attachFile', 'tools.database.starterAttachFile', true, 'files'),
      choice('progress', 'tools.database.starterProgress', false, 'number'),
      choice('budget', 'tools.database.starterBudget', false, 'number'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllProjects', true, 'table'),
      choice('gantt', 'tools.database.starterViewGantt', true, 'timeline'),
      choice('mine', 'tools.database.starterViewMyProjects', false, 'table'),
    ],
  },
  {
    id: 'skills',
    nameKey: 'tools.database.starterSkills',
    descriptionKey: 'tools.database.starterSkillsDescription',
    thumbnail: { columns: ['tools.database.starterSkillName', 'tools.database.formQuestionDescription', 'tools.database.starterFiles'], pills: [] },
    tint: 'gray',
    glyph: 'wand',
    undoKey: 'tools.database.starterUndoSkills',
    undoTitleKey: 'tools.database.starterUndoSkillsTitle',
    features: [],
    views: [],
  },
  // research/30 §10c-f. Tints and glyphs follow the gallery shot's icons (a red page, an orange bulb, a yellow calendar, a blue flag); their values were not read.
  {
    id: 'documentHub',
    nameKey: 'tools.database.starterDocumentHub',
    descriptionKey: 'tools.database.starterDocumentHubDescription',
    thumbnail: { columns: ['tools.database.starterDocName', 'tools.database.propertyTypeCreatedBy', 'tools.database.propertyTypeCreatedTime'], pills: [] },
    tint: 'red',
    glyph: 'doc',
    features: [
      choice('createdTime', 'tools.database.propertyTypeCreatedTime', true, 'createdTime'),
      choice('category', 'tools.database.starterCategory', true, 'multiSelect'),
      choice('lastEditedBy', 'tools.database.propertyTypeLastEditedBy', true, 'lastEditedBy'),
      choice('lastUpdated', 'tools.database.starterLastUpdatedTime', true, 'lastEditedTime'),
      // A person: the chip shows Notion's people glyph (research/30 shot 20).
      choice('reviewers', 'tools.database.starterReviewers', false, 'person'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllDocs', true, 'table'),
      choice('mine', 'tools.database.starterViewMyDocs', true, 'table'),
      choice('byCategory', 'tools.database.starterViewByCategory', false, 'table'),
    ],
  },
  {
    id: 'brainstorm',
    nameKey: 'tools.database.starterBrainstorm',
    descriptionKey: 'tools.database.starterBrainstormDescription',
    thumbnail: {
      columns: ['tools.database.starterIdea', 'tools.database.propertyTypeCreatedBy', 'tools.database.starterPriority'],
      pills: [['tools.database.starterOptionMediumPriority', 'yellow'], ['tools.database.starterOptionLow', 'green'], ['tools.database.starterOptionHigh', 'red']],
      pillColumn: 2,
    },
    tint: 'orange',
    glyph: 'idea',
    features: [
      choice('createdBy', 'tools.database.propertyTypeCreatedBy', true, 'createdBy'),
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('upvote', 'tools.database.starterUpvote', true, 'button'),
      choice('status', 'tools.database.defaultStatusProperty', false, 'status'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllIdeas', true, 'table'),
      choice('byCategory', 'tools.database.starterViewByCategoryIdeas', true, 'board'),
      choice('top', 'tools.database.starterViewTopIdeas', false, 'table'),
    ],
  },
  {
    id: 'meetingNotes',
    nameKey: 'tools.database.starterMeetingNotes',
    descriptionKey: 'tools.database.starterMeetingNotesDescription',
    thumbnail: {
      columns: ['tools.database.starterMeetingName', 'tools.database.propertyTypeDate', 'tools.database.starterCategory'],
      pills: [['tools.database.starterOptionPresentation', 'yellow'], ['tools.database.starterOptionPlanning', 'blue'], ['tools.database.starterOptionStandup', 'red']],
      pillColumn: 2,
    },
    tint: 'yellow',
    glyph: 'calendar',
    features: [
      choice('date', 'tools.database.propertyTypeDate', true, 'date'),
      choice('category', 'tools.database.starterCategory', true, 'multiSelect'),
      choice('attendees', 'tools.database.starterAttendees', true, 'person'),
      choice('lastEditedBy', 'tools.database.propertyTypeLastEditedBy', false, 'lastEditedBy'),
      choice('lastUpdated', 'tools.database.starterLastUpdatedTime', false, 'lastEditedTime'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllMeetings', true, 'table'),
      choice('mine', 'tools.database.starterViewMyNotes', true, 'table'),
      choice('byCategory', 'tools.database.starterViewByCategory', false, 'table'),
    ],
  },
  {
    id: 'goals',
    nameKey: 'tools.database.starterGoals',
    descriptionKey: 'tools.database.starterGoalsDescription',
    thumbnail: { columns: ['tools.database.starterGoalName', 'tools.database.starterOwner', 'tools.database.defaultStatusProperty'], pills: STATUS_PILLS, pillColumn: 2 },
    tint: 'blue',
    glyph: 'flag',
    // research/31 §8.
    features: [
      choice('dueDate', 'tools.database.starterDueDate', true, 'date'),
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('team', 'tools.database.starterTeam', true, 'multiSelect'),
      choice('quarter', 'tools.database.starterQuarter', false, 'multiSelect'),
      choice('progress', 'tools.database.starterProgress', false, 'formula'),
      choice('daysUntilDue', 'tools.database.starterDaysUntilDue', false, 'date'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllGoals', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('mine', 'tools.database.starterViewMyGoals', true, 'table'),
      choice('byTeam', 'tools.database.starterViewByTeam', false, 'table'),
    ],
  },
  // research/31 §7; the off chips and view cards were read in research/33 §3.6-3.7.
  {
    id: 'campaign',
    nameKey: 'tools.database.starterCampaign',
    descriptionKey: 'tools.database.starterCampaignDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.starterOptionBlocked', 'red'], ['tools.database.defaultStatusNotStarted', 'gray'], ['tools.database.starterOptionPlanning', 'yellow']],
    },
    // A purple flag (research/31 shot 51).
    tint: 'purple',
    glyph: 'flag',
    features: [
      choice('campaignType', 'tools.database.starterCampaignType', true, 'multiSelect'),
      choice('markets', 'tools.database.starterMarkets', true, 'multiSelect'),
      choice('channels', 'tools.database.starterChannels', true, 'multiSelect'),
      choice('audiences', 'tools.database.starterAudiencesTargeted', true, 'multiSelect'),
      choice('files', 'tools.database.propertyTypeFiles', true, 'files'),
      choice('owner', 'tools.database.starterOwner', false, 'person'),
      choice('budget', 'tools.database.starterBudget', false, 'number'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllCampaigns', true, 'table'),
      choice('calendar', 'tools.database.viewTypeCalendar', true, 'calendar'),
      choice('byMarket', 'tools.database.starterViewByMarket', false, 'table'),
    ],
  },
  {
    id: 'contentCalendar',
    nameKey: 'tools.database.starterContentCalendar',
    descriptionKey: 'tools.database.starterContentCalendarDescription',
    // The thumbnail is the calendar's weekday row.
    thumbnail: { columns: ['tools.database.starterWeekdaySun', 'tools.database.starterWeekdayMon', 'tools.database.starterWeekdayTue'], pills: [] },
    // calendar_purple (research/33 §3.8).
    tint: 'purple',
    glyph: 'calendar',
    features: [
      choice('publishDate', 'tools.database.starterPublishDate', true, 'date'),
      choice('platform', 'tools.database.starterPlatform', true, 'multiSelect'),
      choice('contentType', 'tools.database.starterContentType', true, 'select'),
      choice('owner', 'tools.database.starterOwner', true, 'person'),
      choice('postUrl', 'tools.database.starterPostUrl', true, 'url'),
      choice('accounts', 'tools.database.starterAccounts', false, 'multiSelect'),
    ],
    views: [
      choice('calendar', 'tools.database.viewTypeCalendar', true, 'calendar'),
      choice('all', 'tools.database.starterViewAllContent', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('byPlatform', 'tools.database.starterViewByPlatform', false, 'table'),
    ],
  },
  // research/33 §3.4-3.5, §3.11. Inventory's light gray is gray.
  {
    id: 'events',
    nameKey: 'tools.database.starterEvents',
    descriptionKey: 'tools.database.starterEventsDescription',
    thumbnail: {
      columns: ['tools.database.starterEventName', 'tools.database.defaultStatusProperty', 'tools.database.starterEventDate'],
      pills: [['tools.database.defaultStatusNotStarted', 'gray'], ['tools.database.starterOptionPlanning', 'blue'], ['tools.database.starterOptionPendingReview', 'pink']],
      pillColumn: 1,
    },
    tint: 'purple',
    glyph: 'ticket',
    features: [
      choice('owner', 'tools.database.starterEventOwner', true, 'person'),
      choice('category', 'tools.database.starterCategory', true, 'select'),
      choice('format', 'tools.database.starterFormat', true, 'select'),
      choice('venue', 'tools.database.starterVenue', true, 'select'),
      choice('budget', 'tools.database.starterBudget', false, 'number'),
      choice('capacity', 'tools.database.starterCapacity', false, 'number'),
      choice('url', 'tools.database.starterEventUrl', false, 'url'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllEvents', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('calendar', 'tools.database.viewTypeCalendar', true, 'calendar'),
      choice('byCategory', 'tools.database.starterViewByCategory', false, 'table'),
      choice('mine', 'tools.database.starterViewMyEvents', false, 'table'),
    ],
  },
  {
    id: 'socialMedia',
    nameKey: 'tools.database.starterSocialMedia',
    descriptionKey: 'tools.database.starterSocialMediaDescription',
    thumbnail: { columns: ['tools.database.starterWeekdaySun', 'tools.database.starterWeekdayMon', 'tools.database.starterWeekdayTue'], pills: [] },
    tint: 'purple',
    glyph: 'feed',
    features: [
      choice('platform', 'tools.database.starterPlatform', true, 'multiSelect'),
      choice('postUrl', 'tools.database.starterPostUrl', true, 'url'),
      choice('contentType', 'tools.database.starterContentType', true, 'multiSelect'),
      choice('owner', 'tools.database.starterOwner', true, 'person'),
      choice('audiences', 'tools.database.starterTargetAudiences', false, 'multiSelect'),
    ],
    views: [
      choice('calendar', 'tools.database.viewTypeCalendar', true, 'calendar'),
      choice('all', 'tools.database.starterViewAllPosts', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('byPlatform', 'tools.database.starterViewByPlatform', false, 'table'),
    ],
  },
  {
    id: 'issues',
    nameKey: 'tools.database.starterIssues',
    descriptionKey: 'tools.database.starterIssuesDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.starterOptionBacklog', 'gray'], ['tools.database.starterOptionOpen', 'gray'], ['tools.database.defaultStatusInProgress', 'blue']],
    },
    tint: 'red',
    glyph: 'check',
    features: [
      choice('dueDate', 'tools.database.starterDueDate', true, 'date'),
      choice('type', 'tools.database.starterType', false, 'multiSelect'),
      choice('daysOpen', 'tools.database.starterDaysOpen', false, 'formula'),
    ],
    views: [
      choice('kanban', 'tools.database.starterViewKanban', true, 'board'),
      choice('all', 'tools.database.starterViewAllIssues', true, 'table'),
      choice('mine', 'tools.database.starterViewMyIssues', true, 'list'),
      choice('untriaged', 'tools.database.starterViewUntriaged', false, 'table'),
      choice('completed', 'tools.database.starterViewCompleted', false, 'table'),
    ],
  },
  {
    id: 'featureRequests',
    nameKey: 'tools.database.starterFeatureRequests',
    descriptionKey: 'tools.database.starterFeatureRequestsDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.starterOptionNew', 'gray'], ['tools.database.starterOptionUnderReview', 'yellow'], ['tools.database.starterOptionPlanned', 'brown']],
    },
    tint: 'red',
    glyph: 'comment',
    features: [
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('requestedBy', 'tools.database.starterRequestedBy', true, 'person'),
      choice('requestedDate', 'tools.database.starterRequestedDate', true, 'createdTime'),
      choice('productArea', 'tools.database.starterProductArea', true, 'multiSelect'),
      choice('effort', 'tools.database.starterEstimatedEffort', false, 'select'),
      choice('files', 'tools.database.starterRelatedFiles', false, 'files'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllRequests', true, 'table'),
      choice('mine', 'tools.database.starterViewAssignedToMe', true, 'table'),
      choice('high', 'tools.database.starterViewHighPriorityRequests', false, 'table'),
      choice('unassigned', 'tools.database.starterViewNewUnassignedRequests', false, 'table'),
    ],
  },
  {
    id: 'engineeringDocs',
    nameKey: 'tools.database.starterEngineeringDocs',
    descriptionKey: 'tools.database.starterEngineeringDocsDescription',
    thumbnail: {
      columns: ['tools.database.starterDocName', 'tools.database.starterAuthor', 'tools.database.defaultStatusProperty'],
      pills: [['tools.database.starterOptionInReviewTitle', 'blue'], ['tools.database.starterOptionPublished', 'green'], ['tools.database.starterOptionDraft', 'gray']],
      pillColumn: 2,
    },
    tint: 'red',
    glyph: 'doc',
    features: [
      choice('author', 'tools.database.starterAuthor', true, 'person'),
      choice('lastEdited', 'tools.database.propertyTypeLastEditedTime', true, 'lastEditedTime'),
      choice('reviewers', 'tools.database.starterReviewers', false, 'person'),
      choice('createdTime', 'tools.database.propertyTypeCreatedTime', false, 'createdTime'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllDocs', true, 'table'),
      choice('published', 'tools.database.starterViewPublishedDocs', true, 'list'),
      choice('byCategory', 'tools.database.starterViewDocsByCategory', true, 'table'),
      choice('recent', 'tools.database.starterViewRecentlyEdited', false, 'table'),
      choice('mine', 'tools.database.starterViewMyDocs', false, 'table'),
    ],
  },
  {
    id: 'fundraising',
    nameKey: 'tools.database.starterFundraising',
    descriptionKey: 'tools.database.starterFundraisingDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.defaultStatusNotStarted', 'gray'], ['tools.database.starterOptionDiligence', 'blue'], ['tools.database.starterOptionPitched', 'yellow']],
    },
    tint: 'gray',
    glyph: 'currency',
    features: [
      choice('capital', 'tools.database.starterCapitalCommitted', true, 'number'),
      choice('description', 'tools.database.formQuestionDescription', true, 'text'),
      choice('partnerName', 'tools.database.starterPartnerName', true, 'text'),
      choice('partnerEmail', 'tools.database.starterPartnerEmail', true, 'email'),
      choice('warmEmail', 'tools.database.starterWarmContactEmail', true, 'email'),
      choice('portfolio', 'tools.database.starterPortfolio', true, 'text'),
      choice('lastContact', 'tools.database.starterLastContactDate', true, 'date'),
      choice('warmName', 'tools.database.starterWarmContactName', false, 'text'),
      choice('checkSize', 'tools.database.starterAverageCheckSize', false, 'number'),
      choice('linkedin', 'tools.database.starterFirmLinkedin', false, 'text'),
      choice('lostReason', 'tools.database.starterLostReason', false, 'text'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllInvestors', true, 'table'),
      choice('won', 'tools.database.starterViewWon', true, 'table'),
      choice('lost', 'tools.database.starterViewLost', false, 'table'),
      choice('inProgress', 'tools.database.starterViewInProgress', false, 'table'),
    ],
  },
  {
    id: 'pipeline',
    nameKey: 'tools.database.starterPipeline',
    descriptionKey: 'tools.database.starterPipelineDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.starterOptionNew', 'green'], ['tools.database.starterOptionDiscovery', 'red'], ['tools.database.starterOptionNegotiation', 'orange']],
    },
    tint: 'blue',
    glyph: 'person',
    features: [
      choice('owner', 'tools.database.starterAccountOwner', true, 'person'),
      choice('priority', 'tools.database.starterPriorityLevel', true, 'select'),
      choice('value', 'tools.database.starterDealValue', true, 'number'),
      choice('decisionMaker', 'tools.database.starterDecisionMaker', true, 'person'),
      choice('closeDate', 'tools.database.starterExpectedCloseDate', true, 'date'),
      choice('email', 'tools.database.propertyTypeEmail', true, 'email'),
      choice('notes', 'tools.database.starterNotes', true, 'text'),
      choice('lastContact', 'tools.database.starterLastContactDate', false, 'date'),
      choice('leadSource', 'tools.database.starterLeadSource', false, 'multiSelect'),
      choice('daysSince', 'tools.database.starterDaysSinceLastContact', false, 'formula'),
      choice('phone', 'tools.database.starterPhoneNumber', false, 'phone'),
    ],
    views: [
      choice('byStage', 'tools.database.starterViewByDealStage', true, 'board'),
      choice('all', 'tools.database.starterViewAllDeals', true, 'table'),
      choice('active', 'tools.database.starterViewActiveDeals', true, 'table'),
      choice('recent', 'tools.database.starterViewRecentlyContacted', false, 'table'),
    ],
  },
  {
    id: 'accounts',
    nameKey: 'tools.database.starterAccountManagement',
    descriptionKey: 'tools.database.starterAccountManagementDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.starterOptionActive', 'brown'], ['tools.database.starterOptionChurned', 'yellow'], ['tools.database.starterOptionPendingRenewal', 'green']],
    },
    tint: 'blue',
    glyph: 'card',
    features: [
      choice('manager', 'tools.database.starterAccountManager', true, 'person'),
      choice('products', 'tools.database.starterProductCategories', true, 'multiSelect'),
      choice('email', 'tools.database.starterContactEmail', true, 'email'),
      choice('notes', 'tools.database.starterNotes', true, 'text'),
      choice('value', 'tools.database.starterContractValue', false, 'number'),
      choice('lastContact', 'tools.database.starterLastContactDate', false, 'date'),
      choice('phone', 'tools.database.starterPhoneNumber', false, 'phone'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllAccounts', true, 'table'),
      choice('byRegion', 'tools.database.starterViewByRegion', true, 'table'),
      choice('active', 'tools.database.starterViewActiveAccounts', false, 'table'),
    ],
  },
  {
    id: 'creative',
    nameKey: 'tools.database.starterCreative',
    descriptionKey: 'tools.database.starterCreativeDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.defaultStatusNotStarted', 'gray'], ['tools.database.defaultStatusInProgress', 'blue'], ['tools.database.starterOptionNeedsReview', 'yellow']],
    },
    tint: 'blue',
    glyph: 'paintBrush',
    features: [
      choice('creativeType', 'tools.database.starterCreativeType', true, 'multiSelect'),
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('assets', 'tools.database.starterAssets', true, 'files'),
      choice('start', 'tools.database.dateStart', false, 'date'),
      choice('end', 'tools.database.dateEnd', false, 'date'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllProjects', true, 'table'),
      choice('mine', 'tools.database.starterViewMyProjects', true, 'table'),
      choice('timeline', 'tools.database.viewTypeTimeline', false, 'timeline'),
      choice('byType', 'tools.database.starterViewByType', false, 'table'),
    ],
  },
  {
    id: 'inventory',
    nameKey: 'tools.database.starterInventory',
    descriptionKey: 'tools.database.starterInventoryDescription',
    thumbnail: {
      columns: ['tools.database.defaultSourceTitleProperty', 'tools.database.propertyTypeUniqueId', 'tools.database.starterCategory'],
      pills: [['tools.database.starterOptionHardware', 'orange'], ['tools.database.starterOptionAccessories', 'yellow'], ['tools.database.starterOptionElectronics', 'default']],
      pillColumn: 2,
    },
    tint: 'gray',
    glyph: 'package',
    features: [
      choice('id', 'tools.database.propertyTypeUniqueId', true, 'uniqueId'),
      choice('category', 'tools.database.starterCategory', true, 'select'),
      choice('quantity', 'tools.database.starterQuantityInStock', true, 'number'),
      choice('supplier', 'tools.database.starterSupplier', true, 'select'),
      choice('location', 'tools.database.starterLocation', true, 'select'),
      choice('notes', 'tools.database.starterNotes', true, 'text'),
      choice('reorderMin', 'tools.database.starterReorderMinimum', false, 'number'),
      choice('reorderStatus', 'tools.database.starterReorderStatus', false, 'formula'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllInventory', true, 'table'),
      choice('recent', 'tools.database.starterViewRecentlyOrdered', true, 'list'),
      choice('hardware', 'tools.database.starterViewHardwareInventory', false, 'table'),
    ],
  },
  {
    id: 'roadmap',
    nameKey: 'tools.database.starterRoadmap',
    descriptionKey: 'tools.database.starterRoadmapDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.starterOptionBacklog', 'brown'], ['tools.database.starterOptionPlanned', 'gray'], ['tools.database.defaultStatusInProgress', 'blue']],
    },
    tint: 'pink',
    glyph: 'map',
    features: [
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('category', 'tools.database.starterCategory', true, 'multiSelect'),
      choice('effort', 'tools.database.starterEffort', true, 'select'),
      choice('date', 'tools.database.propertyTypeDate', true, 'date'),
      choice('description', 'tools.database.starterProjectDescription', false, 'text'),
      choice('quarter', 'tools.database.starterQuarter', false, 'multiSelect'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllProjects', true, 'table'),
      choice('mine', 'tools.database.starterViewMyProjects', true, 'table'),
      choice('byTeam', 'tools.database.starterViewByTeam', true, 'list'),
      choice('byQuarter', 'tools.database.starterViewByQuarter', false, 'list'),
      choice('timeline', 'tools.database.viewTypeTimeline', false, 'timeline'),
    ],
  },
  {
    id: 'assets',
    nameKey: 'tools.database.starterAssetLibrary',
    descriptionKey: 'tools.database.starterAssetLibraryDescription',
    // research/30 §10a: the card shows no preview text.
    thumbnail: { columns: [], pills: [] },
    tint: 'green',
    glyph: 'fanDeck',
    features: [
      choice('designer', 'tools.database.starterDesigner', true, 'person'),
      choice('assetType', 'tools.database.starterAssetType', true, 'multiSelect'),
      choice('lastEdited', 'tools.database.starterLastEdited', true, 'lastEditedTime'),
      choice('files', 'tools.database.propertyTypeFiles', true, 'files'),
      choice('description', 'tools.database.starterAssetDescription', false, 'text'),
      choice('url', 'tools.database.starterAssetUrl', false, 'url'),
    ],
    views: [
      choice('gallery', 'tools.database.viewTypeGallery', true, 'gallery'),
      choice('all', 'tools.database.starterViewAllAssets', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('assetType', 'tools.database.starterViewAssetType', false, 'table'),
      choice('mine', 'tools.database.starterViewMyAssets', false, 'table'),
    ],
  },
];

/**
 * research/27 §1a: after each use the next template moves up. Inferred, not
 * verified there: the first three not used yet. With seven templates it
 * gives every list research/27 §1a saw.
 */
export const suggestedStarters = (used: ReadonlySet<StarterId>): StarterMeta[] =>
  DATABASE_STARTERS.filter((starter) => !used.has(starter.id)).slice(0, 3);

/** The gallery's "Templates": unused ones first, then used ones (research/27 §1e, inferred rule). */
export const galleryStarters = (used: ReadonlySet<StarterId>): StarterMeta[] => [
  ...DATABASE_STARTERS.filter((starter) => !used.has(starter.id)),
  ...DATABASE_STARTERS.filter((starter) => used.has(starter.id)),
];

/**
 * The Customize preview's "N hidden properties" (research/30 B8): the shown
 * view's (default: the first) properties that are not shown, leaving out the title and a board's
 * group. Inferred from four counts (0, 4, 4, 5), all of which it gives.
 */
export const hiddenPropertyCount = (made: StarterBuild, first = made.views[0]): number => {
  if (first === undefined) return 0;

  return made.schema.filter((p, index) => index > 0 && !first.visibleProperties.includes(p.id) && p.id !== first.groupBy).length;
};

/** Builds one template's schema, views, rows and row bodies. */
export type StarterBuilder = (id: StarterId, options: StarterBuildOptions) => StarterBuild;

const builderLoad: { pending: Promise<StarterBuilder> | null } = { pending: null };

/** The template builder. A failed download is tried again by the next call. */
export const loadStarterBuilder = (): Promise<StarterBuilder> => {
  builderLoad.pending ??= import('./database-starter-build').then((module) => module.createStarterBuilder(DATABASE_STARTERS), (error: unknown) => {
    builderLoad.pending = null;
    throw error;
  });

  return builderLoad.pending;
};
