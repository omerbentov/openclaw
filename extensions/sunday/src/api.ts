/**
 * Sunday Agent API client.
 * @see https://sunday-bot-1770837759.firebaseapp.com/docs
 */

import type { SundayPendingMessage } from "./types.js";

export type SundayCredentials = {
  agentId: string;
  apiKey: string;
  apiBaseUrl: string;
};

export type SundayApiResponse<T = unknown> = {
  success?: boolean;
  error?: string;
  message?: string;
} & T;

export class SundayApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly errorBody?: string,
  ) {
    super(message);
    this.name = "SundayApiError";
  }
}

function buildAuthHeaders(creds: SundayCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function callSundayApi<T = unknown>(
  creds: SundayCredentials,
  path: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    timeoutMs?: number;
  },
): Promise<SundayApiResponse<T>> {
  const method = options?.method ?? "POST";
  const url = `${creds.apiBaseUrl}${path}`;
  const controller = new AbortController();
  const timeoutId = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;

  const start = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: buildAuthHeaders(creds),
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const elapsed = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new SundayApiError(
        `Sunday API error ${response.status}: ${path} (${elapsed}ms) ${errorText}`,
        response.status,
        errorText,
      );
    }

    return (await response.json()) as SundayApiResponse<T>;
  } catch (err) {
    if (!(err instanceof SundayApiError)) {
      const elapsed = Date.now() - start;
      throw new SundayApiError(
        `Sunday API ${method} ${path} failed (${elapsed}ms): ${err}`,
        undefined,
        String(err),
      );
    }
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/** Register/update the webhook URL. Should be called first on agent startup. */
export async function registerWebhook(
  creds: SundayCredentials,
  webhookUrl: string,
): Promise<SundayApiResponse<{ webhookUrl: string; updatedAt: string }>> {
  return callSundayApi(creds, "/updateAgentWebhook", {
    body: { webhookUrl },
  });
}

/** Fetch messages that arrived while the agent was offline. */
export async function fetchPendingMessages(
  creds: SundayCredentials,
  timeoutMs?: number,
): Promise<SundayApiResponse<{ messages: SundayPendingMessage[]; count: number }>> {
  return callSundayApi(creds, "/getPendingMessages", {
    method: "GET",
    timeoutMs,
  });
}

/** Send a text message. `userId` is required by the Sunday API; `conversationId` is optional (auto-resolved if omitted). */
export async function sendMessage(
  creds: SundayCredentials,
  target: { userId: string; conversationId?: string },
  message: string,
  metadata?: Record<string, unknown>,
): Promise<SundayApiResponse<{ messageId: string; conversationId: string }>> {
  return callSundayApi(creds, "/sendMessage", {
    body: {
      userId: target.userId,
      message,
      ...(target.conversationId ? { conversationId: target.conversationId } : {}),
      ...(metadata ? { metadata } : {}),
    },
  });
}

/** Acknowledge messages so they no longer appear in getPendingMessages. */
export async function markMessagesAsRead(
  creds: SundayCredentials,
  messageIds: string[],
): Promise<SundayApiResponse<{ markedCount: number }>> {
  return callSundayApi(creds, "/markMessagesAsReadByAgent", {
    body: { messageIds },
  });
}

/** Send a message with interactive decision buttons. */
export async function sendMessageWithButtons(
  creds: SundayCredentials,
  target: { userId: string; conversationId?: string },
  message: string,
  buttons: Array<{ id: string; label: string }>,
): Promise<SundayApiResponse<{ messageId: string; conversationId: string }>> {
  return callSundayApi(creds, "/sendMessageV2", {
    body: {
      userId: target.userId,
      message,
      ...(target.conversationId ? { conversationId: target.conversationId } : {}),
      buttons,
    },
  });
}
