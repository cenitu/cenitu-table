/**
 * Sources of the volatile functions (TODAY/NOW and RAND/RANDBETWEEN). Replaceable so hosts and
 * tests can pin time and randomness; calling a setter without an argument restores the default.
 */

let clock: () => Date = () => new Date();
let random: () => number = Math.random;

export function setClock(fn?: () => Date): void {
  clock = fn ?? (() => new Date());
}

/** `fn` must return a number in [0, 1), like Math.random. */
export function setRandom(fn?: () => number): void {
  random = fn ?? Math.random;
}

export const now = (): Date => clock();
export const nextRandom = (): number => random();
