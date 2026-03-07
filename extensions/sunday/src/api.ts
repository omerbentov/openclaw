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

/** Send a message. `userId` is required; `conversationId` is optional (auto-resolved). */
export async function sendMessage(
  creds: SundayCredentials,
  target: { userId: string; conversationId?: string },
  message: string,
  options?: { type?: string; metadata?: Record<string, unknown> },
): Promise<SundayApiResponse<{ messageId: string; conversationId: string }>> {
  return callSundayApi(creds, "/sendMessage", {
    body: {
      userId: target.userId,
      message,
      ...(target.conversationId ? { conversationId: target.conversationId } : {}),
      ...(options?.type ? { type: options.type } : {}),
      ...(options?.metadata ? { metadata: options.metadata } : {}),
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

/** Get messages for a conversation. */
export async function getMessages(
  creds: SundayCredentials,
  conversationId: string,
): Promise<SundayApiResponse<{ messages: SundayPendingMessage[] }>> {
  return callSundayApi(creds, `/getMessages?conversationId=${encodeURIComponent(conversationId)}`, {
    method: "GET",
  });
}

/** Request user permission for an action. */
export async function requestPermission(
  creds: SundayCredentials,
  params: { userId: string; conversationId: string; action: string; reason: string },
): Promise<SundayApiResponse<{ permissionId: string; messageId: string }>> {
  return callSundayApi(creds, "/requestPermission", { body: params });
}

/** Check the status of a permission request. */
export async function checkPermission(
  creds: SundayCredentials,
  permissionId: string,
): Promise<
  SundayApiResponse<{
    permissionId: string;
    status: "pending" | "approved" | "denied";
    respondedAt: string | null;
  }>
> {
  return callSundayApi(creds, `/checkPermission?permissionId=${encodeURIComponent(permissionId)}`, {
    method: "GET",
  });
}

/** Send a task progress update. */
export async function updateTaskStatus(
  creds: SundayCredentials,
  params: {
    userId: string;
    conversationId: string;
    taskName: string;
    status: string;
    progress: number;
  },
): Promise<SundayApiResponse<{ messageId: string }>> {
  return callSundayApi(creds, "/updateTaskStatus", { body: params });
}

/** Update an existing todo_list message in-place. */
export async function updateTodoList(
  creds: SundayCredentials,
  params: {
    messageId: string;
    items: Array<{ id: string; title: string; status: string }>;
    status?: string;
  },
): Promise<SundayApiResponse> {
  return callSundayApi(creds, "/updateTodoList", { body: params });
}

/** Store a key-value pair scoped to a conversation. */
export async function setContext(
  creds: SundayCredentials,
  params: { conversationId: string; key: string; value: string },
): Promise<SundayApiResponse> {
  return callSundayApi(creds, "/setContext", { body: params });
}

/** Retrieve a context value by key. */
export async function getContext(
  creds: SundayCredentials,
  conversationId: string,
  key: string,
): Promise<SundayApiResponse<{ value: string }>> {
  return callSundayApi(
    creds,
    `/getContext?conversationId=${encodeURIComponent(conversationId)}&key=${encodeURIComponent(key)}`,
    { method: "GET" },
  );
}

/** Delete a context value by key. */
export async function deleteContext(
  creds: SundayCredentials,
  conversationId: string,
  key: string,
): Promise<SundayApiResponse> {
  return callSundayApi(
    creds,
    `/deleteContext?conversationId=${encodeURIComponent(conversationId)}&key=${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
}

/** List all context keys for a conversation. */
export async function listContextKeys(
  creds: SundayCredentials,
  conversationId: string,
): Promise<SundayApiResponse<{ keys: string[] }>> {
  return callSundayApi(
    creds,
    `/listContextKeys?conversationId=${encodeURIComponent(conversationId)}`,
    { method: "GET" },
  );
}
