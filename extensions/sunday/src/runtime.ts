import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setSundayRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getSundayRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Sunday runtime not initialized");
  }
  return runtime;
}
