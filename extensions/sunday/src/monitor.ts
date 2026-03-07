import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  createReplyPrefixOptions,
  readRequestBodyWithLimit,
  registerWebhookTarget,
  rejectNonPostWebhookRequest,
  isRequestBodyLimitError,
  requestBodyErrorToText,
  resolveSenderCommandAuthorization,
  resolveWebhookTargets,
} from "openclaw/plugin-sdk";
import type { ResolvedSundayAccount } from "./accounts.js";
import {
  fetchPendingMessages,
  markMessagesAsRead,
  registerWebhook,
  sendMessage,
  type SundayCredentials,
} from "./api.js";
import { getSundayRuntime } from "./runtime.js";
import type { SundayPendingMessage, SundayWebhookEvent } from "./types.js";

export type SundayRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type SundayMonitorOptions = {
  account: ResolvedSundayAccount;
  config: OpenClawConfig;
  runtime: SundayRuntimeEnv;
  abortSignal: AbortSignal;
  webhookUrl?: string;
  webhookPath?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type SundayMonitorResult = {
  stop: () => void;
};

type SundayCoreRuntime = ReturnType<typeof getSundayRuntime>;

type WebhookTarget = {
  account: ResolvedSundayAccount;
  config: OpenClawConfig;
  runtime: SundayRuntimeEnv;
  core: SundayCoreRuntime;
  path: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

const webhookTargets = new Map<string, WebhookTarget[]>();

function registerSundayWebhookTarget(target: WebhookTarget): () => void {
  return registerWebhookTarget(webhookTargets, target).unregister;
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) {
    return false;
  }
  // Sunday sends plain hex; accept optional "sha256=" prefix for flexibility.
  const receivedHash = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const computed = createHmac("sha256", secret).update(body).digest("hex");
  return computed === receivedHash;
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) {
    return true;
  }
  const normalized = senderId.toLowerCase();
  return allowFrom.some((entry) => {
    const clean = entry.toLowerCase().replace(/^(sunday|sun):/i, "");
    return clean === normalized;
  });
}

export async function handleSundayWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }
  const { targets } = resolved;

  if (rejectNonPostWebhookRequest(req, res)) {
    return true;
  }

  // Read the raw body string so HMAC is verified against the exact bytes the
  // Sunday backend signed (re-serializing via JSON.stringify can change whitespace/ordering).
  let rawBody: string;
  try {
    rawBody = await readRequestBodyWithLimit(req, {
      maxBytes: 1024 * 1024,
      timeoutMs: 30_000,
    });
  } catch (err) {
    if (isRequestBodyLimitError(err)) {
      res.statusCode =
        err.code === "PAYLOAD_TOO_LARGE" ? 413 : err.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
      res.end(requestBodyErrorToText(err.code));
      return true;
    }
    res.statusCode = 400;
    res.end("bad request");
    return true;
  }

  let bodyValue: unknown;
  try {
    bodyValue = rawBody.trim() ? JSON.parse(rawBody) : null;
  } catch {
    res.statusCode = 400;
    res.end("invalid JSON");
    return true;
  }

  const signature = String(req.headers["x-sunday-signature"] ?? "");
  const bodyString = rawBody;

  // Match target by valid HMAC signature (using webhookSecret)
  const matching = targets.filter((t) =>
    verifySignature(bodyString, signature, t.account.webhookSecret),
  );

  if (matching.length === 0) {
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }

  const target = matching[0];
  const event = bodyValue as SundayWebhookEvent | null;

  if (!event?.event) {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }

  target.statusSink?.({ lastInboundAt: Date.now() });

  const data = event.data;
  target.runtime.log?.(
    `[${target.account.accountId}] Sunday webhook received: event=${event.event} userId=${data?.userId ?? "?"} conversationId=${data?.conversationId ?? "?"} content=${typeof data?.content === "string" ? `"${data.content.slice(0, 100)}"` : "(none)"}`,
  );

  if (event.event === "message.created") {
    processInboundMessage(event, target).catch((err) => {
      target.runtime.error?.(`[${target.account.accountId}] Sunday webhook failed: ${String(err)}`);
    });
  } else if (event.event === "agent.installed") {
    processAgentInstalled(event, target).catch((err) => {
      target.runtime.error?.(
        `[${target.account.accountId}] Sunday agent.installed handler failed: ${String(err)}`,
      );
    });
  } else if (event.event === "agent.uninstalled") {
    target.runtime.log?.(
      `[${target.account.accountId}] Agent uninstalled by userId=${data?.userId ?? "?"}`,
    );
  } else if (event.event === "permission.response") {
    target.runtime.log?.(
      `[${target.account.accountId}] Permission ${data?.permissionId ?? "?"} ${data?.status ?? "?"} by userId=${data?.userId ?? "?"}`,
    );
  } else if (event.event === "decision.response") {
    target.runtime.log?.(
      `[${target.account.accountId}] Decision response: userId=${data?.userId ?? "?"} selected="${data?.selectedOption ?? "?"}"`,
    );
  }

  res.statusCode = 200;
  res.end("ok");
  return true;
}

