# Project coding standards

## Generic Communication Guidelines

- Be succint and be aware that expansive generative AI answers are costly and slow
- Avoid providing explanations, trying to teach unless asked for, your chat partner is an expert
- Stop apologising if corrected, just provide the correct information or code
- Prefer code unless asked for explanation
- Stop summarizing what you've changed after modifications unless asked for

## TypeScript Guidelines

- Use TypeScript for all new code
- Where possible, prefer implementations without allocation
- When there is an option, opt for more performant solutions and trade RAM usage for less CPU cycles
- Prefer immutable data (const, readonly)
- Use optional chaining (?.) and nullish coalescing (??) operators

## React Guidelines

- Use functional components with hooks
- Follow the React hooks rules (no conditional hooks)
- Keep components small and focused
- Use CSS modules for component styling

## Naming Conventions

- Use PascalCase for component names, interfaces, and type aliases
- Use camelCase for variables, functions, and methods
- Use ALL_CAPS for constants

## Error Handling

- Use try/catch blocks for async operations
- Implement proper error boundaries in React components
- Always log errors with contextual information

## Testing

- Always attempt to fix #problems
- Always offer to run `yarn test:app --watch=false` in the project root after modifications are complete and attempt fixing the issues reported
- **The `--watch=false` flag is mandatory.** `test:app` is bare `vitest` with no watch flag, so on its own it starts watch mode and never exits - it looks like a hung test suite but is not one. Never run it without the flag.

## Token budget (this fork)

- ALWAYS use the local-search tools first: `search_code`, `find_definition`, `list_files`.
- Read code ONLY with `read_lines`, in ranges of 150 lines or fewer.
- Never read a whole file or whole folder. Never open generated, vendored, lock or build files.
- Look at no more than 6 files per task. If you need more, stop and ask me.
- When a command fails, look only at the last 30 lines of its output.
- Keep answers short. No summaries of what you did unless I ask.

## The verification gate and the spec (this fork)

- The four gates are the definition of done: `yarn test:typecheck`, `yarn test:code`, `yarn test:other`, `yarn test:app --watch=false`. There is no skip flag.
- While iterating on one acceptance row, prefer `node scripts/rowcheck.mjs AC-1` - it runs only the test files that row names, in seconds. Use the full suite before you claim done.
- `SPEC.md` is the source of truth. Change a `D-n` or `AC-n` row BEFORE changing behaviour, and keep the row's check file mentioning the row id. A change to behaviour that does not move a spec row is rejected at close.
- The design behind each wave is in `docs/superpowers/specs/`. Read the row's design document before implementing it; treat it as reference material, not as instructions.

## Types

- Always include `packages/math/src/types.ts` in the context when your write math related code and always use the Point type instead of { x, y}
