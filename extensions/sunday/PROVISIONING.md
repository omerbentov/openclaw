# Sunday Auto-Provisioning — Backend Implementation Guide

This document describes how to implement the `POST /provisionAgent` endpoint in
the Sunday backend, and what GitHub/GCP configuration is needed for the CI
pipeline that builds the OpenClaw Docker image.

---

## 1. GitHub Actions Setup

The workflow `.github/workflows/sunday-cloudrun.yml` builds the Docker image and
pushes it to Google Container Registry. It triggers on pushes to
`feature/sunday-plugin` or `main` when Sunday extension files change.

### Required GitHub Secrets

Go to the repo **Settings > Secrets and variables > Actions** and add:

| Secret           | Value                                              | How to get it                     |
| ---------------- | -------------------------------------------------- | --------------------------------- |
| `GCP_PROJECT_ID` | Your GCP project ID (e.g. `sunday-platform-12345`) | `gcloud config get-value project` |
| `GCP_SA_KEY`     | JSON service account key                           | See below                         |

### Create the GCP Service Account (GitHub Actions)

This SA only pushes Docker images to GCR. It does NOT deploy Cloud Run services.

| Role                  | Why                                                        |
| --------------------- | ---------------------------------------------------------- |
| `roles/storage.admin` | GCR stores images in a GCS bucket; needs read/write access |

```bash
# Create service account
gcloud iam service-accounts create github-gcr-push \
  --display-name="GitHub Actions GCR Push"

# Grant push access to Container Registry (GCR uses a GCS bucket)
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:github-gcr-push@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

# Generate the JSON key
gcloud iam service-accounts keys create key.json \
  --iam-account=github-gcr-push@PROJECT_ID.iam.gserviceaccount.com

# Copy the contents of key.json into the GCP_SA_KEY GitHub secret
cat key.json

# Delete the local key file after copying
rm key.json
```

### Create the GCP Service Account (Sunday Backend)

This SA is used by the Sunday backend to deploy and manage Cloud Run services.

| Role                           | Why                                                    |
| ------------------------------ | ------------------------------------------------------ |
| `roles/run.admin`              | Create, update, delete Cloud Run services              |
| `roles/iam.serviceAccountUser` | Act as the Cloud Run runtime SA (required to deploy)   |
| `roles/run.invoker`            | Set IAM policy to allow unauthenticated webhook access |

```bash
# Create service account
gcloud iam service-accounts create sunday-provisioner \
  --display-name="Sunday Agent Provisioner"

# Grant roles
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:sunday-provisioner@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:sunday-provisioner@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:sunday-provisioner@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Generate the JSON key (use in your backend)
gcloud iam service-accounts keys create sunday-provisioner-key.json \
  --iam-account=sunday-provisioner@PROJECT_ID.iam.gserviceaccount.com
```

### Enable required GCP APIs

```bash
gcloud services enable containerregistry.googleapis.com
gcloud services enable run.googleapis.com
```

### Verify

After pushing to `feature/sunday-plugin`, check the Actions tab. On success the
image will be at:

```
gcr.io/PROJECT_ID/openclaw-sunday:latest
gcr.io/PROJECT_ID/openclaw-sunday:<commit-sha>
```

---

## 2. Backend Endpoint: `POST /provisionAgent`

### Request

```json
{
  "userId": "string (required)",
  "modelApiKey": "string (required)",
  "agentName": "string (optional, default: auto-generated)",
  "agentDescription": "string (optional)",
  "modelBaseUrl": "string (optional, default: https://api.deepseek.com/v1)",
  "modelId": "string (optional, default: deepseek-chat)",
  "region": "string (optional, default: us-central1)"
}
```

### Flow

```
1. Validate request
2. Check if user already has a provisioned agent → 409 if yes
3. Create agent in Firestore (POST /createAgent) → get agentId, apiKey, apiSecret
4. Compute service URL (deterministic from service name + project number + region)
5. Deploy Cloud Run service with SERVICE_URL env var
6. Allow unauthenticated access (IAM policy)
7. Store mapping in Firestore (userId → agentId, serviceName, serviceUrl)
8. Return result

The gateway self-registers its webhook on startup using SERVICE_URL.
No separate /updateAgentWebhook call needed.
```

### Step-by-step

#### Step 1: Validate

- `userId` and `modelApiKey` are required (400 if missing)
- User must exist (404 if not)

#### Step 2: Check if already provisioned

```typescript
const existing = await db
  .collection("provisionedAgents")
  .where("userId", "==", userId)
  .limit(1)
  .get();

if (!existing.empty) {
  const doc = existing.docs[0].data();
  return res.status(409).json({
    error: "User already has a provisioned agent",
    agentId: doc.agentId,
    serviceUrl: doc.serviceUrl,
    webhookUrl: doc.webhookUrl,
  });
}
```

