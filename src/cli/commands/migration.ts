import { migrationContent } from './migrationContent';

export const getMigrationDoc = (version: string): string => {
  const preamble = [
    '# Blok Migration Guide (for LLM-assisted migration)',
    '',
    '> This document contains everything needed to migrate a project from EditorJS to Blok.',
    '> Apply these changes systematically to the user\'s codebase.',
    `> Current Blok version: ${version}`,
    '',
    '---',
    '',
  ].join('\n');

  return preamble + migrationContent;
};
