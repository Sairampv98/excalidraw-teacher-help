/**
 * CTC greedy decoder for CRNN-style HTR model output.
 *
 * Accepts a flat logits buffer plus its dims and a charset whose index 0 is the
 * CTC blank. Supports the two common layouts:
 *   [T, 1, V]  (timestep-major, batch 1)
 *   [1, T, V]  (batch 1, timestep-major)
 * Greedy = argmax per timestep, collapse repeats, drop blanks.
 */

export type CtcResult = { text: string; confidence: number };

const resolveTV = (
  dims: number[],
): { T: number; V: number; layout: string } => {
  if (dims.length === 3) {
    // [T,1,V] or [1,T,V]
    if (dims[1] === 1) {
      return { T: dims[0], V: dims[2], layout: "T1V" };
    }
    return { T: dims[1], V: dims[2], layout: "1TV" };
  }
  if (dims.length === 2) {
    return { T: dims[0], V: dims[1], layout: "TV" };
  }
  throw new Error(`Unsupported logits dims: [${dims.join(",")}]`);
};

export const ctcGreedyDecode = (
  logits: Float32Array,
  dims: number[],
  charset: string[],
): CtcResult => {
  const { T, V } = resolveTV(dims);
  const out: string[] = [];
  let prev = -1;
  let logProbSum = 0;

  for (let t = 0; t < T; t++) {
    const base = t * V;
    let best = 0;
    let bestVal = -Infinity;
    let sumExp = 0;
    for (let v = 0; v < V; v++) {
      const val = logits[base + v];
      if (val > bestVal) {
        bestVal = val;
        best = v;
      }
    }
    // softmax denominator for a rough confidence
    for (let v = 0; v < V; v++) {
      sumExp += Math.exp(logits[base + v] - bestVal);
    }
    logProbSum += -Math.log(sumExp); // log(softmax(best)) = -log(sumExp)

    if (best !== 0 && best !== prev) {
      out.push(charset[best] ?? "");
    }
    prev = best;
  }

  return {
    text: out.join(""),
    confidence: Math.exp(logProbSum / Math.max(1, T)),
  };
};
