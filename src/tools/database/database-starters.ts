import { positionBetween } from '../../shared/database/positions';
import { newView, createDefaultStatusOptions, createDefaultStatusSettings } from '../../shared/database/schema-ops';
import { DATABASE_DEFAULT_TEXT } from '../../shared/database/default-text';
import { ME_FILTER_VALUE } from './database-query';
import type { DatabaseIcon, DatabaseRowData, DatabaseStarterId, DatabaseViewConfig, PropertyDefinition, PropertyType, PropertyValue, ViewType } from './types';
import type { ViewCreateConfig } from '../../shared/database/schema-ops';

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

const picked = (list: StarterChoice[], chosen: ReadonlySet<string> | undefined): Set<string> =>
  new Set(list.filter((c) => (chosen === undefined ? c.on : chosen.has(c.id))).map((c) => c.id));

const MDY = { dateFormat: 'month_day_year', timeFormat: '12_hour' } as const;
const FULL = { dateFormat: 'full', timeFormat: '12_hour' } as const;

/** Builds one template's schema, views, rows and row bodies. */
export const buildStarter = (id: StarterId, options: StarterBuildOptions): StarterBuild => {
  const { t, newId } = options;
  const meta = DATABASE_STARTERS.find((s) => s.id === id) ?? DATABASE_STARTERS[0];
  const features = picked(meta.features, options.features);
  const views = picked(meta.views, options.views);
  const schema: PropertyDefinition[] = [];
  const add = (name: string, type: PropertyType, extra: Partial<PropertyDefinition> = {}): PropertyDefinition => {
    const property: PropertyDefinition = { id: schema.length === 0 ? options.titleId : newId(), name, type, position: positionBetween(schema.at(-1)?.position ?? null, null), ...extra };

    schema.push(property);

    return property;
  };
  const optionsOf = (list: Array<[string, string]>): { config: { options: NonNullable<PropertyDefinition['config']>['options'] } } => ({
    config: { options: list.reduce<NonNullable<PropertyDefinition['config']>['options']>((all, [label, color]) =>
      [...all, { id: newId(), label, color, position: positionBetween(all.at(-1)?.position ?? null, null) }], []) },
  });
  // research/27:48, research/30 §10f: Not started is the DEFAULT and has no colour. `measured` false: a status Blok adds itself.
  const status = (measured = true): PropertyDefinition => {
    // Stored in English like a status Blok adds itself; the view localizes these names.
    const [notStarted, ...rest] = createDefaultStatusOptions({ notStarted: DATABASE_DEFAULT_TEXT.statusNotStarted, inProgress: DATABASE_DEFAULT_TEXT.statusInProgress, done: DATABASE_DEFAULT_TEXT.statusDone }, newId);
    const { color: _gray, ...colourless } = notStarted;

    return add(t('tools.database.defaultStatusProperty'), 'status', measured
      ? { config: { options: [colourless, ...rest] }, status: { ...createDefaultStatusSettings(), defaultOptionId: notStarted.id } }
      : { config: { options: [notStarted, ...rest] }, status: createDefaultStatusSettings() });
  };
  // Options as [label, colour, group]; no colour for the DEFAULT option, at `defaultAt` (research/31 §7a-b).
  const customStatus = (list: Array<[string, string | undefined, string]>, defaultAt: number): PropertyDefinition => {
    const made = list.reduce<NonNullable<PropertyDefinition['config']>['options']>((all, [label, color, groupId]) =>
      [...all, { id: newId(), label, ...(color === undefined ? {} : { color }), groupId, position: positionBetween(all.at(-1)?.position ?? null, null) }], []);

    return add(t('tools.database.defaultStatusProperty'), 'status', {
      config: { options: made },
      status: { ...createDefaultStatusSettings(), ...(made[defaultAt] === undefined ? {} : { defaultOptionId: made[defaultAt].id }) },
    });
  };
  const priority = (): PropertyDefinition => add(t('tools.database.starterPriority'), 'select',
    optionsOf([[t('tools.database.starterOptionHigh'), 'red'], [t('tools.database.starterOptionMediumPriority'), 'yellow'], [t('tools.database.starterOptionLow'), 'green']]));
  const teamProperty = (): PropertyDefinition => add(t('tools.database.starterTeam'), 'multiSelect', optionsOf([
    [t('tools.database.starterTeamAccountManagement'), 'default'], [t('tools.database.starterTeamBusinessDevelopment'), 'blue'],
    [t('tools.database.starterTeamProductDesign'), 'green'], [t('tools.database.starterTeamHumanResources'), 'purple'],
  ]));
  const option = (property: PropertyDefinition | undefined, index: number): string | undefined => property?.config?.options[index]?.id;
  const viewList: DatabaseViewConfig[] = [];
  const view = (name: string, type: ViewType, shown: Array<PropertyDefinition | undefined>, extra: ViewCreateConfig = {}): void => {
    const visible = shown.filter((p): p is PropertyDefinition => p !== undefined).map((p) => p.id);

    viewList.push(newView({
      id: newId(),
      name,
      type,
      position: positionBetween(viewList.at(-1)?.position ?? null, null),
      visibleProperties: visible,
      // The order here is the column order.
      properties: [
        { id: options.titleId, visible: true },
        ...visible.map((shownId) => ({ id: shownId, visible: true })),
        ...schema.filter((p) => p.id !== options.titleId && !visible.includes(p.id)).map((p) => ({ id: p.id, visible: false })),
      ],
      ...extra,
    }, schema));
  };
  const rows: StarterRow[] = [];
  const row = (title: string, values: Record<string, PropertyValue | undefined>, icon?: string, body: StarterBodyBlock[] = []): void => {
    const properties: Record<string, PropertyValue> = { [options.titleId]: title };

    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && schema.some((p) => p.id === key)) properties[key] = value;
    }
    // A person or files list exists from birth, as a row Blok makes itself (withEmptyLists).
    for (const p of schema) if ((p.type === 'person' || p.type === 'files') && properties[p.id] === undefined) properties[p.id] = [];
    rows.push({
      id: newId(),
      data: { properties, title, position: positionBetween(rows.at(-1)?.data.position ?? null, null), ...(icon === undefined ? {} : { icon }) },
      body,
    });
  };
  const templates: StarterRow[] = [];
  const previewLast: string[] = [];
  // research/27:44, :81: the first template is the default. Tasks' and Projects' bodies are not measured: they repeat the first row's.
  const template = (title: string, body: StarterBodyBlock[] = []): void => {
    const position = templates.length === 0 ? 'a0' : positionBetween(templates.at(-1)?.data.position ?? null, null);
    const made: StarterRow = { id: newId(), data: { properties: { [options.titleId]: title }, title, position, template: true }, body };

    templates.push(made);
    schema[0].defaultTemplateId ??= made.id;
  };
  const heading = (text: string, level: number): StarterBodyBlock => ({ tool: 'header', data: { text: [{ text }], level } });
  const text = (value: string): StarterBodyBlock => ({ tool: 'paragraph', data: { text: value === '' ? [] : [{ text: value }] } });
  const todo = (): StarterBodyBlock => ({ tool: 'list', data: { text: [], style: 'checklist', checked: false } });
  const bullet = (): StarterBodyBlock => ({ tool: 'list', data: { text: [], style: 'unordered' } });
  const tableLook = { showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50, openPagesIn: 'side' } as const;
  const boardLook = { showPageIcon: true, wrapCells: true, loadLimit: 25, cardPreview: 'none', cardSize: 'medium', groupSettings: { colorColumns: true } } as const;
  const mine = (assignee: PropertyDefinition | undefined): ViewCreateConfig =>
    (assignee === undefined ? {} : { filters: [{ id: newId(), propertyId: assignee.id, operator: 'contains', value: [ME_FILTER_VALUE] }] });
  // `grouped` orders the "Properties" group when it is not the schema order (research/33 §3.8).
  const pin = (pinned: Array<PropertyDefinition | undefined>, grouped: Array<PropertyDefinition | undefined> = []): void => {
    const place = (list: Array<PropertyDefinition | undefined>, where: 'heading' | 'group'): Array<{ id: string; place: 'heading' | 'group' }> =>
      list.filter((p): p is PropertyDefinition => p !== undefined).map((p) => ({ id: p.id, place: where }));

    schema[0].pageLayoutGroupIn = 'panel';
    schema[0].pageLayoutPlacements = [...place(pinned, 'heading'), ...place(grouped, 'group')];
  };
  const select = (name: string, list: Array<[string, string]>, multi = false): PropertyDefinition => add(name, multi ? 'multiSelect' : 'select', optionsOf(list));
  const sortBy = (...list: Array<[PropertyDefinition | undefined, 'asc' | 'desc']>): ViewCreateConfig => {
    const sorts = list.flatMap(([p, direction]) => (p === undefined ? [] : [{ id: newId(), propertyId: p.id, direction }]));

    return sorts.length === 0 ? {} : { sorts };
  };
  const where = (p: PropertyDefinition | undefined, operator: string, value: PropertyValue): ViewCreateConfig =>
    (p === undefined ? {} : { filters: [{ id: newId(), propertyId: p.id, operator, value }] });
  const optionIds = (p: PropertyDefinition | undefined, labels: string[]): string[] =>
    labels.flatMap((label) => p?.config?.options.find((o) => o.label === label)?.id ?? []);
  /** A view's own manual group order by option label; `null` is the no-value group (research/31 §8, research/33 §3.13). */
  const groupOrder = (p: PropertyDefinition, labels: Array<string | null>): ViewCreateConfig => {
    const keys = labels.reduce<string[]>((all) => [...all, positionBetween(all.at(-1) ?? null, null)], []);
    const none = keys[labels.indexOf(null)];
    const order = Object.fromEntries(labels.flatMap((label, index) => (label === null ? [] : optionIds(p, [label]).map((id) => [id, keys[index]]))));

    return { groupOrder: order, ...(none === undefined ? {} : { noValueGroupPosition: none }) };
  };

  if (id === 'tasks') {
    add(t('tools.database.starterTaskName'), 'title');
    const state = status();
    const assignee = add(t('tools.database.starterAssignee'), 'person');
    const due = add(t('tools.database.starterDueDate'), 'date', { date: { ...MDY } });
    const prio = features.has('priority') ? priority() : undefined;
    const kind = features.has('taskType') ? add(t('tools.database.starterTaskType'), 'multiSelect', optionsOf([
      [`🐞 ${t('tools.database.starterOptionBug')}`, 'orange'], [`💬 ${t('tools.database.starterOptionFeatureRequest')}`, 'green'], [`💅 ${t('tools.database.starterOptionPolish')}`, 'pink'],
    ])) : undefined;
    const description = features.has('description') ? add(t('tools.database.formQuestionDescription'), 'text') : undefined;
    const effort = features.has('effort') ? add(t('tools.database.starterEffortLevel'), 'select',
      optionsOf([[t('tools.database.starterOptionSmall'), 'green'], [t('tools.database.starterOptionMediumEffort'), 'yellow'], [t('tools.database.starterOptionLarge'), 'red']])) : undefined;

    if (features.has('updatedAt')) add(t('tools.database.starterUpdatedAt'), 'lastEditedTime');
    if (features.has('pastDue')) add(t('tools.database.starterPastDue'), 'checkbox');
    if (features.has('attachFile')) add(t('tools.database.starterAttachFile'), 'files');
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllTasks'), 'table', all, tableLook);
    if (views.has('byStatus')) view(t('tools.database.starterViewByStatus'), 'board', [assignee, prio, kind], { ...boardLook, groupBy: state.id });
    if (views.has('mine')) view(t('tools.database.starterViewMyTasks'), 'table', [assignee, due, state], { showPageIcon: true, wrapCells: false, loadLimit: 50, ...mine(assignee) });
    if (views.has('checklist')) view(t('tools.database.starterViewChecklist'), 'list', [state]);
    if (viewList.length === 0) view(t('tools.database.starterViewAllTasks'), 'table', all, tableLook);

    const values = (s: number, date: string, p: number, k: number, d: string, e: number): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      [due.id]: date,
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      ...(kind === undefined ? {} : { [kind.id]: [option(kind, k) ?? ''] }),
      ...(description === undefined ? {} : { [description.id]: t(d) }),
      ...(effort === undefined ? {} : { [effort.id]: option(effort, e) }),
    });

    const body = [
      heading(t('tools.database.starterTaskDescriptionHeading'), 2),
      text(t('tools.database.starterTaskDescriptionText')),
      text(''),
      heading(t('tools.database.starterSubTasks'), 2),
      todo(), todo(), todo(),
      // Then a PDF, a Google Drive and a Figma embed placeholder: left out, Blok keeps no empty embed.
      heading(t('tools.database.starterSupportingFiles'), 2),
    ];

    row(t('tools.database.starterTaskRow1'), values(2, '2025-02-03', 0, 2, 'tools.database.starterTaskRow1Description', 1), undefined, body);
    template(t('tools.database.starterNewTask'), body);
    row(t('tools.database.starterTaskRow2'), values(1, '2025-02-20', 1, 1, 'tools.database.starterTaskRow2Description', 0), '📕');
    row(t('tools.database.starterTaskRow3'), values(0, '2025-02-28', 2, 1, 'tools.database.starterTaskRow3Description', 0), '🗒️');
    pin([assignee, state, due]);
  } else if (id === 'projects') {
    add(t('tools.database.starterProjectName'), 'title');
    const assignee = features.has('assignee') ? add(t('tools.database.starterAssignee'), 'person') : undefined;
    const prio = features.has('priority') ? priority() : undefined;

    if (features.has('attachFile')) add(t('tools.database.starterAttachFile'), 'files');
    const end = features.has('dates') ? add(t('tools.database.dateEnd'), 'date', { date: { ...MDY } }) : undefined;
    const start = features.has('dates') ? add(t('tools.database.dateStart'), 'date', { date: { ...MDY } }) : undefined;
    const state = status();
    const team = features.has('team') ? teamProperty() : undefined;

    if (features.has('progress')) add(t('tools.database.starterProgress'), 'number');
    if (features.has('budget')) add(t('tools.database.starterBudget'), 'number');
    const all = schema.slice(1);

    if (views.has('byStatus')) view(t('tools.database.starterViewByStatus'), 'board', [assignee, prio], { ...boardLook, groupBy: state.id });
    if (views.has('all')) view(t('tools.database.starterViewAllProjects'), 'table', all, tableLook);
    // "Table properties: 1 shown" reads as the title, which the timeline table always shows.
    if (views.has('gantt') && start !== undefined && end !== undefined) {
      view(t('tools.database.starterViewGantt'), 'timeline', [assignee], {
        groupBy: state.id, timelineBy: start.id, timelineEndBy: end.id, timelineZoom: 'month', showTimelineTable: true, loadLimit: 25,
      });
    }
    if (views.has('mine') && assignee !== undefined) view(t('tools.database.starterViewMyProjects'), 'table', all, { ...tableLook, ...mine(assignee) });
    if (viewList.length === 0) view(t('tools.database.starterViewByStatus'), 'board', [assignee, prio], { ...boardLook, groupBy: state.id });

    const values = (s: number, from: string, to: string, p: number, tm: number): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      ...(start === undefined || end === undefined ? {} : { [start.id]: from, [end.id]: to }),
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      ...(team === undefined ? {} : { [team.id]: [option(team, tm) ?? ''] }),
    });

    const body = [
      heading(t('tools.database.starterAboutProject'), 3),
      text(t('tools.database.starterAboutProjectText')),
      text(''),
      heading(t('tools.database.starterActionItems'), 3),
      todo(),
      // Then a Google Drive, a PDF and a Figma embed placeholder: left out, as in Tasks Tracker.
      heading(t('tools.database.starterDocuments'), 3),
    ];

    row(t('tools.database.starterProjectRow1'), values(0, '2025-03-24', '2025-03-28', 1, 0), '📖', body);
    template(t('tools.database.starterNewProject'), body);
    row(t('tools.database.starterProjectRow2'), values(2, '2025-01-20', '2025-02-04', 2, 3));
    row(t('tools.database.starterProjectRow3'), values(1, '2025-04-09', '2025-04-30', 0, 2), '📱');
    pin([state, assignee, prio, end]);
  } else if (id === 'documentHub') {
    add(t('tools.database.starterDocName'), 'title');
    const category = features.has('category') ? add(t('tools.database.starterCategory'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionProposal'), 'yellow'], [t('tools.database.starterOptionCustomerResearch'), 'blue'],
      [t('tools.database.starterOptionStrategyDoc'), 'orange'], [t('tools.database.starterOptionPlanning'), 'red'],
    ])) : undefined;

    // research/30 B8: Reviewers turned on sits right after Category.
    if (features.has('reviewers')) add(t('tools.database.starterReviewers'), 'person');
    const author = add(t('tools.database.propertyTypeCreatedBy'), 'createdBy');

    if (features.has('createdTime')) add(t('tools.database.propertyTypeCreatedTime'), 'createdTime', { date: { ...FULL } });
    if (features.has('lastEditedBy')) add(t('tools.database.propertyTypeLastEditedBy'), 'lastEditedBy');
    if (features.has('lastUpdated')) add(t('tools.database.starterLastUpdatedTime'), 'lastEditedTime', { date: { ...FULL } });
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllDocs'), 'table', all, tableLook);
    if (views.has('mine')) view(t('tools.database.starterViewMyDocs'), 'table', [category], { loadLimit: 50, ...mine(author) });
    // research/30 B8: the grouped preview's first group is Customer research. The rest were not read.
    const research = option(category, 1);

    if (views.has('byCategory') && category !== undefined) {
      view(t('tools.database.starterViewByCategory'), 'table', all, {
        ...tableLook, groupBy: category.id, ...(research === undefined ? {} : { groupOrder: { [research]: positionBetween(null, 'a0') } }),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllDocs'), 'table', all, tableLook);

    const values = (c: number): Record<string, PropertyValue | undefined> => (category === undefined ? {} : { [category.id]: [option(category, c) ?? ''] });

    row(t('tools.database.starterDocRow1'), values(2));
    row(t('tools.database.starterDocRow2'), values(0));
    row(t('tools.database.starterDocRow3'), values(1));
  } else if (id === 'brainstorm') {
    add(t('tools.database.starterIdea'), 'title');
    // research/30 B8: Status turned on is the first column after the title. Its options were not
    // read (Notion's sample value is "New idea"), so it gets a new status's own and no row values.
    if (features.has('status')) status(false);
    const author = features.has('createdBy') ? add(t('tools.database.propertyTypeCreatedBy'), 'createdBy') : undefined;
    const prio = features.has('priority') ? priority() : undefined;
    const category = add(t('tools.database.starterCategory'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionTopOfFunnel'), 'yellow'], [t('tools.database.starterOptionActivation'), 'orange'], [t('tools.database.starterOptionConversion'), 'blue'],
    ]));

    // One chip, three properties. The button's actions and the formula's expression were not read.
    if (features.has('upvote')) {
      add(t('tools.database.starterUpvote'), 'button');
      add(t('tools.database.starterTotalVotes'), 'formula');
      add(t('tools.database.starterUpvotedBy'), 'person');
    }
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllIdeas'), 'table', all, tableLook);
    if (views.has('byCategory')) {
      view(t('tools.database.starterViewByCategoryIdeas'), 'board', [], {
        ...boardLook, groupBy: category.id, groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true },
      });
    }
    // Shows Idea and Created by (research/30 B8). Its layout and sort were not read: a table, unsorted.
    if (views.has('top')) view(t('tools.database.starterViewTopIdeas'), 'table', [author], tableLook);
    if (viewList.length === 0) view(t('tools.database.starterViewAllIdeas'), 'table', all, tableLook);

    const values = (p: number, c: number): Record<string, PropertyValue | undefined> => ({
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      [category.id]: [option(category, c) ?? ''],
    });

    row(t('tools.database.starterIdeaRow1'), values(0, 1));
    row(t('tools.database.starterIdeaRow2'), values(1, 2));
    row(t('tools.database.starterIdeaRow3'), values(2, 0));
    // research/30 B8: Top Ideas lists the rows in reverse (Improve SEO first). Why is not known
    // (its sort was not read): Blok stores the order on the view.
    const top = viewList.find((v) => v.name === t('tools.database.starterViewTopIdeas'));

    if (top !== undefined) top.rowOrder = Object.fromEntries([...rows].reverse().map((r, index) => [r.id, rows[index].data.position]));
  } else if (id === 'meetingNotes') {
    add(t('tools.database.starterMeetingName'), 'title');
    const date = features.has('date') ? add(t('tools.database.propertyTypeDate'), 'date', { date: { dateFormat: 'relative', timeFormat: 'hidden' } }) : undefined;
    const category = features.has('category') ? add(t('tools.database.starterCategory'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionPlanning'), 'blue'], [t('tools.database.starterOptionStandup'), 'red'], [t('tools.database.starterOptionPresentation'), 'yellow'],
      [t('tools.database.starterOptionRetro'), 'green'], [t('tools.database.starterOptionCustomerCall'), 'blue'],
    ])) : undefined;
    const attendees = features.has('attendees') ? add(t('tools.database.starterAttendees'), 'person') : undefined;
    const author = add(t('tools.database.propertyTypeCreatedBy'), 'createdBy');

    if (features.has('lastEditedBy')) add(t('tools.database.propertyTypeLastEditedBy'), 'lastEditedBy');
    if (features.has('lastUpdated')) add(t('tools.database.starterLastUpdatedTime'), 'lastEditedTime', { date: { ...FULL } });
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllMeetings'), 'table', all, tableLook);
    // Four columns and a Created by filter were read; which columns, and the filter's operator and value, were not.
    if (views.has('mine')) view(t('tools.database.starterViewMyNotes'), 'table', [date, category, attendees], { ...tableLook, showPageIcon: true, ...mine(author) });
    if (views.has('byCategory') && category !== undefined) view(t('tools.database.starterViewByCategory'), 'table', all, { ...tableLook, groupBy: category.id });
    if (viewList.length === 0) view(t('tools.database.starterViewAllMeetings'), 'table', all, tableLook);

    const values = (c: number): Record<string, PropertyValue | undefined> => ({
      ...(date === undefined ? {} : { [date.id]: '2025-02-13' }),
      ...(category === undefined ? {} : { [category.id]: [option(category, c) ?? ''] }),
    });

    row(t('tools.database.starterMeetingRow1'), values(3));
    row(t('tools.database.starterMeetingRow2'), values(1));
    row(t('tools.database.starterMeetingRow3'), values(2));
  } else if (id === 'goals') {
    add(t('tools.database.starterGoalName'), 'title');
    const owner = add(t('tools.database.starterOwner'), 'person');
    const state = status();
    const due = features.has('dueDate') ? add(t('tools.database.starterDueDate'), 'date', { date: { ...MDY } }) : undefined;

    // A number of days or the text "Overdue", as measured. Without Due date it has nothing to read (unmeasured).
    if (due !== undefined && features.has('daysUntilDue')) {
      const days = `dateBetween({{property:${due.id}}}, now(), "days")`;

      // research/31 §8: after Due date in the database, last in the preview.
      previewLast.push(add(t('tools.database.starterDaysUntilDue'), 'formula', {
        formula: { expression: `if(${days} > 0, ${days}, ${JSON.stringify(t('tools.database.starterOverdue'))})` },
      }).id);
    }
    const prio = features.has('priority') ? priority() : undefined;
    const quarter = features.has('quarter') ? add(t('tools.database.starterQuarter'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionQuarter', { number: '1' }), 'yellow'], [t('tools.database.starterOptionQuarter', { number: '2' }), 'pink'],
      [t('tools.database.starterOptionQuarter', { number: '3' }), 'green'], [t('tools.database.starterOptionQuarter', { number: '4' }), 'gray'],
    ])) : undefined;
    const team = features.has('team') ? teamProperty() : undefined;
    // One chip, three properties. Progress is not capped: 25/20 reads 125% with a full bar.
    const start = features.has('progress') ? add(t('tools.database.starterStartValue'), 'number') : undefined;
    const end = features.has('progress') ? add(t('tools.database.starterEndValue'), 'number') : undefined;

    if (start !== undefined && end !== undefined) {
      add(t('tools.database.starterProgress'), 'formula', {
        formula: { expression: `{{property:${start.id}}}/{{property:${end.id}}}` },
        number: { format: 'percent', showAs: 'bar', color: 'green' },
      });
    }
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllGoals'), 'table', all, tableLook);
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [prio, state], {
        ...boardLook, groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: false },
      });
    }
    // The filter's operator was not read: Contains Me, as My Tasks.
    if (views.has('mine')) view(t('tools.database.starterViewMyGoals'), 'table', [owner, prio, quarter, state, team], { ...tableLook, showPageIcon: true, ...mine(owner) });
    if (views.has('byTeam') && team !== undefined) {
      const [, development, design, people] = team.config?.options ?? [];

      // research/31 §8: Human Resources before Product Design here; the options keep Product Design first.
      view(t('tools.database.starterViewByTeam'), 'table', [state, owner, team, prio, quarter], {
        ...tableLook, showPageIcon: true, loadLimit: 25, groupBy: team.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...(development === undefined || design === undefined || people === undefined ? {} : { groupOrder: { [people.id]: positionBetween(development.position, design.position) } }),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllGoals'), 'table', all, tableLook);

    const values = (s: number, date: string, p: number, tm: number, q: number[], from: number, to: number): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      ...(due === undefined ? {} : { [due.id]: date }),
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      ...(quarter === undefined ? {} : { [quarter.id]: q.map((i) => option(quarter, i) ?? '') }),
      ...(team === undefined ? {} : { [team.id]: [option(team, tm) ?? ''] }),
      ...(start === undefined || end === undefined ? {} : { [start.id]: from, [end.id]: to }),
    });

    row(t('tools.database.starterGoalRow1'), values(1, '2025-02-26', 0, 1, [1], 15, 20));
    row(t('tools.database.starterGoalRow2'), values(0, '2025-04-16', 1, 0, [2, 3], 0, 3));
    row(t('tools.database.starterGoalRow3'), values(2, '2025-02-03', 1, 1, [0], 25, 20));
  } else if (id === 'campaign') {
    add(t('tools.database.starterCampaignName'), 'title');
    // research/33 §3.6: Owner and Budget, off by default, sit after the title and after Audiences targeted.
    const owner = features.has('owner') ? add(t('tools.database.starterOwner'), 'person') : undefined;
    const channels = features.has('channels') ? select(t('tools.database.starterChannels'), [
      [t('tools.database.starterOptionBlog'), 'green'], [t('tools.database.starterOptionEmail'), 'yellow'], [t('tools.database.starterOptionInstagram'), 'purple'],
      [t('tools.database.starterOptionX'), 'gray'], [t('tools.database.starterOptionTiktok'), 'purple'], [t('tools.database.starterOptionLinkedinCampaign'), 'blue'],
      [t('tools.database.starterOptionGoogle'), 'brown'],
    ], true) : undefined;
    const markets = features.has('markets') ? select(t('tools.database.starterMarkets'), [
      [t('tools.database.starterOptionAmer'), 'orange'], [t('tools.database.starterOptionEmea'), 'gray'], [t('tools.database.starterOptionApac'), 'purple'],
      [t('tools.database.starterOptionUk'), 'yellow'], [t('tools.database.starterOptionFr'), 'brown'], [t('tools.database.starterOptionLatam'), 'green'],
    ], true) : undefined;
    const kind = features.has('campaignType') ? select(t('tools.database.starterCampaignType'), [
      [t('tools.database.starterOptionProductLaunch'), 'gray'], [t('tools.database.starterOptionBrandAwareness'), 'brown'], [t('tools.database.starterOptionLeadGeneration'), 'blue'],
      [t('tools.database.starterOptionSalesPromotion'), 'green'], [t('tools.database.starterOptionContentMarketing'), 'yellow'], [t('tools.database.starterOptionEmailMarketing'), 'default'],
    ], true) : undefined;
    const audiences = features.has('audiences') ? select(t('tools.database.starterAudiencesTargeted'), [
      [t('tools.database.starterOptionDemographic', { number: '1' }), 'yellow'], [t('tools.database.starterOptionDemographic', { number: '2' }), 'blue'],
      [t('tools.database.starterOptionDemographic', { number: '3' }), 'red'],
    ], true) : undefined;
    const budget = features.has('budget') ? add(t('tools.database.starterBudget'), 'number', { number: { format: 'dollar' } }) : undefined;
    const completion = add(t('tools.database.starterCompletionDate'), 'date', { date: { ...FULL } });
    const files = features.has('files') ? add(t('tools.database.propertyTypeFiles'), 'files') : undefined;
    // Complete's colour menu did not open; its pill rgba(0, 96, 38, 0.157) is the one every checked Green option reads.
    const state = customStatus([
      [t('tools.database.starterOptionBlocked'), 'red', 'todo'], [t('tools.database.defaultStatusNotStarted'), undefined, 'todo'],
      [t('tools.database.starterOptionPlanning'), 'yellow', 'inProgress'], [t('tools.database.starterOptionOnHoldCampaign'), 'orange', 'inProgress'],
      [t('tools.database.starterOptionInProduction'), 'purple', 'inProgress'],
      [t('tools.database.starterOptionInFlight'), 'blue', 'complete'], [t('tools.database.starterOptionComplete'), 'green', 'complete'],
    ], 1);
    const all = [state, owner, audiences, kind, channels, markets, budget, files, completion];

    // research/33 §3.3: the switch reads on, yet the empty columns draw. Blok saves what is drawn: off.
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [owner, channels, markets, kind], {
        ...boardLook, wrapCells: false, cardPreview: files === undefined ? 'none' : `property:${files.id}`, openPagesIn: 'side', groupBy: state.id,
        groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true },
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllCampaigns'), 'table', all, tableLook);
    if (views.has('calendar')) {
      view(t('tools.database.viewTypeCalendar'), 'calendar', [], {
        calendarBy: completion.id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center',
      });
    }
    if (views.has('byMarket') && markets !== undefined) {
      view(t('tools.database.starterViewByMarket'), 'table', [state, owner, markets, kind, channels, audiences], {
        ...tableLook, showPageIcon: true, loadLimit: 25, groupBy: markets.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...groupOrder(markets, [
          t('tools.database.starterOptionApac'), t('tools.database.starterOptionFr'), t('tools.database.starterOptionLatam'), t('tools.database.starterOptionUk'),
          t('tools.database.starterOptionAmer'), t('tools.database.starterOptionEmea'), null,
        ]),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllCampaigns'), 'table', all, tableLook);

    const values = (s: number, a: number, k: number, c: number, m: number, date: string): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      [completion.id]: date,
      ...(audiences === undefined ? {} : { [audiences.id]: [option(audiences, a) ?? ''] }),
      ...(kind === undefined ? {} : { [kind.id]: [option(kind, k) ?? ''] }),
      ...(channels === undefined ? {} : { [channels.id]: [option(channels, c) ?? ''] }),
      ...(markets === undefined ? {} : { [markets.id]: [option(markets, m) ?? ''] }),
    });

    row(t('tools.database.starterCampaignRow1'), values(0, 2, 0, 3, 1, '2025-03-28'));
    row(t('tools.database.starterCampaignRow2'), values(1, 1, 3, 5, 0, '2025-03-18'));
    row(t('tools.database.starterCampaignRow3'), values(2, 0, 1, 2, 2, '2025-03-13'));
    // research/33 §3.8. The Google Drive, image and PDF placeholders are left out, as in Tasks Tracker.
    template(t('tools.database.starterNewCampaign'), [
      heading(t('tools.database.starterAboutCampaign'), 2), text(t('tools.database.starterAboutCampaignText')), text(''),
      heading(t('tools.database.starterTasksHeading'), 2), text(t('tools.database.starterCampaignTasksText')), todo(), todo(), todo(), text(''),
      heading(t('tools.database.starterRelatedFiles'), 2),
    ]);
    pin([state, owner, completion, kind], [markets, channels, audiences, files, budget]);
  } else if (id === 'contentCalendar') {
    // The "Status (1)" research/31 §7b saw was made by its script (research/33 §3.7). The order is research/33's.
    add(t('tools.database.starterContentName'), 'title');
    const owner = features.has('owner') ? add(t('tools.database.starterOwner'), 'person') : undefined;
    const kind = features.has('contentType') ? select(t('tools.database.starterContentType'), [
      [t('tools.database.starterOptionLiveStream'), 'default'], [t('tools.database.starterOptionLongFormVideo'), 'purple'],
      [t('tools.database.starterOptionShortFormVideo'), 'gray'], [t('tools.database.starterOptionSocialPost'), 'red'],
      [t('tools.database.starterOptionPodcastVideo'), 'pink'], [t('tools.database.starterOptionPodcastAudio'), 'orange'],
      [t('tools.database.starterOptionBlogArticle'), 'blue'],
    ]) : undefined;
    const platform = features.has('platform') ? select(t('tools.database.starterPlatform'), [
      [t('tools.database.starterOptionLinkedin'), 'default'], [t('tools.database.starterOptionTiktok'), 'yellow'], [t('tools.database.starterOptionX'), 'blue'],
      [t('tools.database.starterOptionYoutube'), 'gray'], [t('tools.database.starterOptionInstagram'), 'purple'], [t('tools.database.starterOptionSpotify'), 'pink'],
      [t('tools.database.starterOptionEmail'), 'red'], [t('tools.database.starterOptionBlogWebsite'), 'orange'],
    ], true) : undefined;
    const accounts = features.has('accounts') ? select(t('tools.database.starterAccounts'), [
      [t('tools.database.starterOptionAccount', { number: '1' }), 'gray'], [t('tools.database.starterOptionAccount', { number: '2' }), 'red'],
      [t('tools.database.starterOptionAccount', { number: '3' }), 'blue'],
    ], true) : undefined;
    const film = add(t('tools.database.starterFilmDate'), 'date', { date: { ...FULL } });
    const url = features.has('postUrl') ? add(t('tools.database.starterPostUrl'), 'url') : undefined;
    const publish = features.has('publishDate') ? add(t('tools.database.starterPublishDate'), 'date', { date: { ...FULL } }) : undefined;
    // Published and On hold: their colour menus did not open. Their pills are the Green and the Brown one
    // (rgba(0, 96, 38, 0.157) and rgba(127, 51, 0, 0.157), as every checked Green and Brown option reads).
    const state = customStatus([
      [t('tools.database.starterOptionIdea'), undefined, 'todo'],
      [t('tools.database.starterOptionDrafting'), 'yellow', 'inProgress'], [t('tools.database.starterOptionFilming'), 'red', 'inProgress'],
      [t('tools.database.starterOptionEditing'), 'orange', 'inProgress'], [t('tools.database.starterOptionReadyForReview'), 'purple', 'inProgress'],
      [t('tools.database.starterOptionInReview'), 'pink', 'inProgress'], [t('tools.database.starterOptionApprovedForPublishing'), 'blue', 'inProgress'],
      [t('tools.database.starterOptionScheduled'), 'orange', 'inProgress'],
      [t('tools.database.starterOptionPublished'), 'green', 'complete'], [t('tools.database.starterOptionOnHold'), 'brown', 'complete'],
    ], 0);
    const newestFirst = (): ViewCreateConfig => sortBy([publish, 'desc']);
    const all = [owner, state, film, publish, kind, platform, accounts, url];

    if (views.has('calendar')) {
      view(t('tools.database.viewTypeCalendar'), 'calendar', [], {
        calendarBy: film.id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center', ...newestFirst(),
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllContent'), 'table', all, { ...tableLook, wrapCells: true, ...newestFirst() });
    // research/33 §3.3: as Campaign Management's board, the empty columns draw.
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [owner, kind, platform, accounts], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true }, ...newestFirst(),
      });
    }
    if (views.has('byPlatform') && platform !== undefined) {
      view(t('tools.database.starterViewByPlatform'), 'table', all, {
        ...tableLook, showPageIcon: true, wrapCells: true, loadLimit: 25, ...newestFirst(), groupBy: platform.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...groupOrder(platform, [
          t('tools.database.starterOptionInstagram'), t('tools.database.starterOptionLinkedin'), t('tools.database.starterOptionX'), t('tools.database.starterOptionBlogWebsite'),
          t('tools.database.starterOptionEmail'), t('tools.database.starterOptionSpotify'), t('tools.database.starterOptionTiktok'), t('tools.database.starterOptionYoutube'), null,
        ]),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllContent'), 'table', all, { ...tableLook, wrapCells: true, ...newestFirst() });

    const values = (s: number, filmed: string, published: string, k: number, p: number[]): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      [film.id]: filmed,
      ...(publish === undefined ? {} : { [publish.id]: published }),
      ...(kind === undefined ? {} : { [kind.id]: option(kind, k) }),
      ...(platform === undefined ? {} : { [platform.id]: p.map((i) => option(platform, i) ?? '') }),
      // As the cell showed it. Blok links a scheme-less address to http://x.com/NotionHQ.
      ...(url === undefined ? {} : { [url.id]: 'x.com/NotionHQ' }),
    });

    row(t('tools.database.starterContentRow1'), values(0, '2025-03-11', '2025-03-28', 2, [3]));
    row(t('tools.database.starterContentRow2'), values(6, '2025-02-19', '2025-03-27', 3, [4]));
    row(t('tools.database.starterContentRow3'), values(8, '2025-02-10', '2025-02-13', 6, [0, 7]));
    template(t('tools.database.starterNewContent'), [
      heading(t('tools.database.starterContentOverview'), 2), text(t('tools.database.starterContentOverviewText')), text(''),
      heading(t('tools.database.starterToDos'), 2), todo(), todo(), todo(), text(''),
      heading(t('tools.database.starterNotes'), 2), bullet(), bullet(),
    ]);
    pin([state, owner, kind, url], [publish, platform, accounts, film]);
  } else if (id === 'events') {
    add(t('tools.database.starterEventName'), 'title');
    const date = add(t('tools.database.starterEventDate'), 'date', { date: { ...FULL } });
    const state = customStatus([
      [t('tools.database.defaultStatusNotStarted'), undefined, 'todo'],
      [t('tools.database.starterOptionPlanning'), 'blue', 'inProgress'], [t('tools.database.starterOptionPendingReview'), 'pink', 'inProgress'],
      [t('tools.database.starterOptionRegistrationOpen'), 'yellow', 'inProgress'],
      [t('tools.database.defaultStatusDone'), 'green', 'complete'], [t('tools.database.starterOptionCancelled'), 'red', 'complete'],
    ], 0);
    const owner = features.has('owner') ? add(t('tools.database.starterEventOwner'), 'person') : undefined;
    const format = features.has('format') ? select(t('tools.database.starterFormat'), [
      [t('tools.database.starterOptionInPerson'), 'purple'], [t('tools.database.starterOptionVirtual'), 'green'],
    ]) : undefined;
    // Retreat's colour menu click missed; its pill is the Purple one.
    const category = features.has('category') ? select(t('tools.database.starterCategory'), [
      [t('tools.database.starterOptionWebinar'), 'green'], [t('tools.database.starterOptionConference'), 'gray'], [t('tools.database.starterOptionTradeshow'), 'red'],
      [t('tools.database.starterOptionWorkshop'), 'default'], [t('tools.database.starterOptionInternalEvent'), 'blue'], [t('tools.database.starterOptionPartnerEvent'), 'yellow'],
      [t('tools.database.starterOptionCommunityMeetup'), 'orange'], [t('tools.database.starterOptionTeamBuilding'), 'pink'], [t('tools.database.starterOptionRetreat'), 'purple'],
    ]) : undefined;
    const venue = features.has('venue') ? select(t('tools.database.starterVenue'), [
      [t('tools.database.starterOptionVenue', { number: '1' }), 'yellow'], [t('tools.database.starterOptionVenue', { number: '2' }), 'orange'],
      [t('tools.database.starterOptionVenue', { number: '3' }), 'default'],
    ]) : undefined;
    const capacity = features.has('capacity') ? add(t('tools.database.starterCapacity'), 'number') : undefined;
    const budget = features.has('budget') ? add(t('tools.database.starterBudget'), 'number', { number: { format: 'dollar' } }) : undefined;
    const url = features.has('url') ? add(t('tools.database.starterEventUrl'), 'url') : undefined;
    const all = schema.slice(1);
    const listed = [category, format, state, url, date, owner, budget, venue, capacity];

    if (views.has('all')) view(t('tools.database.starterViewAllEvents'), 'table', all, { ...tableLook, ...sortBy([date, 'desc']) });
    // research/33 §3.3: the switch reads on, yet the empty columns draw. Blok saves what is drawn: off.
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [owner, format, category, date, venue], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true }, ...sortBy([date, 'desc']),
      });
    }
    if (views.has('calendar')) {
      view(t('tools.database.viewTypeCalendar'), 'calendar', [], { calendarBy: date.id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center' });
    }
    if (views.has('byCategory') && category !== undefined) {
      view(t('tools.database.starterViewByCategory'), 'table', listed, {
        ...tableLook, showPageIcon: true, wrapCells: true, loadLimit: 25, ...sortBy([date, 'desc']), groupBy: category.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...groupOrder(category, [
          t('tools.database.starterOptionConference'), t('tools.database.starterOptionRetreat'), t('tools.database.starterOptionTradeshow'), null,
          t('tools.database.starterOptionWebinar'), t('tools.database.starterOptionWorkshop'), t('tools.database.starterOptionCommunityMeetup'),
          t('tools.database.starterOptionInternalEvent'), t('tools.database.starterOptionPartnerEvent'), t('tools.database.starterOptionTeamBuilding'),
        ]),
      });
    }
    if (views.has('mine') && owner !== undefined) view(t('tools.database.starterViewMyEvents'), 'table', listed, { ...tableLook, showPageIcon: true, ...mine(owner) });
    if (viewList.length === 0) view(t('tools.database.starterViewAllEvents'), 'table', all, { ...tableLook, ...sortBy([date, 'desc']) });

    const values = (day: string, s: number, f: number, c: number, v: number, seats: number, money: number, link?: string): Record<string, PropertyValue | undefined> => ({
      [date.id]: day,
      [state.id]: option(state, s) ?? null,
      ...(format === undefined ? {} : { [format.id]: option(format, f) }),
      ...(category === undefined ? {} : { [category.id]: option(category, c) }),
      ...(venue === undefined ? {} : { [venue.id]: option(venue, v) }),
      ...(capacity === undefined ? {} : { [capacity.id]: seats }),
      ...(budget === undefined ? {} : { [budget.id]: money }),
      ...(url === undefined || link === undefined ? {} : { [url.id]: link }),
    });

    // Event owner is empty; rows 2 and 3 have "a notion.so URL" that was not read, so it is left out.
    row(t('tools.database.starterEventRow1'), values('2025-09-16', 3, 0, 6, 2, 2000, 500000, 'makewithnotion.com/'));
    row(t('tools.database.starterEventRow2'), values('2025-03-13', 1, 0, 4, 1, 100, 10000));
    row(t('tools.database.starterEventRow3'), values('2025-02-12', 4, 1, 6, 0, 50, 5000));
    // research/33 §3.8. The image, PDF and Google Drive placeholders are left out, as in Tasks Tracker.
    template(t('tools.database.starterNewEvent'), [
      heading(t('tools.database.starterAboutEvent'), 2), text(t('tools.database.starterAboutEventText')), text(''),
      heading(t('tools.database.starterTasksHeading'), 2), text(t('tools.database.starterEventTasksText')), todo(), todo(), todo(), text(''),
      heading(t('tools.database.starterNotes'), 2), bullet(), bullet(), bullet(), text(''),
      heading(t('tools.database.starterSupportingFiles'), 2),
    ]);
    pin([state, date, owner, category], [format, venue, budget, capacity, url]);
  } else if (id === 'socialMedia') {
    add(t('tools.database.starterPostName'), 'title');
    const kind = features.has('contentType') ? select(t('tools.database.starterContentType'), [
      [t('tools.database.starterOptionText'), 'yellow'], [t('tools.database.starterOptionImagePhoto'), 'orange'], [t('tools.database.starterOptionVideo'), 'blue'],
      [t('tools.database.starterOptionLink'), 'purple'], [t('tools.database.starterOptionCarousel'), 'red'], [t('tools.database.starterOptionPoll'), 'brown'],
      [t('tools.database.starterOptionStory'), 'gray'], [t('tools.database.starterOptionLiveStream'), 'pink'],
    ], true) : undefined;
    const owner = features.has('owner') ? add(t('tools.database.starterOwner'), 'person') : undefined;
    const platform = features.has('platform') ? select(t('tools.database.starterPlatform'), [
      [t('tools.database.starterOptionLinkedinCampaign'), 'brown'], [t('tools.database.starterOptionTikTok'), 'default'], [t('tools.database.starterOptionX'), 'blue'],
      [t('tools.database.starterOptionYoutube'), 'red'], [t('tools.database.starterOptionInstagram'), 'green'],
    ], true) : undefined;
    const url = features.has('postUrl') ? add(t('tools.database.starterPostUrl'), 'url') : undefined;
    const date = add(t('tools.database.starterPostDate'), 'date', { date: { ...FULL } });
    const state = customStatus([
      [t('tools.database.starterOptionPostIdea'), undefined, 'todo'],
      [t('tools.database.starterOptionDraft'), 'yellow', 'inProgress'], [t('tools.database.starterOptionReadyForReviewTitle'), 'purple', 'inProgress'],
      [t('tools.database.starterOptionScheduled'), 'blue', 'inProgress'],
      [t('tools.database.starterOptionPublished'), 'green', 'complete'], [t('tools.database.starterOptionCancelled'), 'red', 'complete'],
    ], 0);
    const audiences = features.has('audiences') ? select(t('tools.database.starterTargetAudiences'), [
      [t('tools.database.starterOptionSegment', { number: '1' }), 'purple'], [t('tools.database.starterOptionSegment', { number: '2' }), 'yellow'],
      [t('tools.database.starterOptionSegment', { number: '3' }), 'gray'],
    ], true) : undefined;
    const newestFirst = (): ViewCreateConfig => sortBy([date, 'desc']);
    const posts = [owner, state, date, platform, kind, audiences, url];

    if (views.has('calendar')) {
      view(t('tools.database.viewTypeCalendar'), 'calendar', [], { calendarBy: date.id, calendarRange: 'month', showWeekends: false, showPageIcon: true, wrapCells: false, openPagesIn: 'center' });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllPosts'), 'table', posts, { ...tableLook, wrapCells: true, ...newestFirst() });
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [date, platform, owner], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true }, ...newestFirst(),
      });
    }
    // Its Group page was not read: Blok's group defaults.
    if (views.has('byPlatform') && platform !== undefined) {
      view(t('tools.database.starterViewByPlatform'), 'table', [state, owner, date, kind], { ...tableLook, showPageIcon: true, loadLimit: 25, groupBy: platform.id, ...newestFirst() });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllPosts'), 'table', posts, { ...tableLook, wrapCells: true, ...newestFirst() });

    const values = (s: number, day: string, k: number[], p: number[]): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      [date.id]: day,
      ...(kind === undefined ? {} : { [kind.id]: k.map((i) => option(kind, i) ?? '') }),
      ...(platform === undefined ? {} : { [platform.id]: p.map((i) => option(platform, i) ?? '') }),
    });

    row(t('tools.database.starterPostRow1'), values(0, '2025-03-12', [2], [0, 2]));
    row(t('tools.database.starterPostRow2'), values(3, '2025-03-05', [1, 2], [0, 3, 2]));
    row(t('tools.database.starterPostRow3'), values(4, '2025-02-13', [4, 0], [0, 4, 2]));
    template(t('tools.database.starterNewPost'), [
      heading(t('tools.database.starterRequestOverview'), 1), text(t('tools.database.starterRequestOverviewText')),
      heading(t('tools.database.starterContentDescription'), 1), text(t('tools.database.starterContentDescriptionText')),
      heading(t('tools.database.starterResourceNeeds'), 1), text(t('tools.database.starterResourceNeedsText')),
      heading(t('tools.database.starterRequestStatus'), 1), text(t('tools.database.starterRequestStatusText')), text(''),
    ]);
    pin([state, owner, date, platform, url], [kind, audiences]);
  } else if (id === 'issues') {
    add(t('tools.database.starterIssue'), 'title');
    const assignee = add(t('tools.database.starterAssignedTo'), 'person');
    const type = features.has('type') ? select(t('tools.database.starterType'), [
      [t('tools.database.starterOptionSecurity'), 'yellow'], [t('tools.database.starterOptionTechnicalDebt'), 'gray'],
      [t('tools.database.starterOptionFeatureRequest'), 'brown'], [t('tools.database.starterOptionBug'), 'pink'],
    ], true) : undefined;
    const prio = select(t('tools.database.starterPriority'), [
      [t('tools.database.starterOptionHigh'), 'red'], [t('tools.database.starterOptionMediumPriority'), 'yellow'], [t('tools.database.starterOptionLow'), 'default'],
    ]);
    const created = add(t('tools.database.propertyTypeCreatedTime'), 'createdTime', { date: { ...FULL } });
    const daysOpen = features.has('daysOpen') ? add(t('tools.database.starterDaysOpen'), 'formula') : undefined;
    const due = features.has('dueDate') ? add(t('tools.database.starterDueDate'), 'date', { date: { ...FULL } }) : undefined;
    const open = t('tools.database.starterOptionOpen');
    const state = customStatus([
      [t('tools.database.starterOptionBacklog'), 'gray', 'todo'], [open, undefined, 'todo'],
      [t('tools.database.defaultStatusInProgress'), 'blue', 'inProgress'], [t('tools.database.starterOptionInReview'), 'brown', 'inProgress'],
      [t('tools.database.starterOptionTesting'), 'purple', 'inProgress'],
      [t('tools.database.starterOptionWontFix'), 'red', 'complete'], [t('tools.database.starterOptionResolved'), 'green', 'complete'],
    ], 1);

    // research/33 §3.12. A status reads as its label, so "Open" is the localized option name.
    if (daysOpen !== undefined) {
      const days = `dateBetween(now(), {{property:${created.id}}}, "days")`;
      const [before, after] = t('tools.database.starterDaysCount', { count: '\u0000' }).split('\u0000');

      daysOpen.formula = {
        expression: `if({{property:${state.id}}} == ${JSON.stringify(open)}, if(${days} == 1, ${JSON.stringify(t('tools.database.starterOneDay'))}, `
          + `${JSON.stringify(before)} + format(${days}) + ${JSON.stringify(after ?? '')}), ${JSON.stringify(t('tools.database.starterIssueClosed'))})`,
      };
    }
    const byPriority = (): ViewCreateConfig => ({ groupBy: prio.id, groupSettings: { sort: 'manual', hideEmptyGroups: true } });

    if (views.has('kanban')) {
      view(t('tools.database.starterViewKanban'), 'board', [assignee, type, prio], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true }, ...sortBy([created, 'desc']),
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllIssues'), 'table', [assignee, state, type, prio, created, due, daysOpen], { ...tableLook, ...sortBy([created, 'desc']) });
    // Hide empty groups reads on in the three Priority views; whether Notion applies it there was not measured.
    if (views.has('mine')) {
      view(t('tools.database.starterViewMyIssues'), 'list', [state, daysOpen, assignee, type, created], {
        showPageIcon: true, loadLimit: 25, openPagesIn: 'side', ...mine(assignee), ...sortBy([created, 'asc']), ...byPriority(),
      });
    }
    const triage = [assignee, state, type, created, due, daysOpen];
    const triageLook = { ...tableLook, showPageIcon: true, wrapCells: true, loadLimit: 25 } as const;

    if (views.has('untriaged')) view(t('tools.database.starterViewUntriaged'), 'table', triage, { ...triageLook, ...where(assignee, 'is_empty', null), ...sortBy([created, 'desc']), ...byPriority() });
    if (views.has('completed')) view(t('tools.database.starterViewCompleted'), 'table', triage, { ...triageLook, ...where(state, 'equals', ['complete']), ...sortBy([created, 'desc']), ...byPriority() });
    if (viewList.length === 0) view(t('tools.database.starterViewAllIssues'), 'table', [assignee, state, type, prio, created, due, daysOpen], { ...tableLook, ...sortBy([created, 'desc']) });
    template(t('tools.database.starterNewIssue'));
  } else if (id === 'featureRequests') {
    add(t('tools.database.starterRequestName'), 'title');
    const assignee = add(t('tools.database.starterAssignedTo'), 'person');
    const effort = features.has('effort') ? select(t('tools.database.starterEstimatedEffort'), [
      [t('tools.database.starterOptionSizeXl'), 'red'], [t('tools.database.starterOptionSizeL'), 'orange'], [t('tools.database.starterOptionSizeM'), 'yellow'],
      [t('tools.database.starterOptionSizeS'), 'default'],
    ]) : undefined;
    const prio = features.has('priority') ? priority() : undefined;
    const area = features.has('productArea') ? select(t('tools.database.starterProductArea'), [
      [t('tools.database.starterOptionMobile'), 'pink'], [t('tools.database.starterOptionGrowth'), 'green'], [t('tools.database.starterOptionAi'), 'orange'],
      [t('tools.database.starterOptionOther'), 'purple'],
    ], true) : undefined;
    const files = features.has('files') ? add(t('tools.database.starterRelatedFiles'), 'files') : undefined;
    const requestedBy = features.has('requestedBy') ? add(t('tools.database.starterRequestedBy'), 'person') : undefined;
    const requested = features.has('requestedDate') ? add(t('tools.database.starterRequestedDate'), 'createdTime', { date: { ...FULL } }) : undefined;
    const state = customStatus([
      [t('tools.database.starterOptionNew'), undefined, 'todo'],
      [t('tools.database.starterOptionUnderReview'), 'yellow', 'inProgress'], [t('tools.database.starterOptionPlanned'), 'brown', 'inProgress'],
      [t('tools.database.starterOptionInDevelopment'), 'blue', 'inProgress'],
      [t('tools.database.starterOptionLaunched'), 'green', 'complete'], [t('tools.database.starterOptionDeclined'), 'red', 'complete'],
    ], 0);
    const newestFirst = (): ViewCreateConfig => sortBy([requested, 'desc']);
    const requests = [requestedBy, state, area, prio, requested, effort, files, assignee];
    const look = { ...tableLook, showPageIcon: true } as const;

    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [], { ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true } });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllRequests'), 'table', requests, { ...tableLook, ...newestFirst() });
    if (views.has('mine')) view(t('tools.database.starterViewAssignedToMe'), 'table', [state, assignee, prio, area, effort], { ...look, ...mine(assignee), ...newestFirst() });
    if (views.has('high') && prio !== undefined) {
      view(t('tools.database.starterViewHighPriorityRequests'), 'table', [state, assignee, prio, effort, area], {
        ...look, ...where(prio, 'equals', optionIds(prio, [t('tools.database.starterOptionHigh')])), ...newestFirst(),
      });
    }
    if (views.has('unassigned')) {
      view(t('tools.database.starterViewNewUnassignedRequests'), 'table', [assignee, state, requested, prio, area], { ...look, ...where(assignee, 'is_empty', null), ...newestFirst() });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllRequests'), 'table', requests, { ...tableLook, ...newestFirst() });
    template(t('tools.database.starterNewRequest'));
  } else if (id === 'engineeringDocs') {
    add(t('tools.database.starterDocName'), 'title');
    const author = features.has('author') ? add(t('tools.database.starterAuthor'), 'person', { person: { default: 'createdBy' } }) : undefined;
    const published = t('tools.database.starterOptionPublished');
    const state = customStatus([
      [t('tools.database.starterOptionDraft'), undefined, 'todo'], [t('tools.database.starterOptionInReviewTitle'), 'blue', 'inProgress'],
      [published, 'green', 'complete'], [t('tools.database.starterOptionOutdated'), 'brown', 'complete'],
    ], 0);
    const category = select(t('tools.database.starterCategory'), [
      [t('tools.database.starterOptionTechSpec'), 'pink'], [t('tools.database.starterOptionPrd'), 'default'], [t('tools.database.starterOptionGuide'), 'yellow'],
      [t('tools.database.starterOptionBestPractices'), 'orange'], [t('tools.database.starterOptionArchitecture'), 'blue'],
    ], true);
    if (features.has('reviewers')) add(t('tools.database.starterReviewers'), 'person');
    if (features.has('createdTime')) add(t('tools.database.propertyTypeCreatedTime'), 'createdTime', { date: { ...FULL } });
    const edited = features.has('lastEdited') ? add(t('tools.database.propertyTypeLastEditedTime'), 'lastEditedTime', { date: { dateFormat: 'relative', timeFormat: '12_hour' } }) : undefined;
    const all = schema.slice(1);
    const look = { ...tableLook, showPageIcon: true, wrapCells: true } as const;
    const recentFirst = (): ViewCreateConfig => sortBy([edited, 'desc']);

    if (views.has('all')) view(t('tools.database.starterViewAllDocs'), 'table', all, { ...tableLook, wrapCells: true, ...recentFirst() });
    if (views.has('published')) {
      view(t('tools.database.starterViewPublishedDocs'), 'list', [category, author, edited], {
        showPageIcon: true, loadLimit: 50, openPagesIn: 'side', ...where(state, 'equals', optionIds(state, [published])), ...recentFirst(),
      });
    }
    if (views.has('byCategory')) {
      view(t('tools.database.starterViewDocsByCategory'), 'table', [author, state], {
        ...look, loadLimit: 25, ...recentFirst(), groupBy: category.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...groupOrder(category, [
          t('tools.database.starterOptionPrd'), t('tools.database.starterOptionTechSpec'), t('tools.database.starterOptionArchitecture'),
          t('tools.database.starterOptionBestPractices'), t('tools.database.starterOptionGuide'), null,
        ]),
      });
    }
    if (views.has('recent')) view(t('tools.database.starterViewRecentlyEdited'), 'table', [category, state, author, edited], { ...look, ...recentFirst() });
    if (views.has('mine') && author !== undefined) view(t('tools.database.starterViewMyDocs'), 'table', [category, state, edited], { ...look, ...mine(author), ...recentFirst() });
    if (viewList.length === 0) view(t('tools.database.starterViewAllDocs'), 'table', all, { ...tableLook, wrapCells: true, ...recentFirst() });
    // The second template's body was not opened (research/33 §3.13): it starts empty.
    template(t('tools.database.starterNewDocument'));
    template(t('tools.database.starterGuideTemplate'));
  } else if (id === 'fundraising') {
    add(t('tools.database.starterInvestorName'), 'title');
    const partnerEmail = features.has('partnerEmail') ? add(t('tools.database.starterPartnerEmail'), 'email') : undefined;
    const warmEmail = features.has('warmEmail') ? add(t('tools.database.starterWarmContactEmail'), 'email') : undefined;
    const checkSize = features.has('checkSize') ? add(t('tools.database.starterAverageCheckSize'), 'number', { number: { format: 'dollar' } }) : undefined;
    const capital = features.has('capital') ? add(t('tools.database.starterCapitalCommitted'), 'number', { number: { format: 'dollar' } }) : undefined;
    const description = features.has('description') ? add(t('tools.database.formQuestionDescription'), 'text') : undefined;
    const linkedin = features.has('linkedin') ? add(t('tools.database.starterFirmLinkedin'), 'text') : undefined;
    const lastContact = features.has('lastContact') ? add(t('tools.database.starterLastContactDate'), 'date', { date: { ...FULL } }) : undefined;
    const lostReason = features.has('lostReason') ? add(t('tools.database.starterLostReason'), 'text') : undefined;
    const partnerName = features.has('partnerName') ? add(t('tools.database.starterPartnerName'), 'text') : undefined;
    const portfolio = features.has('portfolio') ? add(t('tools.database.starterPortfolio'), 'text') : undefined;
    const won = t('tools.database.starterOptionWon');
    const lost = t('tools.database.starterOptionLost');
    const state = customStatus([
      [t('tools.database.defaultStatusNotStarted'), undefined, 'todo'],
      [t('tools.database.starterOptionDiligence'), 'blue', 'inProgress'], [t('tools.database.starterOptionPitched'), 'yellow', 'inProgress'],
      [won, 'green', 'complete'], [lost, 'red', 'complete'],
    ], 0);
    const warmName = features.has('warmName') ? add(t('tools.database.starterWarmContactName'), 'text') : undefined;
    const all = schema.slice(1);
    const investors = [state, capital, partnerName, partnerEmail, warmName, warmEmail, checkSize, description, portfolio, linkedin, lostReason, lastContact];
    const look = { ...tableLook, showPageIcon: true } as const;

    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [partnerEmail, warmEmail], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true },
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllInvestors'), 'table', investors, { ...tableLook, ...sortBy([lastContact, 'asc']) });
    if (views.has('won')) view(t('tools.database.starterViewWon'), 'table', all, { ...look, ...where(state, 'equals', optionIds(state, [won])) });
    if (views.has('lost')) view(t('tools.database.starterViewLost'), 'table', all, { ...look, ...where(state, 'equals', optionIds(state, [lost])) });
    // The filter names the In progress status group: there is no option of that name.
    if (views.has('inProgress')) view(t('tools.database.starterViewInProgress'), 'table', investors, { ...look, ...where(state, 'equals', ['inProgress']) });
    if (viewList.length === 0) view(t('tools.database.starterViewAllInvestors'), 'table', investors, { ...tableLook, ...sortBy([lastContact, 'asc']) });
    template(t('tools.database.starterNewInvestor'));
  } else if (id === 'pipeline') {
    add(t('tools.database.defaultSourceTitleProperty'), 'title');
    const owner = features.has('owner') ? add(t('tools.database.starterAccountOwner'), 'person') : undefined;
    const prio = features.has('priority') ? select(t('tools.database.starterPriorityLevel'), [
      [t('tools.database.starterOptionLow'), 'gray'], [t('tools.database.starterOptionMediumPriority'), 'blue'], [t('tools.database.starterOptionHigh'), 'purple'],
    ]) : undefined;
    // Filled in below, once Last contact date exists: the formula reads it (research/33 §3.12).
    const daysSince = features.has('daysSince') && features.has('lastContact') ? add(t('tools.database.starterDaysSinceLastContact'), 'formula') : undefined;
    const discovery = t('tools.database.starterOptionDiscovery');
    const negotiation = t('tools.database.starterOptionNegotiation');
    const stage = select(t('tools.database.starterDealStage'), [
      [t('tools.database.starterOptionNew'), 'green'], [discovery, 'red'], [negotiation, 'orange'],
      [t('tools.database.starterOptionWon'), 'blue'], [t('tools.database.starterOptionLost'), 'pink'],
    ]);
    const value = features.has('value') ? add(t('tools.database.starterDealValue'), 'number', { number: { format: 'dollar' } }) : undefined;
    const decisionMaker = features.has('decisionMaker') ? add(t('tools.database.starterDecisionMaker'), 'person') : undefined;
    const email = features.has('email') ? add(t('tools.database.propertyTypeEmail'), 'email') : undefined;
    const close = features.has('closeDate') ? add(t('tools.database.starterExpectedCloseDate'), 'date', { date: { ...FULL } }) : undefined;
    const lastContact = features.has('lastContact') ? add(t('tools.database.starterLastContactDate'), 'date', { date: { ...FULL } }) : undefined;
    const source = features.has('leadSource') ? select(t('tools.database.starterLeadSource'), [
      [t('tools.database.starterOptionInbound'), 'gray'], [t('tools.database.starterOptionOutbound'), 'orange'], [t('tools.database.starterOptionReferral'), 'blue'],
      [t('tools.database.starterOptionEvent'), 'purple'], [t('tools.database.starterOptionPartner'), 'pink'], [t('tools.database.starterOptionWebsite'), 'green'],
    ], true) : undefined;
    const notes = features.has('notes') ? add(t('tools.database.starterNotes'), 'text') : undefined;
    const phone = features.has('phone') ? add(t('tools.database.starterPhoneNumber'), 'phone') : undefined;

    if (daysSince !== undefined && lastContact !== undefined) daysSince.formula = { expression: `dateBetween(now(), {{property:${lastContact.id}}}, "days")` };
    const deals = [owner, stage, prio, value, email, phone, notes, close, lastContact, source, decisionMaker, daysSince];
    const look = { ...tableLook, showPageIcon: true } as const;

    if (views.has('byStage')) {
      view(t('tools.database.starterViewByDealStage'), 'board', [owner, prio], { ...boardLook, openPagesIn: 'side', groupBy: stage.id, groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true } });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllDeals'), 'table', deals, { ...tableLook, wrapCells: true });
    if (views.has('active')) view(t('tools.database.starterViewActiveDeals'), 'table', deals, { ...look, ...where(stage, 'equals', optionIds(stage, [discovery, negotiation])) });
    if (views.has('recent')) {
      view(t('tools.database.starterViewRecentlyContacted'), 'table', [daysSince, owner, stage, prio, value, email, phone, close, lastContact, source], { ...look, ...sortBy([daysSince, 'desc']) });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllDeals'), 'table', deals, { ...tableLook, wrapCells: true });
    template(t('tools.database.starterNewDeal'));
  } else if (id === 'accounts') {
    add(t('tools.database.starterAccountName'), 'title');
    const manager = features.has('manager') ? add(t('tools.database.starterAccountManager'), 'person') : undefined;
    const products = features.has('products') ? select(t('tools.database.starterProductCategories'), [
      [t('tools.database.starterOptionBaseSubscription'), 'blue'], [t('tools.database.starterOptionAnalytics'), 'pink'], [t('tools.database.starterOptionCustomIntegrations'), 'brown'],
    ], true) : undefined;
    const email = features.has('email') ? add(t('tools.database.starterContactEmail'), 'email') : undefined;
    const contract = features.has('value') ? add(t('tools.database.starterContractValue'), 'number', { number: { format: 'dollar' } }) : undefined;
    const lastContact = features.has('lastContact') ? add(t('tools.database.starterLastContactDate'), 'date', { date: { ...FULL } }) : undefined;
    const notes = features.has('notes') ? add(t('tools.database.starterNotes'), 'text') : undefined;
    const phone = features.has('phone') ? add(t('tools.database.starterPhoneNumber'), 'phone') : undefined;
    const region = select(t('tools.database.starterRegion'), [
      [t('tools.database.starterOptionAmer'), 'blue'], [t('tools.database.starterOptionEmea'), 'pink'], [t('tools.database.starterOptionApac'), 'green'],
    ], true);
    const active = t('tools.database.starterOptionActive');
    const state = select(t('tools.database.defaultStatusProperty'), [
      [active, 'brown'], [t('tools.database.starterOptionAtRisk'), 'pink'], [t('tools.database.starterOptionPendingRenewal'), 'green'],
      [t('tools.database.starterOptionOnHoldCampaign'), 'orange'], [t('tools.database.starterOptionChurned'), 'yellow'],
    ]);
    const look = { ...tableLook, showPageIcon: true } as const;

    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [manager, products], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true },
        ...groupOrder(state, [
          active, t('tools.database.starterOptionChurned'), t('tools.database.starterOptionPendingRenewal'), t('tools.database.starterOptionAtRisk'),
          t('tools.database.starterOptionOnHoldCampaign'), null,
        ]),
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllAccounts'), 'table', [manager, state, contract, email, lastContact, phone, products, notes, region], { ...tableLook, wrapCells: true });
    if (views.has('byRegion')) {
      view(t('tools.database.starterViewByRegion'), 'table', [manager, state, contract, email, lastContact, phone, notes, products, region], {
        ...look, loadLimit: 25, groupBy: region.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...groupOrder(region, [t('tools.database.starterOptionAmer'), t('tools.database.starterOptionApac'), t('tools.database.starterOptionEmea'), null]),
      });
    }
    if (views.has('active')) {
      view(t('tools.database.starterViewActiveAccounts'), 'table', [manager, state, contract, email, lastContact, phone, region, notes, products], { ...look, ...where(state, 'equals', optionIds(state, [active])) });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllAccounts'), 'table', [manager, state, contract, email, lastContact, phone, products, notes, region], { ...tableLook, wrapCells: true });
    template(t('tools.database.starterNewAccount'));
  } else if (id === 'creative') {
    add(t('tools.database.starterProjectName'), 'title');
    const owner = add(t('tools.database.starterOwner'), 'person');
    const kinds: Array<[string, string]> = [
      [t('tools.database.starterOptionVideo'), 'red'], [t('tools.database.starterOptionPhotography'), 'default'], [t('tools.database.starterOptionIllustration'), 'orange'],
      [t('tools.database.starterOptionPrint'), 'brown'], [t('tools.database.starterOptionSignage'), 'pink'], [t('tools.database.starterOptionBranding'), 'gray'],
      [t('tools.database.starterOptionMotion'), 'purple'], [t('tools.database.starterOptionWebsite'), 'blue'], [t('tools.database.starterOptionSoundMusic'), 'green'],
      [t('tools.database.starterOptionOther'), 'yellow'],
    ];
    const kind = features.has('creativeType') ? select(t('tools.database.starterCreativeType'), kinds, true) : undefined;
    const assets = features.has('assets') ? add(t('tools.database.starterAssets'), 'files') : undefined;
    const end = features.has('end') ? add(t('tools.database.dateEnd'), 'date', { date: { ...FULL } }) : undefined;
    const prio = features.has('priority') ? select(t('tools.database.starterPriority'), [
      [t('tools.database.starterOptionLow'), 'blue'], [t('tools.database.starterOptionMediumPriority'), 'yellow'], [t('tools.database.starterOptionHigh'), 'red'],
    ]) : undefined;
    const start = features.has('start') ? add(t('tools.database.dateStart'), 'date', { date: { ...FULL } }) : undefined;
    const state = customStatus([
      [t('tools.database.defaultStatusNotStarted'), undefined, 'todo'],
      [t('tools.database.defaultStatusInProgress'), 'blue', 'inProgress'], [t('tools.database.starterOptionNeedsReview'), 'yellow', 'inProgress'],
      [t('tools.database.starterOptionInReview'), 'purple', 'inProgress'],
      [t('tools.database.defaultStatusDone'), 'green', 'complete'],
    ], 0);
    const look = { ...tableLook, showPageIcon: true } as const;
    const projects = [prio, owner, state, start, end, kind, assets];

    // Hide empty groups reads on here; that the empty columns still draw is inferred from §3.3.
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [owner, kind], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true },
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllProjects'), 'table', projects, { ...tableLook, ...sortBy([start, 'desc']) });
    if (views.has('mine')) view(t('tools.database.starterViewMyProjects'), 'table', [state, prio, kind, assets], { ...look, ...mine(owner) });
    // "Separate start and end dates" off: the bar runs on Start date alone.
    if (views.has('timeline') && start !== undefined) {
      view(t('tools.database.viewTypeTimeline'), 'timeline', [], { timelineBy: start.id, showTimelineTable: false, showPageIcon: true, loadLimit: 50, openPagesIn: 'side', ...sortBy([start, 'asc']) });
    }
    if (views.has('byType') && kind !== undefined) {
      const alphabetical = [...kinds.map(([label]) => label)].sort((a, b) => a.localeCompare(b));

      view(t('tools.database.starterViewByType'), 'table', [owner, state, start, end, kind, assets], {
        ...look, loadLimit: 25, ...sortBy([start, 'desc']), groupBy: kind.id, groupSettings: { sort: 'manual', hideEmptyGroups: false }, ...groupOrder(kind, [...alphabetical, null]),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllProjects'), 'table', projects, { ...tableLook, ...sortBy([start, 'desc']) });
    template(t('tools.database.starterNewProject'));
  } else if (id === 'inventory') {
    // Notion lists ID before Name. Blok keeps the title first in the schema and the views.
    add(t('tools.database.defaultSourceTitleProperty'), 'title');
    const uid = features.has('id') ? add(t('tools.database.propertyTypeUniqueId'), 'uniqueId', { uniqueId: { prefix: 'IM' } }) : undefined;
    const hardware = t('tools.database.starterOptionHardware');
    const category = features.has('category') ? select(t('tools.database.starterCategory'), [
      [hardware, 'orange'], [t('tools.database.starterOptionAccessories'), 'yellow'], [t('tools.database.starterOptionElectronics'), 'default'], [t('tools.database.starterOptionTools'), 'red'],
    ]) : undefined;
    const stock = features.has('quantity') ? add(t('tools.database.starterQuantityInStock'), 'number') : undefined;
    const least = features.has('reorderMin') ? add(t('tools.database.starterReorderMinimum'), 'number') : undefined;
    const supplier = features.has('supplier') ? select(t('tools.database.starterSupplier'), [
      [t('tools.database.starterOptionSupplier', { letter: 'Z' }), 'brown'], [t('tools.database.starterOptionSupplier', { letter: 'X' }), 'brown'],
      [t('tools.database.starterOptionSupplier', { letter: 'Y' }), 'default'],
    ]) : undefined;
    const ordered = add(t('tools.database.starterLastOrderedDate'), 'date', { date: { ...FULL } });
    const location = features.has('location') ? select(t('tools.database.starterLocation'), [
      [t('tools.database.starterOptionWarehouse', { number: '3' }), 'purple'], [t('tools.database.starterOptionWarehouse', { number: '1' }), 'pink'],
      [t('tools.database.starterOptionWarehouse', { number: '2' }), 'blue'],
    ]) : undefined;
    const notes = features.has('notes') ? add(t('tools.database.starterNotes'), 'text') : undefined;
    // research/33 §3.12; it reads both numbers, so it needs both chips.
    const reorder = features.has('reorderStatus') && stock !== undefined && least !== undefined
      ? add(t('tools.database.starterReorderStatus'), 'formula', {
        formula: {
          expression: `if({{property:${stock.id}}} <= {{property:${least.id}}}, ${JSON.stringify(t('tools.database.starterOptionReorder'))}, `
            + `if({{property:${stock.id}}} > 2 * {{property:${least.id}}}, ${JSON.stringify(t('tools.database.starterOverstocked'))}, ${JSON.stringify(t('tools.database.starterInStock'))}))`,
        },
      })
      : undefined;
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllInventory'), 'table', all, tableLook);
    // "Oldest first" groups: Blok's relative date groups, ascending.
    if (views.has('recent')) {
      view(t('tools.database.starterViewRecentlyOrdered'), 'list', [category], {
        showPageIcon: true, loadLimit: 25, openPagesIn: 'side', ...sortBy([ordered, 'asc']), groupBy: ordered.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false },
      });
    }
    if (views.has('hardware') && category !== undefined) {
      view(t('tools.database.starterViewHardwareInventory'), 'table', [uid, category, stock, supplier, least, ordered, location, notes, reorder], {
        ...tableLook, showPageIcon: true, ...where(category, 'equals', optionIds(category, [hardware])), ...sortBy([uid, 'asc']),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllInventory'), 'table', all, tableLook);
    template(t('tools.database.starterNewItem'));
  } else if (id === 'roadmap') {
    add(t('tools.database.starterProjectName'), 'title');
    const owner = add(t('tools.database.starterOwner'), 'person');
    const category = features.has('category') ? select(t('tools.database.starterCategory'), [
      [t('tools.database.starterOptionNewFeature'), 'purple'], [t('tools.database.starterOptionEnhancement'), 'default'], [t('tools.database.starterOptionBugFix'), 'yellow'],
      [t('tools.database.starterOptionPerformanceImprovement'), 'orange'], [t('tools.database.starterOptionUiUx'), 'red'],
    ], true) : undefined;
    const date = features.has('date') ? add(t('tools.database.propertyTypeDate'), 'date', { date: { ...FULL } }) : undefined;
    // research/33 §3.13: the first option is literally named "red", as served.
    const effort = features.has('effort') ? select(t('tools.database.starterEffort'), [
      [t('tools.database.starterOptionEffortRed'), 'red'], [t('tools.database.starterOptionSizeL'), 'orange'], [t('tools.database.starterOptionSizeM'), 'yellow'],
      [t('tools.database.starterOptionSizeS'), 'blue'], [t('tools.database.starterOptionSizeXs'), 'green'],
    ]) : undefined;
    const prio = features.has('priority') ? priority() : undefined;
    const description = features.has('description') ? add(t('tools.database.starterProjectDescription'), 'text') : undefined;
    const quarter = features.has('quarter') ? select(t('tools.database.starterQuarter'), [
      [t('tools.database.starterOptionQuarter', { number: '1' }), 'default'], [t('tools.database.starterOptionQuarter', { number: '2' }), 'orange'],
      [t('tools.database.starterOptionQuarter', { number: '3' }), 'purple'], [t('tools.database.starterOptionQuarter', { number: '4' }), 'brown'],
    ], true) : undefined;
    const state = customStatus([
      [t('tools.database.starterOptionBacklog'), 'brown', 'todo'], [t('tools.database.starterOptionPlanned'), undefined, 'todo'],
      [t('tools.database.defaultStatusInProgress'), 'blue', 'inProgress'],
      [t('tools.database.starterOptionCompleted'), 'green', 'complete'], [t('tools.database.starterOptionCancelled'), 'red', 'complete'],
      [t('tools.database.starterOptionOnHoldCampaign'), 'gray', 'complete'],
    ], 1);
    const team = select(t('tools.database.starterTeam'), [
      [t('tools.database.starterOptionAi'), 'green'], [t('tools.database.starterOptionPlatformTeam'), 'red'], [t('tools.database.starterOptionSecurity'), 'default'],
      [t('tools.database.starterOptionMobile'), 'purple'],
    ], true);
    const projects = [state, owner, prio, category, effort, description, quarter, team, date];
    const look = { ...tableLook, showPageIcon: true } as const;
    const listLook = { showPageIcon: true, loadLimit: 25, openPagesIn: 'side' } as const;

    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [owner, category], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true },
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllProjects'), 'table', projects, { ...tableLook, ...sortBy([date, 'desc'], [state, 'asc']) });
    if (views.has('mine')) view(t('tools.database.starterViewMyProjects'), 'table', projects, { ...look, ...mine(owner) });
    if (views.has('byTeam')) {
      view(t('tools.database.starterViewByTeam'), 'list', [owner, description, team], {
        ...listLook, ...sortBy([date, 'desc']), groupBy: team.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...groupOrder(team, [t('tools.database.starterOptionAi'), t('tools.database.starterOptionMobile'), null, t('tools.database.starterOptionPlatformTeam'), t('tools.database.starterOptionSecurity')]),
      });
    }
    if (views.has('byQuarter') && quarter !== undefined) {
      view(t('tools.database.starterViewByQuarter'), 'list', [owner, description, team], {
        ...listLook, ...sortBy([date, 'desc']), groupBy: quarter.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
      });
    }
    // "Show table: Table properties" was read, not which properties: the table shows the title.
    if (views.has('timeline') && date !== undefined) {
      view(t('tools.database.viewTypeTimeline'), 'timeline', [], { timelineBy: date.id, showTimelineTable: true, showPageIcon: true, loadLimit: 50, openPagesIn: 'side', ...sortBy([quarter, 'asc'], [date, 'desc']) });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllProjects'), 'table', projects, { ...tableLook, ...sortBy([date, 'desc'], [state, 'asc']) });
    template(t('tools.database.starterNewProject'));
  } else if (id === 'assets') {
    add(t('tools.database.starterAssetName'), 'title');
    const state = customStatus([
      [t('tools.database.defaultStatusNotStarted'), undefined, 'todo'],
      [t('tools.database.starterOptionWaitingForApproval'), 'purple', 'inProgress'], [t('tools.database.defaultStatusInProgress'), 'blue', 'inProgress'],
      [t('tools.database.starterOptionFirstDraft'), 'brown', 'inProgress'], [t('tools.database.starterOptionSecondDraft'), 'yellow', 'inProgress'],
      [t('tools.database.starterOptionFinalVersion'), 'green', 'complete'],
    ], 0);
    const url = features.has('url') ? add(t('tools.database.starterAssetUrl'), 'url') : undefined;
    const description = features.has('description') ? add(t('tools.database.starterAssetDescription'), 'text') : undefined;
    const kinds: Array<[string, string]> = [
      [t('tools.database.starterOptionIcon'), 'default'], [t('tools.database.starterOptionIllustration'), 'brown'], [t('tools.database.starterOptionPhoto'), 'blue'],
      [t('tools.database.starterOptionLogo'), 'red'], [t('tools.database.starterOptionUiComponent'), 'orange'], [t('tools.database.starterOptionColor'), 'green'],
      [t('tools.database.starterOptionTypography'), 'yellow'], [t('tools.database.starterOptionAnimation'), 'gray'], [t('tools.database.starterOptionOther'), 'pink'],
    ];
    const kind = features.has('assetType') ? select(t('tools.database.starterAssetType'), kinds, true) : undefined;
    const designer = features.has('designer') ? add(t('tools.database.starterDesigner'), 'person') : undefined;
    const files = features.has('files') ? add(t('tools.database.propertyTypeFiles'), 'files') : undefined;
    const edited = features.has('lastEdited') ? add(t('tools.database.starterLastEdited'), 'lastEditedTime', { date: { ...FULL } }) : undefined;
    const everything = [designer, kind, files, state, url, description, edited];

    if (views.has('gallery')) {
      view(t('tools.database.viewTypeGallery'), 'gallery', [state], { showPageIcon: true, wrapCells: false, openPagesIn: 'center', loadLimit: 50, cardPreview: 'none', cardSize: 'medium' });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllAssets'), 'table', everything, { ...tableLook, wrapCells: true });
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [], {
        ...boardLook, openPagesIn: 'side', fitImage: true, cardPreview: files === undefined ? 'none' : `property:${files.id}`, groupBy: state.id,
        groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true },
      });
    }
    if (views.has('assetType') && kind !== undefined) {
      const alphabetical = [...kinds.map(([label]) => label)].sort((a, b) => a.localeCompare(b));

      view(t('tools.database.starterViewAssetType'), 'table', [designer, files, state, url, description], {
        ...tableLook, loadLimit: 25, groupBy: kind.id, groupSettings: { sort: 'manual', hideEmptyGroups: false }, ...groupOrder(kind, [...alphabetical, null]),
      });
    }
    if (views.has('mine') && designer !== undefined) {
      view(t('tools.database.starterViewMyAssets'), 'table', [url, description, kind, designer, files, edited, state], { ...tableLook, showPageIcon: true, ...mine(designer) });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllAssets'), 'table', everything, { ...tableLook, wrapCells: true });
    template(t('tools.database.starterNewAsset'));
  } else {
    const title = add(t('tools.database.starterSkillName'), 'title');

    add(t('tools.database.formQuestionDescription'), 'text');
    add(t('tools.database.starterFiles'), 'files');
    add(t('tools.database.starterTags'), 'multiSelect', { config: { options: [] } });
    add(t('tools.database.propertyTypeCreatedBy'), 'createdBy');
    view(DATABASE_DEFAULT_TEXT.viewTypeTable, 'table', schema.slice(1), {
      showPageIcon: true, wrapCells: true, showVerticalLines: true, loadLimit: 50, calculations: [{ id: title.id, fn: 'count' }],
    });
  }

  return {
    title: t(meta.nameKey), schema, views: viewList, activeViewId: viewList[0].id, rows, templates, icon: { glyph: meta.glyph, color: meta.tint },
    ...(previewLast.length > 0 ? { previewLast } : {}),
  };
};
