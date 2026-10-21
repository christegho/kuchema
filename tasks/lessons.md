# Lessons

- Before diagnosing a newly reported error, confirm the running server has the latest backend code (process start time vs. last change, `job.version`, error wording). A stale process makes fixed bugs reappear and hides new behaviour.
- Schemas sent to providers become decoding grammars, and each engine supports a different JSON Schema subset (Parasail rejects `propertyNames`, which zod emits for `z.record`). Keep free-form records out of provider-facing schemas; `tests/structured.test.js` audits every schema against the proven keyword set, and `scripts/check-structured-outputs.mjs` confirms against the live providers after schema changes.
