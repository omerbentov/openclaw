#!/usr/bin/env bash
set -euo pipefail

# Env vars injected by Cloud Run at deploy time:
#   SUNDAY_AGENT_ID, SUNDAY_API_KEY, SUNDAY_API_SECRET  – read by credentials.ts
#   SUNDAY_API_BASE_URL  – Sunday backend URL (read by accounts.ts)
#   SERVICE_URL          – public Cloud Run URL (e.g. https://openclaw-sunday-1-abc123.europe-west1.run.app)
#   MODEL_API_KEY        – AI model provider API key
#   MODEL_BASE_URL       – model API endpoint (default: https://api.deepseek.com/v1)
#   MODEL_ID             – model identifier  (default: deepseek-chat)
#   PORT                 – Cloud Run sets this automatically from the container port setting
#   OPENCLAW_GATEWAY_TOKEN – gateway auth token (auto-generated if unset)

export PORT="${PORT:-8080}"
export MODEL_BASE_URL="${MODEL_BASE_URL:-https://api.deepseek.com/v1}"
export MODEL_ID="${MODEL_ID:-deepseek-chat}"
export SUNDAY_API_BASE_URL="${SUNDAY_API_BASE_URL:-https://sunday-backend-612819501028.us-central1.run.app}"

if [ -z "${MODEL_API_KEY:-}" ]; then
  echo "ERROR: MODEL_API_KEY env var is required" >&2
  exit 1
fi

if [ -z "${SUNDAY_AGENT_ID:-}" ] || [ -z "${SUNDAY_API_KEY:-}" ] || [ -z "${SUNDAY_API_SECRET:-}" ]; then
  echo "ERROR: SUNDAY_AGENT_ID, SUNDAY_API_KEY, and SUNDAY_API_SECRET env vars are required" >&2
  exit 1
fi

if [ -z "${SERVICE_URL:-}" ]; then
  echo "WARNING: SERVICE_URL env var not set – webhook will not be registered; Sunday will use polling only" >&2
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
  apiSecret: s(process.env.SUNDAY_API_SECRET),
  dmPolicy: "open",
  allowFrom: ["*"],
  apiBaseUrl: s(process.env.SUNDAY_API_BASE_URL),
};
const serviceUrl = s(process.env.SERVICE_URL);
if (serviceUrl) sunday.webhookUrl = serviceUrl + "/webhooks/sunday";
const modelId = s(process.env.MODEL_ID) || "deepseek-chat";
const config = {
  agents: {
    defaults: {
      model: { primary: "deepseek/" + modelId },
      workspace: process.env.CONFIG_DIR + "/workspace",
      blockStreamingDefault: "off",
    },
  },
  commands: { native: "auto", nativeSkills: "auto" },
  channels: { sunday },
  gateway: { mode: "local" },
  plugins: { entries: { sunday: { enabled: true } } },
  models: {
    providers: {
      deepseek: {
        baseUrl: s(process.env.MODEL_BASE_URL) || "https://api.deepseek.com/v1",
        apiKey: s(process.env.MODEL_API_KEY),
        api: "openai-completions",
        models: [{
          id: modelId,
          name: "DeepSeek Chat",
          contextWindow: 128000,
          maxTokens: 8192,
        }],
      },
    },
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
