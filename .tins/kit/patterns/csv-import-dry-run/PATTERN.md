---
id: csv-import-dry-run
solves: Importing a spreadsheet/CSV safely — parse everything first, report what would change (new, duplicate, invalid rows) in a dry run, and only write on an explicit apply; duplicates matched on a declared natural key.
triggers: csv, import, spreadsheet, upload, bulk load, dedupe, duplicate rows, dry run
not_when: The source is a trusted machine feed with a stable primary key — upsert directly.
status: candidate
consumers: builder-1 (ASSUMED, brief 2.2.2)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
Steps: parse (RFC 4180 quoting, BOM, CRLF) -> validate each row -> classify against existing data by
natural key -> print counts and the first N problems -> apply only with an explicit flag, in one
transaction. Re-running the same file must be a no-op. Unverified: no module, no test.
