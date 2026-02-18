#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { run } from '../dist/cli.mjs';

const version = process.env.npm_package_version
  || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
const args = process.argv.slice(2);

run(args, version);
