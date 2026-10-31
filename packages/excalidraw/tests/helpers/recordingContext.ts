/**
 * A 2D context that remembers every call and every property it was given, so a
 * test can read what was drawn, in which order and with what.
 */

export const recorder = () => {
  const log: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name !== "string") {
          return undefined;
        }

        return name in state
          ? state[name]
          : (...args: unknown[]) => {
              log.push([name, ...args]);
            };
      },
      set: (_target, name, value) => {
        log.push([`set:${String(name)}`, value]);
        state[String(name)] = value;

        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;

  return { ctx, log };
};
