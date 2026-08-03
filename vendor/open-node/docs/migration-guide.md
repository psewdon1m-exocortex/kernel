# Migration Guide

`MigrationRegistry` stores one forward step per source schema. `loadProjectJson` follows the chain to `1.0.0`, returns the migration path and retains `original` for recovery.

Rules:

1. Never mutate or overwrite the source document.
2. Add fields with deterministic defaults.
3. Preserve unknown Node state in `unresolved.rawState`.
4. Do not silently reinterpret port meaning or units.
5. Validate the full model after every completed migration chain.
6. Keep golden project fixtures for every shipped schema.

The included `0.1.0 → 1.0.0` step deep-merges old data over current defaults. Node package migrations are separate: a Node Definition receives its old version and raw parameter state.
