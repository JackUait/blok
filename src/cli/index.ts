import { getMigrationDoc } from './commands/migration';
import { writeOutput } from './utils/output';

const HELP_TEXT = `Usage: blok [options]

Options:
  --convert-html       Convert legacy HTML from stdin to Blok JSON (stdout)
  --migration          Output the EditorJS to Blok migration guide (LLM-friendly)
  --output <file>      Write output to a file instead of stdout
  --help               Show this help message

Examples:
  npx @jackuait/blok --convert-html < article.html
  npx @jackuait/blok --convert-html < article.html --output article.json
  npx @jackuait/blok --migration
  npx @jackuait/blok --migration | pbcopy
  npx @jackuait/blok --migration --output migration-guide.md
`;

const parseArgs = (argv: string[]): { command: string | null; output?: string } => {
  if (argv.includes('--help')) {
    return { command: 'help' };
  }

  if (argv.includes('--convert-html')) {
    const outputIndex = argv.indexOf('--output');
    const output = outputIndex !== -1 ? argv[outputIndex + 1] : undefined;

    return { command: 'convert-html', output };
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
    case 'convert-html': {
      const { convertHtml } = require('./commands/convert-html/index');
      const html = require('node:fs').readFileSync('/dev/stdin', 'utf-8') as string;
      const json = convertHtml(html) as string;

      writeOutput(json, output);
      break;
    }
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