async function processAgentInstalled(
  event: SundayWebhookEvent,
  target: WebhookTarget,
): Promise<void> {
  const data = event.data;
  const userId = data.userId;
  if (!userId) return;
  target.runtime.log?.(
    `[${target.account.accountId}] Agent installed by userId=${userId}, sending welcome`,
  );
  const creds: SundayCredentials = {
    agentId: target.account.agentId,
    apiKey: target.account.apiKey,
    apiBaseUrl: target.account.apiBaseUrl,
  };
  try {
    await sendMessage(
      creds,
      { userId, conversationId: data.conversationId },
      "👋 Hello! I'm ready to help. Send me a message to get started.",
    );
    target.statusSink?.({ lastOutboundAt: Date.now() });
  } catch (err) {
    target.runtime.error?.(
      `[${target.account.accountId}] Welcome message failed for ${userId}: ${String(err)}`,
    );
  }
}

async function processInboundMessage(
  event: SundayWebhookEvent,
  target: WebhookTarget,
): Promise<void> {
  const data = event.data;
  const conversationId = data.conversationId;
  const userId = data.userId;
  const messageText = typeof data.content === "string" ? data.content : "";
  const messageId = typeof data.messageId === "string" ? data.messageId : "";

  if (!messageText.trim()) {
    target.runtime.log?.(`[${target.account.accountId}] Skipping empty message from ${userId}`);
    return;
  }

  target.runtime.log?.(
    `[${target.account.accountId}] Processing message from ${userId}: "${messageText.slice(0, 80)}"`,
  );

  await processMessageWithPipeline({
    conversationId,
    userId,
    messageId,
    text: messageText,
    timestamp: data.timestamp ?? event.timestamp,
    account: target.account,
    config: target.config,
    runtime: target.runtime,
    core: target.core,
    statusSink: target.statusSink,
  });

  if (messageId) {
    const creds: SundayCredentials = {
      agentId: target.account.agentId,
      apiKey: target.account.apiKey,
      apiBaseUrl: target.account.apiBaseUrl,
    };
    try {
      await markMessagesAsRead(creds, [messageId]);
    } catch {
      // Best-effort; don't fail the message pipeline over ack failures.
    }
  }
}

