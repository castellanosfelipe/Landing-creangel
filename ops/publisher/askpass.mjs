#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Git receives credentials through stdin/stdout, never through a process argument.
if ((process.argv[2] || '').toLowerCase().includes('username')) process.stdout.write('x-access-token\n');
else {
  const filename = process.env.GITHUB_READ_TOKEN_FILE;
  if (!filename) process.exit(1);
  const token = readFileSync(filename, 'utf8').trim();
  if (!token || /[\r\n]/.test(token)) process.exit(1);
  process.stdout.write(`${token}\n`);
}
