# Sunday Agent API Documentation

Base URL: `https://<your-domain>`

All responses are JSON with `Content-Type: application/json`.

---

## Authentication

Used for agent-facing endpoints. Pass the API key received from `POST /createAgent`:

```
Authorization: Bearer <api_key>
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

## Agent API

### 1. Update Agent Webhook

```
POST /updateAgentWebhook
```

**Auth:** API Key

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

### 2. Send Message

```
POST /sendMessage
```

**Auth:** API Key

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

### 3. Send Message V2

```
POST /sendMessageV2
```

**Auth:** API Key

Same request/response as [2. Send Message](#2-send-message). Currently uses the same handler internally.

---

### 4. Get Messages

```
GET /getMessages
```

**Auth:** API Key

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

### 5. Get Pending Messages

```
GET /getPendingMessages
```

**Auth:** API Key

Returns all unread user messages across all conversations where `waitingForReply` is `true`.

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

### 6. Mark Messages as Read by Agent

```
POST /markMessagesAsReadByAgent
```

**Auth:** API Key

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

### 7. Request Permission

```
POST /requestPermission
```

**Auth:** API Key

**Request Body:**

```json
{
  "userId": "string",
  "conversationId": "string (required)",
  "action": "string (required)",
  "reason": "string (required)"
}
```

Creates a permission request and sends a `permission_request` type message in the conversation.

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

### 8. Check Permission

```
GET /checkPermission
```

**Auth:** API Key

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

### 9. Update Task Status

```
POST /updateTaskStatus
```

**Auth:** API Key

**Request Body:**

```json
{
  "userId": "string",
  "conversationId": "string",
  "taskName": "string",
  "status": "string",
  "progress": 0
}
```

`progress` is an integer (e.g., 0-100 percent).

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

## Webhook Events

When certain actions occur, the system queues webhook events that are delivered to the agent's `webhookUrl`.

### Event Types

#### `agent.installed`

Fired when a user installs the agent.

```json
{
  "userId": "string",
  "conversationId": "string",
  "installationId": "string",
  "scopes": ["string"],
  "installedAt": "2025-01-01T00:00:00Z"
}
```

#### `message.created`

Fired when a user sends a message to the agent.

```json
{
  "messageId": "string",
  "conversationId": "string",
  "userId": "string",
  "content": "string",
  "type": "string",
  "timestamp": "2025-01-01T00:00:00Z"
}
```

#### `permission.response`

Fired when a user responds to a permission request.

```json
{
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

Fired when a user responds to a decision prompt.

```json
{
  "messageId": "string",
  "conversationId": "string",
  "userId": "string",
  "selectedOption": "string",
  "question": "string",
  "options": ["string"]
}
```

---

## Message Types

Messages have a `type` field that determines how they are rendered. Known types:

| Type                 | Description                                     |
| -------------------- | ----------------------------------------------- |
| `text`               | Plain text message (default)                    |
| `permission_request` | Permission request with approve/deny buttons    |
| `task_update`        | Task progress update with status and progress % |

Custom types can be used via the `metadata` field for rich message formats.

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
