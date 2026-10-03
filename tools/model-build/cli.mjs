#!/usr/bin/env node
import {assemble, inspect, preflight, promote, rollbackCandidate} from './candidate.mjs';
import {requireThat} from './files.mjs';

const usage = `Model candidate safety tools (no authoring adapter is enabled)
  node tools/model-build/cli.mjs preflight --repo REPO
  node tools/model-build/cli.mjs snapshot --repo REPO --workspace NEW_DIRECTORY
  node tools/model-build/cli.mjs import --repo REPO --from COMPLETE_BUNDLE --workspace NEW_DIRECTORY
  node tools/model-build/cli.mjs check --workspace DIRECTORY
  node tools/model-build/cli.mjs promote --workspace DIRECTORY
  node tools/model-build/cli.mjs rollback --workspace DIRECTORY
Changed imports can be inspected but cannot be promoted in A1.`;
const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === '--help') { console.log(usage); }
  else {
    const expected = {preflight: ['repo'], snapshot: ['repo', 'workspace'], import: ['repo', 'from', 'workspace'], check: ['workspace'], promote: ['workspace'], rollback: ['workspace']}[command];
    requireThat(expected, 'Unknown command'); requireThat(args.length === expected.length * 2, 'Unexpected or missing arguments');
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].slice(2);
      requireThat(args[i].startsWith('--') && expected.includes(key) && !(key in options) && args[i + 1] && !args[i + 1].startsWith('--'), 'Invalid option'); options[key] = args[i + 1];
    }
    requireThat(expected.every(key => key in options), 'Missing option');
    let result;
    if (command === 'preflight') result = await preflight(options.repo);
    if (command === 'snapshot' || command === 'import') result = await assemble(options);
    if (command === 'check') result = (await inspect(options.workspace)).report;
    if (command === 'promote') result = await promote(options.workspace);
    if (command === 'rollback') result = await rollbackCandidate(options.workspace);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(`MODEL_CANDIDATE_ERROR: ${error.message}\n${usage}`); process.exitCode = 1; }
