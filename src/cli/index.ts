import { getMigrationDoc } from './commands/migration';
import { writeOutput } from './utils/output';

const HELP_TEXT = `Usage: blok-cli [options]

Options:
  --convert-html       Convert legacy HTML from stdin to Blok JSON (stdout)
  --migration          Output the EditorJS to Blok migration guide (LLM-friendly)
  --output <file>      Write output to a file instead of stdout
  --help               Show this help message

Examples:
  npx @jackuait/blok-cli --convert-html < article.html
  npx @jackuait/blok-cli --convert-html < article.html --output article.json
  npx @jackuait/blok-cli --migration
  npx @jackuait/blok-cli --migration | pbcopy
  npx @jackuait/blok-cli --migration --output migration-guide.md
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

export const run = async (argv: string[], version: string): Promise<void> => {
  const { command, output } = parseArgs(argv);

  switch (command) {
    case 'convert-html': {
      const jsdom = await import('jsdom');
      const dom = new jsdom.JSDOM('');

      globalThis.DOMParser = dom.window.DOMParser;
      globalThis.Node = dom.window.Node;

      const { convertHtml } = await import('./commands/convert-html/index');
      const fs = await import('node:fs');
      const html = fs.readFileSync('/dev/stdin', 'utf-8');
      const json = convertHtml(html);

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