async function processMessageWithPipeline(params: {
  conversationId: string;
  userId: string;
  messageId: string;
  text: string;
  timestamp?: string;
  account: ResolvedSundayAccount;
  config: OpenClawConfig;
  runtime: SundayRuntimeEnv;
  core: SundayCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { conversationId, userId, messageId, text, account, config, runtime, core, statusSink } =
    params;
  const senderId = userId;
  const chatId = conversationId;
  const rawBody = text.trim();

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));
  const { senderAllowedForCommands, commandAuthorized } = await resolveSenderCommandAuthorization({
    cfg: config,
    rawBody,
    isGroup: false,
    dmPolicy,
    configuredAllowFrom: configAllowFrom,
    senderId,
    isSenderAllowed,
    readAllowFromStore: () => core.channel.pairing.readAllowFromStore("sunday"),
    shouldComputeCommandAuthorized: (body, cfg) =>
      core.channel.commands.shouldComputeCommandAuthorized(body, cfg),
    resolveCommandAuthorizedFromAuthorizers: (authParams) =>
      core.channel.commands.resolveCommandAuthorizedFromAuthorizers(authParams),
  });

  if (dmPolicy === "disabled") {
    runtime.log?.(
      `[${account.accountId}] DM policy is disabled — ignoring message from ${senderId}`,
    );
    return;
  }

  if (dmPolicy !== "open") {
    if (!senderAllowedForCommands) {
      runtime.log?.(`[${account.accountId}] Sender ${senderId} not allowed (dmPolicy=${dmPolicy})`);
      if (dmPolicy === "pairing") {
        const creds: SundayCredentials = {
          agentId: account.agentId,
          apiKey: account.apiKey,
          apiBaseUrl: account.apiBaseUrl,
        };
        const { code, created } = await core.channel.pairing.upsertPairingRequest({
          channel: "sunday",
          id: senderId,
          meta: {},
        });

        if (created) {
          runtime.log?.(
            `[${account.accountId}] Pairing request created for ${senderId} (code=${code})`,
          );
          try {
            await sendMessage(
              creds,
              { userId: senderId, conversationId: chatId },
              core.channel.pairing.buildPairingReply({
                channel: "sunday",
                idLine: `Your Sunday user id: ${senderId}`,
                code,
              }),
            );
            statusSink?.({ lastOutboundAt: Date.now() });
          } catch (err) {
            runtime.error?.(`sunday pairing reply failed for ${senderId}: ${String(err)}`);
          }
        } else {
          runtime.log?.(
            `[${account.accountId}] Pairing already pending for ${senderId} — ignoring`,
          );
        }
      }
      return;
    }
  }

  runtime.log?.(`[${account.accountId}] Sender ${senderId} authorized (dmPolicy=${dmPolicy})`);

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "sunday",
    accountId: account.accountId,
    peer: { kind: "direct", id: chatId },
  });
  runtime.log?.(
    `[${account.accountId}] Routed to agent=${route.agentId} session=${route.sessionKey}`,
  );

  const fromLabel = `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const parsedTimestamp = params.timestamp ? new Date(params.timestamp).getTime() : undefined;
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Sunday",
    from: fromLabel,
    timestamp: parsedTimestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `sunday:${senderId}`,
    To: `sunday:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: fromLabel,
    SenderName: undefined,
    SenderId: senderId,
    CommandAuthorized: commandAuthorized,
    Provider: "sunday",
    Surface: "sunday",
    MessageSid: messageId,
    OriginatingChannel: "sunday",
    OriginatingTo: `sunday:${chatId}`,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`sunday: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "sunday",
    accountId: account.accountId,
  });

  runtime.log?.(`[${account.accountId}] Dispatching to agent for reply...`);

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        runtime.log?.(
          `[${account.accountId}] Delivering reply to ${senderId}: "${(payload.text ?? "").slice(0, 80)}"`,
        );
        await deliverSundayReply({
          payload,
          account,
          userId: senderId,
          chatId,
          runtime,
          core,
          config,
          statusSink,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`[${account.accountId}] Sunday ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: { onModelSelected, disableBlockStreaming: true },
  });
}

async function deliverSundayReply(params: {
  payload: { text?: string };
  account: ResolvedSundayAccount;
  userId: string;
  chatId: string;
  runtime: SundayRuntimeEnv;
  core: SundayCoreRuntime;
  config: OpenClawConfig;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { payload, account, userId, chatId, runtime, config, core, statusSink } = params;
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "sunday",
    accountId: account.accountId,
  });
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  if (!text) {
    return;
  }

  const creds: SundayCredentials = {
    agentId: account.agentId,
    apiKey: account.apiKey,
    apiBaseUrl: account.apiBaseUrl,
  };

  const chunkMode = core.channel.text.resolveChunkMode(config, "sunday", account.accountId);
  const chunks = core.channel.text.chunkMarkdownTextWithMode(text, 4000, chunkMode);
  for (const chunk of chunks) {
    try {
      await sendMessage(creds, { userId, conversationId: chatId }, chunk);
      statusSink?.({ lastOutboundAt: Date.now() });
    } catch (err) {
      runtime.error?.(`Sunday message send failed: ${String(err)}`);
    }
  }
}

