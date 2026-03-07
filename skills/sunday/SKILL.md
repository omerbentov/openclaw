---
name: sunday
description: Use when you need to interact with Sunday from OpenClaw — send messages (text, rich types, decisions, progress, images, code), manage permissions, track tasks, read conversation history, and store context.
metadata: { "openclaw": { "emoji": "☀️", "requires": { "config": ["channels.sunday"] } } }
---

# Sunday Actions

## Overview

Sunday is a messaging platform with a rich Agent API. Use the `message` tool with `channel: "sunday"` (or `"sun"`) for sending and reading messages, including rich message types. Use the `sunday` action names for Sunday-specific features like permissions, task tracking, and context storage.

## Message Tool Actions

### Send a text message

```json
{
  "action": "send",
  "channel": "sunday",
  "to": "<userId>",
  "message": "Hello from OpenClaw"
}
```

### Send a rich message (with type and metadata)

```json
{
  "action": "send",
  "channel": "sunday",
  "to": "<userId>",
  "message": "Build progress",
  "type": "progress",
  "metadata": {
    "taskName": "Build",
    "status": "in_progress",
    "progress": 45,
    "currentStep": 3,
    "totalSteps": 7
  }
}
```

### Read conversation messages

```json
{
  "action": "read",
  "channel": "sunday",
  "conversationId": "<conversationId>"
}
```

## Sunday-Specific Actions

These actions are invoked via `handleSundayAction` through the message tool.

### Send with rich types

```json
{
  "action": "sendMessage",
  "userId": "<userId>",
  "message": "Which option?",
  "type": "decision",
  "metadata": {
    "question": "Deploy target",
    "options": ["Production", "Staging", "Cancel"],
    "status": "pending"
  }
}
```

### Request user permission

```json
{
  "action": "requestPermission",
  "userId": "<userId>",
  "conversationId": "<conversationId>",
  "permissionAction": "deploy_production",
  "reason": "Deploy latest build to production"
}
```

Returns `permissionId` to check later.

### Check permission status

```json
{
  "action": "checkPermission",
  "permissionId": "<permissionId>"
}
```

Returns `status`: `"pending"`, `"approved"`, or `"denied"`.

### Update task progress

```json
{
  "action": "updateTaskStatus",
  "userId": "<userId>",
  "conversationId": "<conversationId>",
  "taskName": "Database migration",
  "status": "running",
  "progress": 60
}
```

### Update a todo list in-place

```json
{
  "action": "updateTodoList",
  "messageId": "<messageId>",
  "items": [
    { "id": "1", "title": "Fix login bug", "status": "completed" },
    { "id": "2", "title": "Add dark mode", "status": "in_progress" },
    { "id": "3", "title": "Write tests", "status": "pending" }
  ]
}
```

### Store conversation context

```json
{ "action": "setContext", "conversationId": "<id>", "key": "step", "value": "2" }
```

### Retrieve conversation context

```json
{ "action": "getContext", "conversationId": "<id>", "key": "step" }
```

### Delete conversation context

```json
{ "action": "deleteContext", "conversationId": "<id>", "key": "step" }
```

### List context keys

```json
{ "action": "listContextKeys", "conversationId": "<id>" }
```

## Supported Message Types

All types are sent via the `send` action with `type` and `metadata` fields.

| Type                 | Description                  | Key metadata fields                                                   |
| -------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `text`               | Plain text (default)         | None                                                                  |
| `info`               | Informational with icon      | None                                                                  |
| `progress`           | Progress bar                 | `taskName`, `status`, `progress` (0-100), `currentStep`, `totalSteps` |
| `decision`           | Interactive buttons          | `question`, `options` (array), `status`                               |
| `todo_list`          | Checklist with progress      | `title`, `items` ([{id, title, status}]), `progress`, `status`        |
| `markdown`           | Rich markdown                | `title`                                                               |
| `html`               | Custom HTML                  | `title`, `htmlContent`                                                |
| `chart`              | Data visualization           | `title`, `chartType` (bar/pie/line), `data` ([{label, value}])        |
| `image`              | Image display                | `imageUrl`, `caption`                                                 |
| `code`               | Code block                   | `language`, `filename`, `code`                                        |
| `ui_approval`        | Approve/deny card with image | `action`, `description`, `imageUrl`, `status`                         |
| `resource_access`    | Resource access request      | `resource`, `resourceType`, `resourceName`, `permissions`, `reason`   |
| `permission_request` | Approve/deny prompt          | Created via `requestPermission`, not `sendMessage`                    |

## Inbound Webhook Events

The agent receives these events from Sunday users:

| Event                 | Description                             | Key data fields                      |
| --------------------- | --------------------------------------- | ------------------------------------ |
| `message.created`     | User sent a message                     | `messageId`, `userId`, `content`     |
| `agent.installed`     | User installed the agent (welcome sent) | `userId`, `installationId`, `scopes` |
| `agent.uninstalled`   | User uninstalled the agent              | `userId`, `reason`                   |
| `permission.response` | User responded to a permission request  | `permissionId`, `status`, `action`   |
| `decision.response`   | User selected a decision option         | `messageId`, `selectedOption`        |

## DM Policies

| Policy    | Behavior                                                |
| --------- | ------------------------------------------------------- |
| pairing   | New senders must be approved before messages are routed |
| allowlist | Only `allowFrom` user IDs can message the agent         |
| open      | Anyone can message the agent                            |
| disabled  | Inbound messages are ignored                            |

## Ideas to try

- Send `decision` messages to let users pick between options interactively.
- Use `progress` and `todo_list` types to show real-time task progress.
- Store conversation state with `setContext`/`getContext` for multi-step workflows.
- Send `chart` messages to visualize data directly in the conversation.
- Request explicit user permission before sensitive actions with `requestPermission`.
- Read conversation history with `read` to get context before replying.
