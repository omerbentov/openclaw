import type { BaseProbeResult } from "openclaw/plugin-sdk";
import { callSundayApi, SundayApiError, type SundayCredentials } from "./api.js";
import type { ResolvedSundayAccount } from "./types.js";

export type SundayProbeResult = BaseProbeResult<string> & {
  elapsedMs: number;
};

export async function probeSunday(
  account: ResolvedSundayAccount,
  timeoutMs = 5000,
): Promise<SundayProbeResult> {
  if (!account.agentId?.trim() || !account.apiKey?.trim()) {
    return { ok: false, error: "No credentials provided", elapsedMs: 0 };
  }

  const creds: SundayCredentials = {
    agentId: account.agentId,
    apiKey: account.apiKey,
    apiBaseUrl: account.apiBaseUrl,
  };

  const startTime = Date.now();

  try {
    await callSundayApi(creds, "/getPendingMessages", {
      method: "GET",
      timeoutMs,
    });
    const elapsedMs = Date.now() - startTime;
    return { ok: true, elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;

    if (err instanceof SundayApiError) {
      return { ok: false, error: err.errorBody ?? err.message, elapsedMs };
    }

    if (err instanceof Error) {
      if (err.name === "AbortError") {
        return { ok: false, error: `Request timed out after ${timeoutMs}ms`, elapsedMs };
      }
      return { ok: false, error: err.message, elapsedMs };
    }

    return { ok: false, error: String(err), elapsedMs };
  }
}