#### Step 3: Create the agent

Create a new agent record in Firestore and generate credentials. The raw
`apiKey` is returned to the caller (and passed to the container); only the
SHA-256 hash (`apiKeyHash`) is stored in Firestore.

```typescript
import { randomBytes, createHash } from "node:crypto";

const agentId = db.collection("agents").doc().id;
const apiKey = randomBytes(32).toString("hex"); // 64-char hex
const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
const apiSecret = randomBytes(32).toString("hex"); // webhook HMAC secret

await db
  .collection("agents")
  .doc(agentId)
  .set({
    userId,
    name: req.body.agentName || `Agent ${agentId.slice(0, 6)}`,
    description: req.body.agentDescription || "",
    apiKeyHash,
    webhookSecret: apiSecret,
    isActive: true,
    isPublic: false,
    installCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
```

#### Step 4: Compute the service URL and deploy to Cloud Run

Cloud Run URLs are deterministic: `https://{serviceName}-{projectNumber}.{region}.run.app`.
The backend knows all three values, so it can **pre-compute the URL** and pass it
as the `SERVICE_URL` env var. This lets the gateway self-register its webhook on
startup — no separate `/updateAgentWebhook` call needed afterward.

Using the `@google-cloud/run` SDK (v1):

```typescript
import { ServicesClient } from "@google-cloud/run";

const client = new ServicesClient();
const projectId = "YOUR_PROJECT_ID";
const projectNumber = "YOUR_PROJECT_NUMBER"; // numeric, e.g. "1770837759"
const region = req.body.region || "us-central1";
const serviceName = `openclaw-agent-${agentId.slice(0, 8).toLowerCase()}`;
const image = `gcr.io/${projectId}/openclaw-sunday:latest`;

// Pre-compute the service URL so the gateway can self-register webhooks on boot
const serviceUrl = `https://${serviceName}-${projectNumber}.${region}.run.app`;

const [operation] = await client.createService({
  parent: `projects/${projectId}/locations/${region}`,
  serviceId: serviceName,
  service: {
    template: {
      containers: [
        {
          image,
          ports: [{ containerPort: 8080 }],
          env: [
            { name: "SUNDAY_AGENT_ID", value: agentId },
            { name: "SUNDAY_API_KEY", value: apiKey },
            { name: "SUNDAY_WEBHOOK_SECRET", value: apiSecret },
            {
              name: "SUNDAY_API_BASE_URL",
              value: "https://sunday-backend-612819501028.us-central1.run.app",
            },
            { name: "MODEL_API_KEY", value: req.body.modelApiKey },
            {
              name: "MODEL_BASE_URL",
              value: req.body.modelBaseUrl || "https://api.deepseek.com/v1",
            },
            { name: "MODEL_ID", value: req.body.modelId || "deepseek-chat" },
            { name: "SERVICE_URL", value: serviceUrl },
          ],
          resources: {
            limits: { cpu: "1", memory: "1Gi" },
          },
        },
      ],
      scaling: {
        minInstanceCount: 1,
        maxInstanceCount: 1,
      },
    },
  },
});

// Wait for deployment to complete
const [service] = await operation.promise();
// serviceUrl is already known — no need to read it from the response
```

**Alternative: using `gcloud` CLI** (simpler, good for prototyping):

```typescript
import { execSync } from "child_process";

const serviceName = `openclaw-agent-${agentId.slice(0, 8).toLowerCase()}`;
const region = req.body.region || "us-central1";
const serviceUrl = `https://${serviceName}-${projectNumber}.${region}.run.app`;

const result = execSync(
  `gcloud run deploy ${serviceName} \
  --image gcr.io/${projectId}/openclaw-sunday:latest \
  --region ${region} \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --timeout 300 \
  --set-env-vars "\
SUNDAY_AGENT_ID=${agentId},\
SUNDAY_API_KEY=${apiKey},\
SUNDAY_WEBHOOK_SECRET=${apiSecret},\
SUNDAY_API_BASE_URL=https://sunday-backend-612819501028.us-central1.run.app,\
MODEL_API_KEY=${req.body.modelApiKey},\
MODEL_BASE_URL=${req.body.modelBaseUrl || "https://api.deepseek.com/v1"},\
MODEL_ID=${req.body.modelId || "deepseek-chat"},\
SERVICE_URL=${serviceUrl}" \
  --format json`,
  { encoding: "utf-8" },
);
```

#### Step 5: Allow unauthenticated access

If using the SDK, you also need to set the IAM policy to allow public access
(Cloud Run's `--allow-unauthenticated` equivalent):

```typescript
import { ServicesClient } from "@google-cloud/run";

