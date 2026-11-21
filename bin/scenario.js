#!/usr/bin/env node
import { main } from '../src/cli.ts';
main(process.argv.slice(2)).catch(error => {
  console.error(`scenario: ${error.message}`);
  process.exitCode = 1;
});
