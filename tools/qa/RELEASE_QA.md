# Authoritative release QA v1

Run from a frozen checkout after `npm ci`:

```sh
npm run qa:release:plan
npm run qa:release -- --out /path/on/disk/penalty-release-evidence
```

Omit `--out` to create a unique directory under `validation/artifacts/release/` in the checkout. Choose a disk-backed workspace for large evidence; the runner never defaults to `/tmp`. Existing output directories are rejected, including directories containing old successful receipts. Keep the checkout unchanged until completion. Do not run other CPU-heavy audits alongside this command.

`node tools/qa/run-release-qa.mjs --list` reads and validates the contract without writing files. `--plan` and its alias `--dry-run` write a receipt with `status: planned`, `acceptance: false`, and every gate `not_run`. Neither executes tests, builds, or geometry audits. Planning is not release acceptance.

## Fixed acceptance contract

`release-qa.v1.json` pins the current model-motion-ten fixture bytes (SHA-256 `69ac2f1c4dc587dbaef9217533e0af973d5f5bd6d806173e3feb777ea2e1fbe1`), all 669 unique shot IDs, 223 labeled catches, three production GLBs, audit implementations and their reference helpers. The runner supports schema version 1 only and rejects omitted/reordered gates, unexpected config fields, changed pinned inputs, altered fixture counts, and duplicate IDs. Configuration is data: commands and subprocess paths are fixed in reviewed JavaScript and run without a shell.

The six required stages run in order:

1. Every top-level `tests/*.test.js`, using the Node test runner with file concurrency 1
2. Vite production build, into this run's evidence directory
3. Complete body, held-sphere/continuity, and trajectory union: four deterministic shards, one running at a time, all 669 shots and 223 catches
4. Independent union receipt summarizer, verifying exact ID coverage, raw receipts and exact required source-hash keysets
5. Full finger-grip deformation audit over all 223 catches, including 33,450 catch poses and 82 authored self-intersection samples
6. Full thumb/body differential over all 223 catches, `--match-playback`, 38 initial poses per catch plus any required dense refinement

No smoke/self-only/skip/fixture/concurrency override exists on the release entry. Controlled `BASE_HZ=10`, `DENSE_HZ=120` and `STAT=85` override inherited audit environment. Output/export overrides and `NODE_OPTIONS` are removed from subprocess environments. Historical and experimental cohorts remain available explicitly, for example:

```sh
node tools/qa/run-union-gates.mjs --fixtures validation/five-rounds/union-fixtures.json --out /path/on/disk/historical-union --jobs 4 --concurrency 1
```

The direct union entry now also defaults to the current 669-shot manifest, serial shard execution and `validation/artifacts/union/`. Direct union output alone is not a full release receipt; it does not include the test/build/finger/thumb stages. Historical summarizer positional fixture flags remain unchanged.

## Evidence and failure semantics

`release-report.json` is written before execution and after each stage using an atomic replacement. Only the complete full run can set `status: passed` and `acceptance: true`. Every required subprocess must exit zero without a signal. Missing build entries, missing/stale/altered geometry artifacts, incomplete or duplicate IDs, altered sample counts, or failed audit checks invalidate acceptance even if all subprocess exit codes are zero.

Before any gate, the runner resolves the installed Three and Vite package manifests through this checkout's `node_modules`, records real manifest paths, installed/resolved-lock versions and manifest SHA-256, and rejects a version mismatch. It reads existing installations only. These version and manifest checks do not prove the integrity of every installed dependency file. Installed manifests join the stability snapshot and package resolution is rechecked before acceptance.

The receipt records configuration/fixture hashes, hashes of runtime source, all tools (including model-build), tests, assets, public/build inputs and lockfile, plus Node version/platform/architecture. Every gate checks the same input snapshot again; the final receipt records the after snapshot. The final index hashes all required geometry receipts, gate logs and build outputs. A source addition/removal/change fails the run. These are checks of the source used by this run, not a claim that a changed runtime matches a historical commit.

On failure the runner stops subsequent gates, records the failed gate and error, retains all logs and partial artifacts, and indexes the available evidence. A killed runner may leave `running` instead of `failed`; `acceptance` remains false. There is no resume/reuse path that could mix sources or old artifacts: restart into a new directory.

To change expected geometry or fixtures, review the new actual outcomes and update the contract explicitly (including its release/version identity and supported runner contract when necessary). Do not rewrite expected catches to make an unexplained physical regression pass. To change an audit implementation, review its checks and refresh that specific `auditScripts` digest; the runner will reject an unexplained mismatch.

Runner fault tests are fast and independent:

```sh
npm run qa:release:runner-test
```

They inject subprocess failures, interruption, stale/changed sources, omitted or altered receipts, and invalid configuration into tiny synthetic files. Their synthetic success case only exercises receipt orchestration. It is not geometry acceptance. Run the full command separately to obtain actual release evidence.

Scope remains sampled offline CPU geometry and a production build. This command does not prove continuous-time collision freedom, WebGL restoration, mobile performance, or physical-device behavior.
