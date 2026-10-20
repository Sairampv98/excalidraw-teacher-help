---
id: secrets-from-env
solves: Credentials never live in the repository — code reads them from environment variables at startup, fails fast with a clear message naming the missing variable, and ships an example file with placeholders only.
triggers: secret, api key, credential, password, token, config, environment variable, dotenv
not_when: A secrets manager is mandated (still read through one function, so tests can inject).
status: candidate
consumers: kit-bench (this repo)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
`const key = process.env.SERVICE_API_KEY; if (!key) throw new Error('SERVICE_API_KEY not set')`.
`.env.example` holds `SERVICE_API_KEY=` (empty). `.env` is in `.gitignore`. Never log the value.
Unverified: no module, no test.