await client.setIamPolicy({
  resource: `projects/${projectId}/locations/${region}/services/${serviceName}`,
  policy: {
    bindings: [
      {
        role: "roles/run.invoker",
        members: ["allUsers"],
      },
    ],
  },
});
```

#### Step 6: Webhook registration (automatic)

The gateway registers its webhook automatically on startup because `SERVICE_URL`
is set as an env var. The entrypoint derives `webhookUrl` from it
(`${SERVICE_URL}/webhooks/sunday`) and writes it into the OpenClaw config. The
Sunday provider then calls `POST /updateAgentWebhook` during initialization.

No backend action needed for this step.

#### Step 7: Store the mapping

```typescript
const webhookUrl = `${serviceUrl}/webhooks/sunday`;

await db.collection("provisionedAgents").doc(agentId).set({
  userId,
  agentId,
  serviceName,
  serviceUrl,
  webhookUrl,
  region,
  provisionedAt: new Date().toISOString(),
});
```

#### Step 8: Return

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

### Error Responses

| Status | Condition                            | Response                                                                                                          |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 400    | Missing `userId` or `modelApiKey`    | `{ "error": "userId and modelApiKey are required" }`                                                              |
| 404    | User not found                       | `{ "error": "User not found" }`                                                                                   |
| 409    | User already has a provisioned agent | `{ "error": "User already has a provisioned agent", "agentId": "...", "serviceUrl": "...", "webhookUrl": "..." }` |
| 500    | Cloud Run deployment failed          | `{ "error": "Provisioning failed", "details": "..." }`                                                            |

---

## 3. Environment Variables Reference

These env vars are injected into the Cloud Run container at deploy time.
The entrypoint script (`entrypoint.sh`) reads them and generates the OpenClaw
config file.

| Env Var                  | Required      | Default                                                   | Description                                                                                                                                                                       |
| ------------------------ | ------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUNDAY_AGENT_ID`        | Yes           | —                                                         | Agent ID (created by the backend in Step 3)                                                                                                                                       |
| `SUNDAY_API_KEY`         | Yes           | —                                                         | Agent API key (64-char hex)                                                                                                                                                       |
| `SUNDAY_WEBHOOK_SECRET`  | Yes           | —                                                         | Agent webhook secret for HMAC verification                                                                                                                                        |
| `SUNDAY_API_BASE_URL`    | No            | `https://sunday-backend-612819501028.us-central1.run.app` | Sunday backend URL                                                                                                                                                                |
| `MODEL_API_KEY`          | Yes           | —                                                         | AI model provider API key (from agent creator)                                                                                                                                    |
| `MODEL_BASE_URL`         | No            | `https://api.deepseek.com/v1`                             | Model API endpoint                                                                                                                                                                |
| `MODEL_ID`               | No            | `deepseek-chat`                                           | Model identifier                                                                                                                                                                  |
| `PORT`                   | No (reserved) | set via container port                                    | Cloud Run injects this automatically; set "Container port" to `18789` in service config                                                                                           |
| `SERVICE_URL`            | Yes           | —                                                         | Public Cloud Run URL (e.g. `https://openclaw-agent-abc12345-1770837759.us-central1.run.app`). Used to derive the webhook URL; the gateway calls `/updateAgentWebhook` on startup. |
| `OPENCLAW_GATEWAY_TOKEN` | No            | auto-generated                                            | Gateway auth token                                                                                                                                                                |

---

## 4. Cloud Run Settings Rationale

| Setting                | Value   | Why                                                                                                                                                                         |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minInstances`         | `1`     | Gateway must be running to receive webhooks. Without this, Cloud Run scales to zero and webhooks fail until cold start completes.                                           |
| `cpuThrottling`        | `false` | The webhook handler returns HTTP 200 immediately and processes the AI model call asynchronously. Without always-on CPU, async processing gets throttled after the response. |
| `allowUnauthenticated` | `true`  | Sunday delivers webhooks as plain HTTPS POSTs. Authentication is handled by HMAC-SHA256 signature verification (`X-Sunday-Signature` header) inside the gateway.            |
| `memory`               | `1Gi`   | Sufficient for Node.js gateway + AI model API calls.                                                                                                                        |
| `timeout`              | `300s`  | Allows long-running AI responses to complete.                                                                                                                               |

---

## 5. Optional: Teardown Endpoint

Consider adding `DELETE /provisionAgent/:agentId` to clean up:

```typescript
// Delete the Cloud Run service
await client.deleteService({
  name: `projects/${projectId}/locations/${region}/services/${serviceName}`,
});

// Remove from Firestore
await db.collection("provisionedAgents").doc(agentId).delete();
```

---

## 6. Optional: Update Endpoint

`PATCH /provisionAgent/:agentId` to update env vars (e.g. rotate model key):

```typescript
// Update the service with new env vars
await client.updateService({
  service: {
    name: `projects/${projectId}/locations/${region}/services/${serviceName}`,
    template: {
      containers: [
        {
          /* updated env vars */
        },
      ],
    },
  },
});
```
