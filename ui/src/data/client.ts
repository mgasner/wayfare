import { call, type Input, type Name, type Output } from "../api.js";

export const FIXTURES = import.meta.env.VITE_FIXTURES === "1";

// The fixtures module (and its 200 KB of Lima data) only loads in fixtures mode.
const fixtures = FIXTURES ? import("./fixtures/backend.js") : null;

/** Calls an entrypoint, or its in-browser fixture when VITE_FIXTURES=1. */
export async function api<N extends Name>(name: N, input: Input<N>): Promise<Output<N>> {
  if (fixtures) return (await fixtures).fixtureCall(name, input);
  return call<N>(name, input);
}
