import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const DATABASE_ROW_DATA = {
  type: 'object',
  description: 'One row of a database block. Optional pageId points to a separate body document.',
  required: ['properties', 'position'],
  additionalProperties: false,
  patternProperties: {
    '^reactions:': {
      type: 'object',
      description: 'One person\'s feed reactions; the key is "reactions:" plus their user id. Emoji to when they reacted (epoch ms). An agent writes only its own key.',
      additionalProperties: { type: 'number' },
    },
  },
  properties: {
    properties: {
      type: 'object',
      description: 'Column values keyed by property id. Values follow the parent database\'s schema, so the shape is open.',
      additionalProperties: true,
    },
    position: { type: 'string', description: 'Fractional-index sort key.' },
    title: {
      type: 'string',
      description: 'Row title, mirrored from the title column. Absent on rows written before this key existed.',
    },
    pageId: { type: 'string', minLength: 1, description: 'Id of the separate document that holds the row page body.' },
    bodyBlocks: {
      type: 'boolean',
      description: 'True once the page body lives in the row\'s child blocks. A legacy body blob in a richText property is then ignored.',
    },
    icon: { type: 'string', description: 'The row page icon, an emoji.' },
    cover: { type: 'string', description: 'The row page cover, an image URL.' },
    fullWidth: { type: 'boolean', description: 'The row page\'s own Full width. Absent: the database page layout decides. Only a full page widens.' },
    template: { type: 'boolean', description: 'A page template, not a row. Views and exports skip it.' },
    anonymous: { type: 'boolean', description: 'An anonymous form answer: saved with no createdBy; Created by reads "Anonymous".' },
    repeat: {
      type: 'object',
      description: 'Templates only: a repeating schedule. The host runs it.',
      required: ['frequency', 'start'],
      additionalProperties: false,
      properties: {
        frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
        interval: { type: 'integer', minimum: 1 },
        timeZone: { type: 'string', description: 'IANA zone whose wall clock the runs keep across DST. Absent: UTC.' },
        start: { type: 'string', description: 'ISO date-time of the first run.' },
        lastRunAt: { type: 'string' },
        weekdays: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 1, maximum: 7 }, description: 'Weekly only: days it runs on, 1 = Monday … 7 = Sunday, each at the start\'s time. Absent: the start\'s weekday.' },
        end: { type: 'string', description: 'ISO date-time after which it makes no more rows. Absent: never.' },
      },
    },
    reminders: {
      type: 'object',
      description: 'Date reminders keyed by date property id. The host sends them through config.reminders.onReminderDue.',
      additionalProperties: {
        type: 'object',
        required: ['remind'],
        additionalProperties: false,
        properties: {
          remind: {
            type: 'string',
            enum: ['on_day_of_event', '1_day_before', '2_days_before', '1_week_before', 'at_time_of_event', '5_minutes_before', '10_minutes_before', '15_minutes_before', '30_minutes_before', '1_hour_before', '2_hours_before'],
            description: 'When to remind. The day offsets remind at 9:00; minutes and hours count back from a timed date.',
          },
          timeZone: { type: 'string', description: 'IANA zone of whoever set the reminder. A date with no property time zone is due in it, so every client agrees. Absent: each viewer\'s zone.' },
          sentFor: { type: 'string', description: 'The due time (ISO) the host last sent. Not offered again while it equals the current due time.' },
        },
      },
    },
    convertedValues: {
      type: 'object',
      description: 'Values a property type change could not carry over, keyed by property id; restored if the type changes back.',
      additionalProperties: {
        type: 'object',
        required: ['type', 'value'],
        additionalProperties: false,
        properties: { type: { type: 'string' }, value: { description: 'The value as the old type stored it.' } },
      },
    },
  },
};

export const describeDatabaseRow = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'One row of a database. Its child blocks are its page body. An optional pageId points to a separate body document instead.',
  guidance: 'Write row values with database.setRowValues on the parent database: the title mirrors the title property. block.delete and block.duplicate on a row run database.deleteRow and database.duplicateRow.',
  data: DATABASE_ROW_DATA,
  guardedFields: { properties: 'database.setRowValues on the parent database' },
  summaryFields: ['title'],
});
