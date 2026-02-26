declare const __MIGRATION_CONTENT__: string;

export const migrationContent: string =
  typeof __MIGRATION_CONTENT__ !== 'undefined'
    ? __MIGRATION_CONTENT__
    : 'Migration content not available. Run `yarn build` first.';
