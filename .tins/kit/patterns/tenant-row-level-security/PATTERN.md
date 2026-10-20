---
id: tenant-row-level-security
solves: Multi-tenant isolation in Postgres — every tenant-owned table has a tenant_id column and a row-level-security policy keyed on a per-request setting, so a missing WHERE clause cannot leak another tenant's rows.
triggers: multi-tenant, tenant, row level security, rls, postgres, supabase, organisation, isolation
not_when: Single-tenant deployments; databases without RLS (use separate schemas or databases).
status: candidate
consumers: prior-project (ASSUMED, brief Part 1)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
`ALTER TABLE t ENABLE ROW LEVEL SECURITY; CREATE POLICY p ON t USING (tenant_id = current_setting('app.tenant')::uuid);`
Also `FORCE ROW LEVEL SECURITY` (owners bypass otherwise) and a test that connects as tenant A and
asserts zero rows of tenant B. Unverified here: needs a Postgres to test.
