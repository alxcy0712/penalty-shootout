# A1 persistence contract

`src/persistence.js` separates storage operations from application UI, settings
migration, and engine restoration. The two channels use the existing keys:
`penalty-night-v1` and `penalty-preferences-v1`.

## Operations and feedback

Create one instance with `createPersistence({getStorage: () => localStorage})`.
The getter is lazy and guarded because merely accessing browser storage can
throw. Tests inject a storage object through this same boundary.

Each `match` / `preferences` channel provides:

| Operation | Success | Failure |
| --- | --- | --- |
| `read()` | `{ok: true, status: 'loaded', value}` or `'missing'` | `'unavailable'`, `'read-failed'`, `'corrupt'` |
| `write(value, serialize = JSON.stringify)` | `{ok: true, status: 'saved'}` | `'serialize-failed'`, `'unavailable'`, `'write-failed'` |
| `remove()` | `{ok: true, status: 'removed'}` | `'unavailable'`, `'remove-failed'` |

Failures have `ok: false` and include the caught `error` when available. UI
should show product language, not the raw exception. `channel.status` exposes
the last `read`, `write`, and `remove` results separately (initially `null`). A
successful read cannot erase a failed write. A successful write retry replaces
its previous failure. Preferences failure does not imply match failure, or the
reverse. A successful removal means the saved entry was removed, not that
progress was saved.

Use the result of the operation just attempted for pause, exit, and calibration
feedback. Never infer a successful save from the mere existence of stored JSON,
or from the other channel's status.

## Current-page fallback and overwrite protection

`read()` always reads storage. `readSession()` never reads storage and returns:

- `{ok: true, status: 'missing'}` before a serializable write
- `{ok: true, status: 'loaded', value, persisted}` after a serializable write

The session value is a fresh JSON clone on each read. After a failed disk write
it contains the latest serialized attempt, while `persisted` is false and the
previous disk value remains available through `read()`. A successful write
sets `persisted` to true. This means that write succeeded; it is not a promise
against another tab changing storage or the browser later evicting it.

Serialization failure leaves the previous session value untouched. It does not
prove that the current live game is represented by that snapshot. Before
leaving a game whose serialization failed, the application must preserve its
live state separately or explain that the latest progress cannot be retained.
Current-page snapshots do not survive reload or closing the page.

Inspect a candidate before offering resume or confirming replacement. If the
user cancels a replacement, do not call `write()` or `remove()`; both disk and
session bytes are then untouched. When replacement is confirmed, write the
new state once. Never remove the previous save first. The module relies on the
browser's native single-key `Storage.setItem` failure behavior and makes no
cross-key transaction or concurrency guarantee. A failed injected storage
implementation that mutates before throwing is outside that native contract.

Only successful explicit removal clears the session snapshot. Reads,
classification, restoration failure, corrupt JSON, and unsupported versions
never delete or rewrite the saved entry.

## Match version and restoration

`serializeMatchSave(state)` is exactly the existing
`JSON.stringify({version: 1, state})` format. It does not select or rebuild Shot
fields. Contact ownership, rebound, RNG, and presentation state retain their
existing serialized shape. Settings schema and migration belong to the input
settings module, not persistence.

`inspectMatchSave(payload)` returns one of:

- `{ok: true, status: 'resumable'}` for structurally valid unfinished v1 data
- `{ok: true, status: 'finished'}` for structurally valid data with a match winner,
  including the final kick's result screen
- `{ok: false, status: 'invalid', reason}` for malformed data
- `{ok: false, status: 'unsupported', reason}` for another version or unknown
  Match/Shot data fields in a version-1 save

`restoreMatchSave(payload, {restoreMatch, restoreShot})` checks that structure,
clones the JSON snapshot, and invokes the supplied engine restorers. On success
it returns `{ok: true, status: 'restored', kind, state}` where `kind` is
`'resumable'` or `'finished'`. On failure it returns the inspection failure or
`{ok: false, status: 'restore-failed', error}`. Match migrations can therefore
mutate their cloned data without partly mutating the source snapshot or live
game. Existing v1 optional fields remain optional; the engine remains
responsible for its historical defaults.

Optional runtime groups are checked when present: tracking feet require their
offset, velocity, and next-foot index; active steps require an index, origin,
destination, and clock; hesitation and cached poses require usable rig frames.
Animation/recovery clocks, torso channels, grip metadata, and cooldown maps must
contain the numeric/vector shapes their consumers use. Absent historical groups
remain optional. Only the current pose has the engine's missing-shoulders
migration; cached poses must already be safe to interpolate. The power phase
also requires its locked direction before Shoot can become available.

Match and Shot root fields have explicit version-1 data allowlists, audited
against their constructors and runtime assignments. Unknown fields are rejected
as unsupported and retained in the original stored bytes; they are never
silently dropped or assigned onto a class. This also rejects saved fields named
after engine methods before either restoration callback runs. Reserved
`__proto__`, `constructor`, and `prototype` keys are rejected throughout the
payload with an iterative walk. After restoration, a dynamic prototype check
also rejects callable-method collisions without maintaining a method blacklist.
When adding an engine-owned field, update and test this schema deliberately; the
source-assignment coverage test detects missing entries. Serialization continues
to retain the entire existing version-1 field layout.

Structural checks are not an exhaustive physics-version compatibility proof.
The UI must assign only a successful restored candidate and catch errors while
rendering it, returning to a safe home state with understandable feedback.

## Focused verification

Run `node --test tests/persistence.test.js`. Coverage includes denied storage
getters, unavailable APIs, read failures, quota failures and retries, channel
independence, serialization throws, malformed JSON, unsupported versions,
non-destructive cancellation, current-page fallback, deletion retries,
all existing save phases, legacy optional fields, and deterministic mid-flight
continuation, and rejection of malformed optional runtime groups before engine
restoration. These are controlled storage/engine tests, not browser quota,
eviction, or multi-tab tests.
