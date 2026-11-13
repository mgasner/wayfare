// Secrets and settings for server/ code. The SDK attaches credentials at egress and has no way to read
// one by name, so this reads the host's environment when there is one; tests set their own.
let values: Record<string, string | undefined> | undefined;

export function setEnv(next: Record<string, string | undefined> | undefined): void {
  values = next;
}

export function env(name: string): string | undefined {
  const source = values ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = source?.[name];
  return value === "" ? undefined : value;
}
