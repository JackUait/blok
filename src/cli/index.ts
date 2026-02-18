import { getMigrationDoc } from './commands/migration';
import { writeOutput } from './utils/output';

const HELP_TEXT = `Usage: blok [options]

Options:
  --migration          Output the EditorJS to Blok migration guide (LLM-friendly)
  --output <file>      Write output to a file instead of stdout
  --help               Show this help message

Examples:
  npx @jackuait/blok --migration
  npx @jackuait/blok --migration | pbcopy
  npx @jackuait/blok --migration --output migration-guide.md
`;

const parseArgs = (argv: string[]): { command: string | null; output?: string } => {
  if (argv.includes('--help')) {
    return { command: 'help' };
  }

  if (argv.includes('--migration')) {
    const outputIndex = argv.indexOf('--output');
    const output = outputIndex !== -1 ? argv[outputIndex + 1] : undefined;

    return { command: 'migration', output };
  }

  return { command: null };
};

export const run = (argv: string[], version: string): void => {
  const { command, output } = parseArgs(argv);

  switch (command) {
    case 'migration': {
      const content = getMigrationDoc(version);

      writeOutput(content, output);
      break;
    }
    case 'help':
    case null:
      process.stdout.write(HELP_TEXT);
      break;
  }
};
