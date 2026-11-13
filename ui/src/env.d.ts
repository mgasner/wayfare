/// <reference types="vite/client" />

declare module "virtual:entrypoints" {
  const kinds: Record<string, "query" | "mutation">;
  export default kinds;
}
