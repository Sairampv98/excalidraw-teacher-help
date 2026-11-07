// A scenario: what a person does in the real app, step by step, and what must be true.
//
//   export default defineScenario({
//     id: "fly-switch",
//     tour: false,                   // true: the first-launch tour is left on the screen
//     rows: ["AC-538"],              // the requirement rows it speaks for
//     title: "the Fly button of the animation bar",
//     async run(ui) {
//       await ui.step("open the app", async () => { ... });
//       ui.expect(condition, { expected: "...", observed: "...", hint: "..." });
//     },
//   });

/** a thing the app does that is not what the requirement row says: it carries what a person needs to see it */
export class Discrepancy extends Error {
  constructor({ expected, observed, hint = "" }) {
    super(`expected ${expected}; saw ${observed}`);
    this.name = "Discrepancy";
    this.expected = expected;
    this.observed = observed;
    this.hint = hint;
  }
}

export const defineScenario = (definition) => {
  if (
    !definition?.id ||
    !Array.isArray(definition.rows) ||
    typeof definition.run !== "function"
  ) {
    throw new Error(
      "a scenario needs an id, the rows it speaks for and a run function",
    );
  }

  return definition;
};

/**
 * Runs one scenario with the `ui` it is given and says how it went. Each step is
 * named, numbered and shown by a picture; the first step that fails ends the run
 * and the result says which one and why.
 *
 * `env` supplies `shoot(label)` (a picture, returning its file name) and `faults()`
 * (the console errors and outside requests seen so far).
 */
export const runScenario = async (definition, makeUi, env = {}) => {
  const steps = [];
  const result = {
    id: definition.id,
    rows: definition.rows,
    title: definition.title ?? definition.id,
    steps,
    status: "pass",
  };
  const startedAt = Date.now();

  const ui = makeUi({
    step: async (text, action) => {
      const entry = { n: steps.length + 1, text, ok: true, shot: null };

      steps.push(entry);

      try {
        await action();
        entry.shot =
          (await env.shoot?.(`${String(entry.n).padStart(2, "0")}-${text}`)) ??
          null;
      } catch (error) {
        entry.ok = false;
        entry.shot =
          (await env
            .shoot?.(`${String(entry.n).padStart(2, "0")}-FAILED-${text}`)
            .catch(() => null)) ?? null;
        throw error;
      }
    },
    expect: (condition, details) => {
      if (!condition) {
        throw new Discrepancy(details);
      }
    },
  });

  try {
    await definition.run(ui);
  } catch (error) {
    if (error instanceof Discrepancy) {
      result.status = "discrepancy";
      result.failure = {
        step: steps.length,
        expected: error.expected,
        observed: error.observed,
        hint: error.hint,
      };
    } else {
      result.status = "error";
      result.failure = {
        step: steps.length,
        message: String(error?.message ?? error)
          .split("\n")[0]
          .slice(0, 300),
      };
    }
  }

  result.ms = Date.now() - startedAt;

  return result;
};
