# Sunday Plugin — Setup Guide

---

## Automated Provisioning (Cloud Run)

The recommended approach: the Sunday backend deploys an OpenClaw instance to
GCP Cloud Run automatically when an agent needs a runtime.

### Architecture

```
POST /provisionAgent {userId, modelApiKey}
  → Sunday backend creates agent → get agentId, apiKey, apiSecret
  → Computes deterministic Cloud Run service URL
  → Deploys pre-built Docker image to Cloud Run with env vars (incl. SERVICE_URL)
  → Gateway boots, self-registers webhook via SERVICE_URL
  → User installs agent → agent.installed webhook → ready for conversation
  → Returns {agentId, serviceUrl, webhookUrl}
```

### Docker Image

The image is built automatically by GitHub Actions (`.github/workflows/sunday-cloudrun.yml`)
and pushed to `gcr.io/{GCP_PROJECT}/openclaw-sunday:latest` on every push to
`feature/sunday-plugin` or `main`.

Build manually:

```bash
docker build -f extensions/sunday/deploy/Dockerfile.cloudrun -t gcr.io/PROJECT/openclaw-sunday:latest .
docker push gcr.io/PROJECT/openclaw-sunday:latest
```

### Environment Variables

The image reads these env vars at startup to auto-configure OpenClaw:

| Env Var                  | Required      | Default                                                   | Description                                                                  |
| ------------------------ | ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `SUNDAY_AGENT_ID`        | Yes           | —                                                         | Agent ID (created by the backend during provisioning)                        |
| `SUNDAY_API_KEY`         | Yes           | —                                                         | Agent API key (64-char hex)                                                  |
| `SUNDAY_WEBHOOK_SECRET`  | Yes           | —                                                         | Agent secret for HMAC verification                                           |
| `SUNDAY_API_BASE_URL`    | No            | `https://sunday-backend-612819501028.us-central1.run.app` | Sunday backend URL                                                           |
| `MODEL_API_KEY`          | Yes           | —                                                         | AI model provider API key                                                    |
| `MODEL_BASE_URL`         | No            | `https://api.deepseek.com/v1`                             | Model API endpoint                                                           |
| `MODEL_ID`               | No            | `deepseek-chat`                                           | Model identifier                                                             |
| `SERVICE_URL`            | Yes           | —                                                         | Public Cloud Run URL; gateway derives webhook URL and self-registers on boot |
| `PORT`                   | No (reserved) | `8080`                                                    | Cloud Run injects this automatically                                         |
| `OPENCLAW_GATEWAY_TOKEN` | No            | auto-generated                                            | Gateway auth token                                                           |

### Backend Implementation Guide (`POST /provisionAgent`)

The Sunday backend should implement an endpoint that creates an agent and
provisions an OpenClaw Cloud Run service for a user.

**Request:**

```json
{
  "userId": "string (required)",
  "modelApiKey": "string (required)",
  "agentName": "string (optional)",
  "modelBaseUrl": "string (optional)",
  "modelId": "string (optional)",
  "region": "string (optional, default: us-central1)"
}
```

**Backend steps:**

1. **Check if user already provisioned** — query `provisionedAgents` by
   `userId`. Return 409 with existing details if found.

2. **Create the agent** in Firestore — generate `agentId`, `apiKey` (64-char
   hex), and `apiSecret` (webhook HMAC secret). Store the SHA-256 hash of
   `apiKey` (not the raw key) in Firestore.

3. **Compute the service URL** — Cloud Run URLs are deterministic:
   `https://{serviceName}-{projectNumber}.{region}.run.app`. Generate the
   service name as `openclaw-agent-{first 8 chars of agentId}` (lowercase,
   max 63 chars).

4. **Deploy to Cloud Run** via the Cloud Run Admin API v2 or `@google-cloud/run` SDK:
   - **Image**: `gcr.io/{PROJECT}/openclaw-sunday:latest`
   - **Port**: `8080`
   - **Env vars**: `SUNDAY_AGENT_ID`, `SUNDAY_API_KEY`, `SUNDAY_WEBHOOK_SECRET`,
     `SUNDAY_API_BASE_URL`, `MODEL_API_KEY`, `MODEL_BASE_URL`, `MODEL_ID`,
     `SERVICE_URL`
   - **Settings**:
     - `minInstances: 1` — gateway must be running to receive webhooks
     - `cpu: 1`, `memory: 1Gi`
     - `cpuThrottling: false` — webhook handler returns 200 immediately and
       processes the AI response async; CPU must stay active
     - `invokerIamDisabled: true` (allow unauthenticated) — Sunday sends
       webhooks directly; HMAC signature verification handles auth
     - `timeout: 300s`

