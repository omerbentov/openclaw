#!/usr/bin/env bash
set -euo pipefail

# Required env vars:
#   SUNDAY_AGENT_ID      – Sunday agent ID
#   SUNDAY_API_KEY       – Sunday API key
#   SUNDAY_WEBHOOK_SECRET – webhook HMAC signing secret
#   MODEL_API_KEY        – AI model provider API key (DeepSeek)
#
# Optional env vars:
#   SERVICE_URL          – public URL (auto-detected on Cloud Run if not set)
#   SUNDAY_API_BASE_URL  – override Sunday backend URL
#   MODEL_BASE_URL       – model API endpoint (default: https://api.deepseek.com/v1)
#   MODEL_ID             – model identifier  (default: deepseek-chat)
#   PORT                 – listen port (default: 8080; Cloud Run sets this automatically)
#   OPENCLAW_GATEWAY_TOKEN – gateway auth token (auto-generated if unset)

export PORT="${PORT:-8080}"
export MODEL_BASE_URL="${MODEL_BASE_URL:-https://api.deepseek.com/v1}"
export MODEL_ID="${MODEL_ID:-deepseek-chat}"

if [ -z "${MODEL_API_KEY:-}" ]; then
  echo "ERROR: MODEL_API_KEY env var is required" >&2
  exit 1
fi

if [ -z "${SUNDAY_AGENT_ID:-}" ] || [ -z "${SUNDAY_API_KEY:-}" ] || [ -z "${SUNDAY_WEBHOOK_SECRET:-}" ]; then
  echo "ERROR: SUNDAY_AGENT_ID, SUNDAY_API_KEY, and SUNDAY_WEBHOOK_SECRET env vars are required" >&2
  exit 1
fi

# Auto-detect SERVICE_URL on Cloud Run from metadata server if not explicitly set.
# Cloud Run sets K_SERVICE automatically; URL format: https://{service}-{project-number}.{region}.run.app
if [ -z "${SERVICE_URL:-}" ] && [ -n "${K_SERVICE:-}" ]; then
  META="http://metadata.google.internal/computeMetadata/v1"
  META_HEADER="Metadata-Flavor: Google"
  PROJECT_NUMBER="$(curl -sf -H "${META_HEADER}" "${META}/project/numeric-project-id" 2>/dev/null || true)"
  REGION_RAW="$(curl -sf -H "${META_HEADER}" "${META}/instance/region" 2>/dev/null || true)"
  REGION="${REGION_RAW##*/}"
  if [ -n "${PROJECT_NUMBER}" ] && [ -n "${REGION}" ]; then
    SERVICE_URL="https://${K_SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
    export SERVICE_URL
    echo "Auto-detected SERVICE_URL: ${SERVICE_URL}"
  fi
fi

if [ -z "${SERVICE_URL:-}" ]; then
  echo "WARNING: SERVICE_URL not set and could not be auto-detected – webhook will not be registered; Sunday will use polling only" >&2
fi

if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 16)"
  export OPENCLAW_GATEWAY_TOKEN
fi

export CONFIG_DIR="${HOME}/.openclaw"
mkdir -p "${CONFIG_DIR}/workspace"

node -e '
const s = (v) => v?.trim() || "";
const sunday = {
  enabled: true,
  agentId: s(process.env.SUNDAY_AGENT_ID),
  apiKey: s(process.env.SUNDAY_API_KEY),
  webhookSecret: s(process.env.SUNDAY_WEBHOOK_SECRET),
  dmPolicy: "open",
};
const apiBaseUrl = s(process.env.SUNDAY_API_BASE_URL);
if (apiBaseUrl) sunday.apiBaseUrl = apiBaseUrl;
const serviceUrl = s(process.env.SERVICE_URL);
if (serviceUrl) sunday.webhookUrl = serviceUrl + "/webhooks/sunday";
const modelId = s(process.env.MODEL_ID) || "deepseek-chat";
const gatewayToken = s(process.env.OPENCLAW_GATEWAY_TOKEN);
const config = {
  models: {
    providers: {
      deepseek: {
        baseUrl: s(process.env.MODEL_BASE_URL) || "https://api.deepseek.com/v1",
        api: "openai-completions",
        apiKey: s(process.env.MODEL_API_KEY),
        models: [
          {
            id: "deepseek-chat",
            name: "DeepSeek Chat (V3)",
            input: ["text"],
            cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
            contextWindow: 65536,
            maxTokens: 8192,
          },
          {
            id: "deepseek-reasoner",
            name: "DeepSeek Reasoner (R1)",
            reasoning: true,
            input: ["text"],
            cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
            contextWindow: 65536,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "deepseek/" + modelId },
      workspace: process.env.CONFIG_DIR + "/workspace",
      compaction: { mode: "safeguard" },
      maxConcurrent: 4,
      subagents: { maxConcurrent: 8 },
    },
  },
  messages: { ackReactionScope: "group-mentions" },
  commands: { native: "auto", nativeSkills: "auto" },
  channels: { sunday },
  gateway: {
    port: parseInt(process.env.PORT, 10) || 8080,
    mode: "local",
    bind: "lan",
    auth: { mode: "token", token: gatewayToken },
    tailscale: { mode: "off", resetOnExit: false },
    nodes: {
      denyCommands: [
        "camera.snap",
        "camera.clip",
        "screen.record",
        "calendar.add",
        "contacts.add",
        "reminders.add",
      ],
    },
  },
  plugins: {
    load: { paths: ["/app/extensions/sunday"] },
    entries: { sunday: { enabled: true } },
  },
};
require("fs").writeFileSync(
  process.env.CONFIG_DIR + "/openclaw.json",
  JSON.stringify(config, null, 2) + "\n",
);
'

echo "Config written to ${CONFIG_DIR}/openclaw.json"

export NODE_OPTIONS="--max-old-space-size=3072 ${NODE_OPTIONS:-}"

exec node openclaw.mjs gateway --bind lan --port "${PORT}" --token "${OPENCLAW_GATEWAY_TOKEN}"
