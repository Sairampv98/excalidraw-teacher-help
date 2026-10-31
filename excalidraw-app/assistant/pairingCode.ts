/** a pairing code as the person typed it: upper case, with spaces and dashes taken out */
export const normalizePairingCode = (value: string) =>
  value.toUpperCase().replace(/[\s-]/g, "");
