/** `value` on the nearest half grid unit, where positions and sizes land. */
export const snap = (value: number): number => Math.round(value * 2) / 2;
