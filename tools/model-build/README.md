# Model candidate safety (A1)

**This is a snapshot/import/inspection contract, not a model authoring or changed-asset release pipeline. No generating adapter is enabled. Changed imported bundles can be checked, but promotion is blocked until a fixed candidate-scoped deep runner and visual review gate exist.**

The shipped `.blend` files are editable reconstructions of released GLBs. They do not establish original authoring history, even when custom refinement markers are absent. `tools/blender/refine_football_model.py` and `tools/blender/repair_keeper_skin.py` therefore reject direct `rebuild()` before touching Blender preferences, opening sources, editing geometry, saving, or exporting. Their in-memory `refine_character` and `repair_jersey` research helpers remain available. Reintroducing a generating adapter requires proven authoring inputs and exact version/API requirements; do not remove the guard just because a newer Blender is installed.

## Commands

Run from the repository root. Use a new workspace outside the repository and any import directory. Its parent must already exist.

```sh
mkdir -p ../model-candidates
node tools/model-build/cli.mjs preflight --repo .
node tools/model-build/cli.mjs snapshot --repo . --workspace ../model-candidates/run-001
node tools/model-build/cli.mjs check --workspace ../model-candidates/run-001
```

`preflight` reads the required inputs and tools. `snapshot` copies the fixed bundle into `WORKSPACE/candidate/` and writes a versioned manifest. Neither invokes Blender, an exporter, source code from the bundle, nor an arbitrary command supplied in JSON. Node and the installed Three.js Meshopt decoder perform the checks. `package-lock.json`, the Node version and the actual loaded Meshopt decoder module hash are recorded; the environment must retain its installed dependencies.

To inspect an externally prepared candidate, put the complete file set below in an ordinary directory, preserving relative paths, then import it:

```sh
node tools/model-build/cli.mjs import --repo . --from ../prepared-model-bundle --workspace ../model-candidates/import-001
node tools/model-build/cli.mjs check --workspace ../model-candidates/import-001
```

Fixed bundle:

- `assets/characters/{keeper-prototype,striker-mocap}.{glb,blend,json}`
- `assets/characters/model-refinement.json`
- `src/keeper-contact-data.js`

Both original and imported input paths, byte counts and SHA-256 values are captured. All repository `src/*.js`, package manifests and fixed tool sources are pinned. Inputs, tools, Node version and candidate bytes must remain unchanged through inspection and promotion. If any changes, assemble a fresh workspace; editing a `passed` field is never an acceptance mechanism. Symlinked source or candidate files, traversal paths, unknown schemas/adapters and incomplete/duplicate inventories are rejected. These hashes provide reproducibility and stale-input checks, not a digital signature against a person able to replace the whole workspace.

## What `check` establishes

- File-size checks before reads; 450 kB GLB limit before decode, at most 8 MiB total decoded buffers and 250,000 accessor rows per model
- GLB container bounds, embedded binary references, successful Meshopt decoding and finite mesh positions
- Indexed triangle counts, valid joints and normalized skin weights, at most four influences
- Existing limits: 18,000 triangles, 450,000 GLB bytes, 22 source bones, six materials and two textures
- Asset metadata and current model identity hashes match the candidate
- Editable `.blend` serialization opens as raw or gzip Blender bytes; this is a header/serialization check, not a Blender rig/animation equivalence proof
- Keeper contact cache is parsed strictly as generated JSON, without JavaScript execution, and its GLB and deformation-source hashes match the staged inputs
- Every original source remains unchanged after inspection

`validation.json` separately records basic check results, changed files, deep gate state, visual review state and promotion eligibility. Cache provenance is not a collision-result proof. The checks do not establish full skin intersections, held-ball/floor safety, motion quality, Blender structural equivalence, visual quality, WebGL performance or device performance.

For a byte-identical snapshot, deep and visual gates explicitly say **not rerun; identical baseline**. For a changed import they remain **not run / required**, and `promote` refuses it. No externally supplied `passed` string, report file, or manual toggle can unlock changed-asset promotion.

## Recoverable promotion and rollback

A checked, byte-identical bundle can exercise the explicit transaction lifecycle:

```sh
node tools/model-build/cli.mjs promote --workspace ../model-candidates/run-001
node tools/model-build/cli.mjs rollback --workspace ../model-candidates/run-001
```

Promotion reruns checks, verifies the saved validation record, writes a workspace-bound preparing journal, acquires `.model-build.lock` using complete lock content, backs up every destination under `WORKSPACE/transaction/backup/`, verifies those backups, and records per-file intent before each staged rename. Caught partial failures restore originals. Backups and the journal remain after success or rollback. The transaction refuses a changed destination or a different transaction's lock.

After process interruption, run the same `rollback` command. A preparing journal means destination writes have not begun: recovery verifies all original hashes and releases its lock without requiring incomplete backups. Later states require complete backups. The journal must match this workspace manifest, repository root and artifact fingerprints. Recovery verifies all backups and current files before restoring, handles its own interrupted staging files, and refuses to overwrite unrelated later edits. A conflict leaves the lock, journal and backups for recovery; resolve the conflicting file deliberately and retry rollback. Do not blindly delete the lock. One workspace has one promotion transaction; use a fresh workspace to start another.

Multi-file replacement is recoverable, **not atomic visibility across all files**. Run while other asset writers/readers are stopped. The lock coordinates this tool, not every editor or process. This is not a filesystem snapshot or a guarantee against arbitrary concurrent writers, storage failure, sudden power loss or a hostile workspace. File contents are synced, but parent-directory durability is not promised; recovery guarantees are scoped to process interruption. Automatic cleanup never deletes recovery backups.

## Blender capability probe

```sh
blender -b --factory-startup --disable-autoexec --python-exit-code 1 \
  --python tools/model-build/blender_capabilities.py
```

The probe opens no production source and writes no output files. Missing action layers/slots or exporter Meshopt interfaces cause failure before authoring. Even if every capability is present, the legacy rebuild stays disabled until authoring provenance is implemented. Opening a delivered `.blend` successfully is not evidence that this authoring API set is supported.

## Tests and extension boundary

`npm test` includes this suite through `tests/model-build.test.js`. To run it alone:

```sh
node --test tools/model-build/model-build.test.mjs
```

Tests cover snapshot inspection and round-trip transaction/source integrity, changed inputs/tools/candidates, source symlinks and traversal, strict schema, untrusted cache code, forged validation/cache provenance, changed-import policy, partial-swap failure, interrupted recovery, conflicting later edits, corrupt backups, and fail-before-write legacy/capability guards. Transaction fault injection operates only on temporary fixture files.

A future generating adapter must be a small fixed implementation in source control. It must pin and classify original authoring inputs, preflight its actual Blender/export APIs before source writes, write only into its candidate workspace, preserve source hashes, produce this complete bundle, and execute known candidate-scoped structural/contact/motion/visual gates. Manifests must never become command interpreters. Keep the gate status and evidence scope explicit rather than treating basic checks as release acceptance.

## Local workspace scope

A1 manifests bind absolute repository/tool roots and the installed Node/decoder identity. They are local reproducibility and recovery workspaces, not portable signed release packages. After moving machines or source directories, assemble a fresh workspace against the verified inputs; do not hand-edit roots or old validation hashes. Pinning every runtime module is deliberately conservative: even an unrelated UI edit invalidates the workspace and requires reassembly. A future adapter may narrow that dependency set only with an explicit tested dependency contract.