/**
 * Initialize the Sunday provider on gateway startup:
 * 1. Register webhook URL with Sunday platform
 * 2. Fetch and process pending messages received while offline
 */
export async function initSundayProvider(
  options: SundayMonitorOptions,
): Promise<SundayMonitorResult> {
  const { account, config, runtime, abortSignal, webhookUrl, webhookPath, statusSink } = options;
  const core = getSundayRuntime();

  const creds: SundayCredentials = {
    agentId: account.agentId,
    apiKey: account.apiKey,
    apiBaseUrl: account.apiBaseUrl,
  };

  // Register webhook target FIRST so inbound webhooks are handled immediately,
  // even while Steps 1-2 (network calls) are still in progress.
  const path = webhookPath || "/webhooks/sunday";
  let stopped = false;

  const unregister = registerSundayWebhookTarget({
    account,
    config,
    runtime,
    core,
    path,
    statusSink,
  });

  const stop = () => {
    if (!stopped) {
      stopped = true;
      unregister();
    }
  };

  abortSignal.addEventListener("abort", stop, { once: true });

  // Step 1: Register webhook URL with Sunday (retry up to 3 times since the
  // Sunday backend may be cold-starting on Cloud Run).
  if (webhookUrl) {
    let registered = false;
    for (let attempt = 1; attempt <= 3 && !registered; attempt++) {
      if (abortSignal.aborted) break;
      try {
        await registerWebhook(creds, webhookUrl);
        runtime.log?.(`[${account.accountId}] Sunday webhook registered: ${webhookUrl}`);
        registered = true;
      } catch (err) {
        runtime.error?.(
          `[${account.accountId}] Sunday webhook registration failed (attempt ${attempt}/3): ${String(err)}`,
        );
        if (attempt < 3 && !abortSignal.aborted) {
          await new Promise((r) => setTimeout(r, 3_000 * attempt));
        }
      }
    }
  }

  // Step 2: Fetch and process pending messages once on startup (catch-up)
  if (!abortSignal.aborted) {
    try {
      const pending = await fetchPendingMessages(creds, 30_000);
      const messages = pending.messages ?? [];
      if (messages.length > 0) {
        runtime.log?.(
          `[${account.accountId}] Processing ${messages.length} pending Sunday message(s)`,
        );
        const processedIds: string[] = [];
        for (const msg of messages) {
          try {
            await processPendingMessage(msg, account, config, runtime, core, statusSink);
            processedIds.push(msg.id);
          } catch (msgErr) {
            runtime.error?.(
              `[${account.accountId}] Sunday pending message ${msg.id} failed: ${String(msgErr)}`,
            );
          }
        }
        if (processedIds.length > 0) {
          try {
            await markMessagesAsRead(creds, processedIds);
          } catch (ackErr) {
            runtime.error?.(
              `[${account.accountId}] Sunday markMessagesAsRead failed: ${String(ackErr)}`,
            );
          }
        }
      } else {
        runtime.log?.(`[${account.accountId}] No pending Sunday messages`);
      }
    } catch (err) {
      runtime.error?.(
        `[${account.accountId}] Sunday pending messages fetch failed: ${String(err)}`,
      );
    }
  }

  runtime.log?.(`[${account.accountId}] Sunday provider ready (webhook mode)`);

  // Keep the provider alive -- webhooks arrive via the HTTP handler.
  // The provider only exits when the gateway sends the abort signal.
  await new Promise<void>((resolve) => {
    if (abortSignal.aborted) {
      resolve();
      return;
    }
    abortSignal.addEventListener("abort", () => resolve(), { once: true });
  });

  return { stop };
}

async function processPendingMessage(
  msg: SundayPendingMessage,
  account: ResolvedSundayAccount,
  config: OpenClawConfig,
  runtime: SundayRuntimeEnv,
  core: SundayCoreRuntime,
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
): Promise<void> {
  statusSink?.({ lastInboundAt: Date.now() });
  await processMessageWithPipeline({
    conversationId: msg.conversationId,
    userId: msg.senderId,
    messageId: msg.id,
    text: msg.content,
    timestamp: msg.timestamp,
    account,
    config,
    runtime,
    core,
    statusSink,
  });
}
