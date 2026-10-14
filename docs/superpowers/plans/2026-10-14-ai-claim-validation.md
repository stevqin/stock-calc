# Ordinary claim validation and raw output retention

Authorized scope: fix ordinary claim example/contract, precise field errors, retain independent and repair raw outputs; offline replay only; package and run new version.

Root cause: five complete operation modules and five ordinary claims without IDs. Old validator returned a generic text error; ordinary claims example was empty. Original output was overwritten by repair.

Implemented: complete ordinary claim example and constraints; explicit field paths and reason/byte limits; defaulted output audit array preserving both returned responses, validation and usage; UI and legacy fallback; rawOutput still final response. No fabricated advice or relaxed validation.

Verification: initial regression failed on missing claim example and unknown outputs field; fixed tests pass. Saved output offline replay rejected claims[0].id then passed all validation with only test-only IDs. Full suites: 510 frontend / 95 Rust pass, 9 skipped; explicit replay passes. Typecheck/build/format pass. Read-only review found no Critical/Important defects. No live model calls or user database changes. Version 0.9.2.
