---
id: timestamped-migrations
solves: Schema changes that parallel branches cannot collide on — each migration file is named by UTC timestamp plus slug, applied in order, recorded in a migrations table, never edited after merge.
triggers: migration, schema change, database schema, alter table, migrate
not_when: The project has no database.
status: candidate
consumers: fish-inventory (ASSUMED, brief Part 1)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
Name: `migrations/20261004T101500Z-add-batch-table.sql`. Timestamps replace "claim the next number":
two branches never pick the same name. A gate step checks no merged migration file changed (hash list).
Unverified: no module, no test.