5. **Store the mapping** `{userId, agentId, serviceName, serviceUrl}` in
   Firestore for future management (update, scale, delete).

The gateway self-registers its webhook on startup using `SERVICE_URL`.
No separate `/updateAgentWebhook` call needed.

**Response:**

```json
{
  "success": true,
  "agentId": "abc12345-...",
  "serviceUrl": "https://openclaw-agent-abc12345-1770837759.us-central1.run.app",
  "serviceName": "openclaw-agent-abc12345",
  "webhookUrl": "https://openclaw-agent-abc12345-1770837759.us-central1.run.app/webhooks/sunday",
  "status": "provisioned"
}
```

**Error cases:**

| Status | Condition                                                      |
| ------ | -------------------------------------------------------------- |
| 400    | Missing `userId` or `modelApiKey`                              |
| 404    | User not found                                                 |
| 409    | User already has a provisioned agent — return existing details |
| 500    | GCP deployment failed                                          |

### Required GitHub Secrets

For the CI workflow (`.github/workflows/sunday-cloudrun.yml`):

- `GCP_PROJECT_ID` — GCP project ID
- `GCP_SA_KEY` — JSON service account key with GCR push access

### Cloud Run Settings Rationale

- **`minInstances: 1`** — The gateway is a long-running process. Without this,
  Cloud Run scales to zero and webhooks fail until a cold start completes.
- **`cpuThrottling: false`** — The webhook handler acknowledges the request
  immediately (HTTP 200) and processes the AI model call asynchronously.
  Without always-on CPU, the async processing gets throttled after the
  HTTP response.
- **`allowUnauthenticated`** — Sunday delivers webhooks as plain HTTPS POSTs.
  Authentication is handled by HMAC-SHA256 signature verification
  (`X-Sunday-Signature` header) inside the OpenClaw gateway.

---

## Manual Setup (VM)

Complete steps to install OpenClaw with the Sunday plugin on a fresh GCP VM (Ubuntu/Debian).

### 1. Install Node.js 22+

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Enable pnpm via corepack

```bash
sudo corepack enable
```

### 3. Clone the repository

```bash
cd ~
git clone https://YOUR_TOKEN@github.com/YOUR_USERNAME/openclaw.git
cd openclaw
git checkout feature/sunday-plugin
```

### 4. Install dependencies and build

```bash
pnpm install
pnpm build
```

### 5. Run initial setup

```bash
pnpm openclaw setup
pnpm openclaw config set gateway.mode local
```

### 6. Configure the Sunday channel

Set the required environment variables or write them into `~/.openclaw/openclaw.json`
under `channels.sunday`:

```bash
export SUNDAY_AGENT_ID="your-agent-id"
export SUNDAY_API_KEY="your-api-key"
export SUNDAY_WEBHOOK_SECRET="your-api-secret"
export SUNDAY_API_BASE_URL="https://sunday-backend-612819501028.us-central1.run.app"
```

Then add the model provider and enable the plugin in `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "deepseek/deepseek-chat" }
    }
  },
  "channels": {
    "sunday": {
      "enabled": true,
      "dmPolicy": "open",
      "apiBaseUrl": "https://sunday-backend-612819501028.us-central1.run.app"
    }
  },
  "gateway": { "mode": "local" },
  "plugins": { "entries": { "sunday": { "enabled": true } } },
  "models": {
    "providers": {
      "deepseek": {
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "YOUR_DEEPSEEK_API_KEY",
        "api": "openai-completions",
        "models": [
          {
            "id": "deepseek-chat",
            "name": "DeepSeek Chat",
            "contextWindow": 128000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

### 7. Start the gateway

```bash
pnpm openclaw gateway run --bind lan --port 18789 --token $(openssl rand -hex 16)
```

Save the printed token for future use.

#### Background mode (survives SSH disconnect)

```bash
nohup pnpm openclaw gateway run --bind lan --port 18789 --token YOUR_TOKEN > /tmp/openclaw-gateway.log 2>&1 &
```

### 8. Verify

- Gateway log shows `agent model: deepseek/deepseek-chat`
- Sunday provider shows `starting Sunday provider`
- Send a message through Sunday and confirm a reply comes back
