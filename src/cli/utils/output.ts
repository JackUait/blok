import * as fs from 'node:fs';

export const writeOutput = (content: string, outputPath?: string): void => {
  if (outputPath) {
    fs.writeFileSync(outputPath, content, 'utf-8');
    process.stderr.write(`Written to ${outputPath}\n`);
  } else {
    process.stdout.write(content);
  }
};
