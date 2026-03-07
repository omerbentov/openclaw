export type SundayAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start this Sunday account. Default: true. */
  enabled?: boolean;
  /** Agent ID from the Sunday platform. */
  agentId?: string;
  /** API key from the Sunday platform. */
  apiKey?: string;
  /** Webhook secret for verifying inbound webhook signatures (HMAC-SHA256). */
  webhookSecret?: string;
  /** Sunday API base URL (default: https://api.sunday.app). */
  apiBaseUrl?: string;
  /** Public webhook URL that Sunday should POST events to. */
  webhookUrl?: string;
  /** Webhook path for the gateway HTTP server (defaults to /webhooks/sunday). */
  webhookPath?: string;
  /** Direct message access policy (default: pairing). */
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  /** Allowlist for DM senders (Sunday user IDs). */
  allowFrom?: Array<string | number>;
  /** Custom system prompt injected into the agent when handling Sunday messages. */
  systemPrompt?: string;
};

export type SundayConfig = {
  /** Optional per-account Sunday configuration (multi-account). */
  accounts?: Record<string, SundayAccountConfig>;
  /** Default account ID when multiple accounts are configured. */
  defaultAccount?: string;
} & SundayAccountConfig;

export type SundayCredentialSource = "env" | "config" | "none";

export type ResolvedSundayAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  agentId: string;
  apiKey: string;
  webhookSecret: string;
  apiBaseUrl: string;
  credentialSource: SundayCredentialSource;
  config: SundayAccountConfig;
};

export type SundayWebhookEventData = {
  messageId?: string;
  conversationId: string;
  userId: string;
  content?: string;
  type?: string;
  timestamp?: string;
  /** Catch-all for extra fields (scopes, permissionId, etc.). */
  [key: string]: unknown;
};

export type SundayWebhookEvent = {
  event:
    | "message.created"
    | "agent.installed"
    | "agent.uninstalled"
    | "permission.response"
    | "decision.response";
  timestamp?: string;
  data: SundayWebhookEventData;
};

/** Matches the GET /getPendingMessages response message shape. */
export type SundayPendingMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isAgent: boolean;
  type: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  timestamp: string;
};
