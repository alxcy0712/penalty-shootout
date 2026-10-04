#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {runRelease} from './release-qa.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('npm run qa:release [-- --out NEW_DIRECTORY]\n  --plan / --dry-run: validate frozen inputs and print all gates; no gates run\n  --list: print the validated plan without writing evidence\nThe fixed full release runs tests, build, 669-shot/223-catch union, full finger and thumb audits serially. Existing output directories are never reused.');
} else {
  try {
    let mode = 'full', out;
    for (let index = 0; index < args.length; index++) {
      const flag = args[index];
      if (['--plan', '--dry-run', '--list'].includes(flag)) {
        if (mode !== 'full') throw Error('choose one planning mode');
        mode = flag === '--list' ? 'list' : 'plan';
      } else if (flag === '--out' && args[index + 1] && !args[index + 1].startsWith('--') && !out) out = args[++index];
      else throw Error('unknown or incomplete release option: ' + flag);
    }
    const report = await runRelease({root: fileURLToPath(new URL('../../', import.meta.url)), out, mode});
    console.log(JSON.stringify({status: report.status, acceptance: report.acceptance, out: report.out, fixture: report.fixture, gates: report.gates, failures: report.failures}, null, 2));
    if (report.status === 'failed') process.exitCode = 1;
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
