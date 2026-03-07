# Sunday Agent API Documentation

Base URL: `https://sunday-backend-612819501028.us-central1.run.app`

All responses are JSON with `Content-Type: application/json`.

---

## Authentication

All agent-facing endpoints require the API key received during provisioning:

```
Authorization: Bearer <api_key>
Content-Type: application/json
```

The API key is a 64-character hex string. It is SHA256-hashed server-side and matched against Firestore. The agent must also have `isActive: true`.

---

## Response Format

### Success Response

```json
{
  "success": true,
  ...additional fields
}
```

HTTP Status: `200 OK`

### Error Response

```json
{
  "error": "Error message description"
}
```

HTTP Status: `400`, `401`, `403`, `404`, or `500`

---

## Endpoints

### 1. Send Message

```
POST /sendMessage
```

Send any message type to a user. The `type` field controls rendering.

**Request Body:**

```json
{
  "userId": "string (required)",
  "message": "string (required)",
  "conversationId": "string (optional - auto-resolved if omitted)",
  "type": "string (default: \"text\")",
  "metadata": {}
}
```

If `conversationId` is omitted, the server looks up an existing conversation between the agent and user, or creates a new one.

See [Supported Message Types](#supported-message-types) for all `type` values and their `metadata` schemas.

**Success Response:**

```json
{
  "success": true,
  "messageId": "string",
  "conversationId": "string"
}
```

**Error Responses:**

| Status | Error                               |
| ------ | ----------------------------------- |
| 400    | `Invalid request body`              |
| 400    | `Message content is required`       |
| 404    | `Agent not found`                   |
| 403    | `Agent not installed for this user` |
| 500    | `Failed to send message`            |

---

### 2. Request Permission

```
POST /requestPermission
```

Request user approval for an action. Creates a `permission_request` message in the conversation with approve/deny buttons.

**Request Body:**

```json
{
  "userId": "string (required)",
  "conversationId": "string (required)",
  "action": "string (required)",
  "reason": "string (required)"
}
```

**Success Response:**

```json
{
  "success": true,
  "permissionId": "string",
  "messageId": "string"
}
```

**Error Responses:**

| Status | Error                                 |
| ------ | ------------------------------------- |
| 400    | `Invalid request body`                |
| 400    | `Missing required fields`             |
| 500    | `Failed to create permission request` |

---

### 3. Check Permission

```
GET /checkPermission
```

**Query Parameters:**

| Param          | Type   | Description                  |
| -------------- | ------ | ---------------------------- |
| `permissionId` | string | The permission ID (required) |

**Success Response:**

```json
{
  "permissionId": "string",
  "status": "pending | approved | denied",
  "respondedAt": "2025-01-01T00:00:00Z"
}
```

`respondedAt` is `null` while status is `pending`.

**Error Responses:**

| Status | Error                      |
| ------ | -------------------------- |
| 400    | `permissionId is required` |
| 404    | `Permission not found`     |
| 403    | `Unauthorized`             |

---

### 4. Update Task Status

```
POST /updateTaskStatus
```

Send a progress update message.

**Request Body:**

```json
{
  "userId": "string (required)",
  "conversationId": "string (required)",
  "taskName": "string (required)",
  "status": "string (required)",
  "progress": 0
}
```

`progress` is an integer (0-100 percent).

**Success Response:**

```json
{
  "success": true,
  "messageId": "string"
}
```

**Error Responses:**

| Status | Error                          |
| ------ | ------------------------------ |
| 400    | `Invalid request body`         |
| 500    | `Failed to create task update` |

---

### 5. Update Todo List

```
POST /updateTodoList
```

Update an existing `todo_list` message in-place.

**Request Body:**

```json
{
  "messageId": "string (required)",
  "items": [
    {
      "id": "string",
      "title": "string",
      "status": "pending | in_progress | completed"
    }
  ],
  "status": "string (optional)"
}
```

---

### 6. Update Agent Webhook

```
POST /updateAgentWebhook
```

Register or update the webhook URL. Called automatically by the OpenClaw gateway on startup when `SERVICE_URL` is configured.

**Request Body:**

```json
{
  "webhookUrl": "string (required)"
}
```

**Success Response:**

```json
{
  "success": true,
  "message": "Webhook URL updated successfully",
  "webhookUrl": "https://example.com/webhook",
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

**Error Responses:**

| Status | Error                          |
| ------ | ------------------------------ |
| 400    | `Invalid request body`         |
| 400    | `Webhook URL is required`      |
| 500    | `Failed to update webhook URL` |

---

### 7. Get Pending Messages

```
GET /getPendingMessages
```

Returns all unread user messages across all conversations where `waitingForReply` is `true`. Used on startup to catch messages sent while the agent was offline.

**Success Response:**

```json
{
  "success": true,
  "messages": [
    {
      "id": "string",
      "conversationId": "string",
      "content": "string",
      "senderId": "string",
      "isAgent": false,
      "type": "text",
      "metadata": {},
      "read": false,
      "timestamp": "2025-01-01T00:00:00Z"
    }
  ]
}
```

**Error Responses:**

| Status | Error                         |
| ------ | ----------------------------- |
| 500    | `Failed to get conversations` |

---

### 8. Mark Messages as Read by Agent

```
POST /markMessagesAsReadByAgent
```

Acknowledge messages so they no longer appear in `getPendingMessages`.

**Request Body:**

```json
{
  "messageIds": ["string", "string"]
}
```

**Success Response:**

```json
{
  "success": true,
  "markedCount": 2
}
```

**Error Responses:**

| Status | Error                     |
| ------ | ------------------------- |
| 400    | `Invalid request body`    |
| 400    | `No message IDs provided` |

---

### 9. Get Messages

```
GET /getMessages
```

**Query Parameters:**

| Param            | Type   | Description                    |
| ---------------- | ------ | ------------------------------ |
| `conversationId` | string | The conversation ID (required) |

**Success Response:**

```json
{
  "success": true,
  "messages": [
    {
      "id": "string",
      "conversationId": "string",
      "content": "string",
      "senderId": "string",
      "isAgent": false,
      "type": "text",
      "metadata": {},
      "read": false,
      "deliveryStatus": "string",
      "timestamp": "2025-01-01T00:00:00Z"
    }
  ]
}
```

Messages are returned in ascending timestamp order.

**Error Responses:**

| Status | Error                                    |
| ------ | ---------------------------------------- |
| 400    | `conversationId is required`             |
| 404    | `Conversation not found`                 |
| 403    | `Conversation not found or unauthorized` |
| 500    | `Failed to retrieve messages`            |

---

### 10. Set Context

```
POST /setContext
```

Store a key-value pair scoped to a conversation. Useful for persisting agent state.

**Request Body:**

```json
{
  "conversationId": "string (required)",
  "key": "string (required)",
  "value": "string (required)"
}
```

---

### 11. Get Context

```
GET /getContext
```

**Query Parameters:**

| Param            | Type   | Description                    |
| ---------------- | ------ | ------------------------------ |
| `conversationId` | string | The conversation ID (required) |
| `key`            | string | The context key (required)     |

---

### 12. Delete Context

```
DELETE /deleteContext
```

**Query Parameters:**

| Param            | Type   | Description                    |
| ---------------- | ------ | ------------------------------ |
| `conversationId` | string | The conversation ID (required) |
| `key`            | string | The context key (required)     |

---

### 13. List Context Keys

```
GET /listContextKeys
```

**Query Parameters:**

| Param            | Type   | Description                    |
| ---------------- | ------ | ------------------------------ |
| `conversationId` | string | The conversation ID (required) |

---

## Supported Message Types

All message types are sent via `POST /sendMessage` using the `type` field. The `metadata` object controls type-specific rendering.

| #   | Type                 | Description                     | Metadata                                                                               |
| --- | -------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `text`               | Plain text message              | None required                                                                          |
| 2   | `info`               | Informational message with icon | None required                                                                          |
| 3   | `progress`           | Progress bar                    | `{ taskName, status, progress (0-100), currentStep, totalSteps }`                      |
| 4   | `task_update`        | Same as progress (legacy alias) | Same as `progress`                                                                     |
| 5   | `decision`           | Interactive buttons             | `{ question, options: ["A", "B"], status: "pending" }`                                 |
| 6   | `permission_request` | Approve/deny prompt             | Created via `POST /requestPermission`, not `/sendMessage`                              |
| 7   | `ui_approval`        | Approve/deny card with image    | `{ action, description, imageUrl, status: "pending" }`                                 |
| 8   | `resource_access`    | Grant/deny resource access      | `{ resource, resourceType, resourceName, permissions: [], reason, status: "pending" }` |
| 9   | `todo_list`          | Checklist with progress         | `{ title, items: [{ id, title, status }], progress (0-100), status }`                  |
| 10  | `markdown`           | Rich markdown content           | `{ title, buildable: bool, buildAction: "string" }`                                    |
| 11  | `html`               | Custom HTML rendering           | `{ title, htmlContent: "<div>...</div>" }`                                             |
| 12  | `chart`              | Data visualization              | `{ title, chartType: "bar"\|"pie"\|"line", data: [{ label, value }] }`                 |
| 13  | `image`              | Image display                   | `{ imageUrl, caption }`                                                                |
| 14  | `code`               | Code block                      | `{ language, filename, code }`                                                         |

---

## Webhook Events

When certain actions occur, the system delivers webhook events to the agent's registered `webhookUrl`.

### Webhook Security

Verify the `X-Sunday-Signature` header using HMAC-SHA256 with your webhook secret on the raw request body:

```
X-Sunday-Signature: sha256=<hex>
```

### Event Types

#### `message.created`

Fired when a user sends a message to the agent.

```json
{
  "event": "message.created",
  "messageId": "string",
  "conversationId": "string",
  "userId": "string",
  "content": "string",
  "type": "string",
  "timestamp": "2025-01-01T00:00:00Z"
}
```

#### `agent.installed`

Fired when a user installs the agent.

```json
{
  "event": "agent.installed",
  "userId": "string",
  "conversationId": "string",
  "installationId": "string",
  "isReinstall": false,
  "scopes": ["string"],
  "installedAt": "2025-01-01T00:00:00Z"
}
```

#### `agent.uninstalled`

Fired when a user uninstalls the agent.

```json
{
  "event": "agent.uninstalled",
  "userId": "string",
  "conversationId": "string",
  "installationId": "string",
  "reason": "string"
}
```

#### `permission.response`

Fired when a user responds to a permission request.

```json
{
  "event": "permission.response",
  "permissionId": "string",
  "conversationId": "string",
  "userId": "string",
  "action": "string",
  "reason": "string",
  "status": "approved | denied",
  "respondedAt": "2025-01-01T00:00:00Z"
}
```

#### `decision.response`

Fired when a user selects an option from a decision message.

```json
{
  "event": "decision.response",
  "messageId": "string",
  "conversationId": "string",
  "userId": "string",
  "selectedOption": "string",
  "question": "string",
  "options": ["string"]
}
```

---

## Agent Startup Flow

1. `POST /updateAgentWebhook` — register the webhook URL
2. `GET /getPendingMessages` — catch messages sent while offline
3. Process each pending message and reply
4. `POST /markMessagesAsReadByAgent` — acknowledge processed messages
5. Start listening for webhook events

When deployed via Cloud Run with the `SERVICE_URL` env var, the OpenClaw gateway handles steps 1-4 automatically on boot.

---

## Best Practices

- Respond to webhooks with HTTP 200 within 10 seconds.
- For long tasks, acknowledge immediately and process async.
- Use `progress` / `todo_list` message types to show work in progress.
- Implement webhook deduplication (same `messageId` can arrive twice).
- Store agent state using `/setContext` and `/getContext`.
- Always verify webhook signatures via `X-Sunday-Signature`.
- Send a welcome message on `agent.installed`.

---

## Data Models

### Agent

```json
{
  "id": "string",
  "userId": "string",
  "name": "string",
  "description": "string",
  "iconUrl": "string",
  "category": "string",
  "tags": ["string"],
  "scopes": ["string"],
  "isPublic": false,
  "isActive": true,
  "isFeatured": false,
  "webhookUrl": "string",
  "websiteUrl": "string",
  "supportEmail": "string",
  "webhookFailures": 0,
  "installCount": 0,
  "rating": 0.0,
  "ratingCount": 0,
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

> Note: `apiKeyHash` and `webhookSecret` are never returned in API responses.

### Message

```json
{
  "id": "string",
  "conversationId": "string",
  "content": "string",
  "senderId": "string",
  "isAgent": false,
  "type": "text",
  "metadata": {},
  "read": false,
  "deliveryStatus": "string",
  "timestamp": "2025-01-01T00:00:00Z"
}
```

### Conversation

```json
{
  "id": "string",
  "userId": "string",
  "agentId": "string",
  "agentName": "string",
  "lastMessage": "string",
  "lastMessageTime": "2025-01-01T00:00:00Z",
  "unreadCount": 0,
  "waitingForReply": false,
  "createdAt": "2025-01-01T00:00:00Z"
}
```

### Permission

```json
{
  "id": "string",
  "conversationId": "string",
  "agentId": "string",
  "action": "string",
  "reason": "string",
  "status": "pending | approved | denied",
  "requestedAt": "2025-01-01T00:00:00Z",
  "respondedAt": "2025-01-01T00:00:00Z"
}
```
