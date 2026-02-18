#!/usr/bin/env node

import { run } from '../dist/cli.mjs';

const version = process.env.npm_package_version || 'unknown';
const args = process.argv.slice(2);

run(args, version);
