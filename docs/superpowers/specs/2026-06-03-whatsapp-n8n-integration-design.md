# Design Spec: Antigravity WhatsApp Integration via n8n

This specification details the design for integrating Antigravity coding automation with WhatsApp using a local n8n instance and a custom local WhatsApp Gateway.

## Context & Objectives

The goal is to allow the user to control, monitor, and interact with the Antigravity coding assistant directly from their WhatsApp chat. The system must be 100% free to run, lightweight, secure, and run locally on Windows using Node.js without requiring heavy dependencies like Docker Desktop.

## Architecture Overview

All components run locally on the user's Windows machine. No public internet tunnel (like ngrok or Cloudflare Tunnels) is required because the WhatsApp Gateway uses a WebSocket connection to act as a WhatsApp Web client, pulling messages directly from WhatsApp servers.

```
+---------------------------------------------------------------------------------+
|                                 Local Windows PC                                |
|                                                                                 |
|  +-----------------------+      Local POST      +----------------------------+  |
|  |   WhatsApp Gateway    | -------------------> |       n8n Instance         |  |
|  |     (Port 3000)       |                      |       (Port 5678)          |  |
|  |                       | <------------------- |                            |  |
|  | - Baileys WA Client   |   Local POST Send    | - Webhook Trigger          |  |
|  | - Express API Server  |                      | - Command Router Node      |  |
|  +-----------------------+                      | - Exec CLI / API Node      |  |
|              ^                                  +----------------------------+  |
|              |                                                 |                |
|       WA Web WebSocket                                   Execute CLI            |
|              |                                                 v                |
|              v                                  +----------------------------+  |
|      [WhatsApp Cloud]                           |    Antigravity CLI / API   |  |
|              ^                                  +----------------------------+  |
|              |                                                 |                |
|          WhatsApp                                          Modifies             |
|              |                                                 v                |
|              v                                  +----------------------------+  |
|      [User Handphone]                           |    Scratch Workspaces     |  |
|                                                 +----------------------------+  |
+---------------------------------------------------------------------------------+
```

## System Components

### 1. WhatsApp Web Gateway (Local Node.js app)
- **Technology:** Node.js, Express, `@whiskeysockets/baileys` (lightweight WA Web library).
- **Port:** `3000`
- **Functions:**
  - Authenticates via QR code printed in the terminal (saved to local directory `./auth_info_baileys`).
  - Listens to incoming WhatsApp messages. If a message comes from the authorized phone number, it performs a `POST` request to the local n8n webhook at `http://localhost:5678/webhook/whatsapp-message`.
  - Exposes an API endpoint `POST /send-message` to allow n8n to send text or media messages back to the user.
    - Payload: `{ "to": "phone_number", "text": "message_content", "mediaUrl": "optional_local_path_or_url" }`

### 2. n8n Workflow Automation
- **Technology:** Node.js, n8n (`npx n8n start` using default SQLite database).
- **Port:** `5678`
- **Workflow Steps:**
  1. **Webhook Trigger**: Receives payload from WhatsApp Gateway.
  2. **Message Parser / Router**: Parses message content.
     - If it starts with a slash `/` (e.g. `/model`, `/project`), routes to **System Commands**.
     - If it is a confirmation (`Y` / `1` or `T` / `2`) and there is a pending approval check, routes to **Approval Handler**.
     - Otherwise, treats it as a **Coding Prompt** and forwards it to Antigravity.
  3. **Antigravity Connector**:
     - Runs CLI commands or calls local agent endpoints to start Antigravity.
     - Stores the execution state in a local file or simple memory store to keep track of active sessions, models, and workspaces.
  4. **Response Dispatcher**: Sends the generated code summary, diffs, or agent responses back to the WhatsApp Gateway `POST /send-message` endpoint.

### 3. Workspace Manager
- Works in subdirectories under `C:\Users\Bintang\.gemini\antigravity\scratch`.
- The user can select their active directory using `/project select <name>`.

---

## Interactive Command Set

| Command | Action | Description |
| :--- | :--- | :--- |
| **Direct Prompt** | *e.g., "Buat script python"* | Forwards the prompt to Antigravity in the active workspace directory. |
| **Approval** | `Y` / `1` or `T` / `2` | Confirms or rejects a pending Antigravity permission request. |
| `/project list` | View Workspaces | Lists all project subdirectories inside `C:\Users\Bintang\.gemini\antigravity\scratch`. |
| `/project select <name>`| Select Workspace | Switches the active directory context to the selected folder. |
| `/project new <name>` | Create Workspace | Creates a new subdirectory under the scratch path. |
| `/model list` | View AI Models | Lists available models (e.g. Gemini 3.5 Flash, Gemini 1.5 Pro). |
| `/model set <name>` | Set AI Model | Updates the active model preference for Antigravity. |
| `/status` | Check Progress | Queries the state of the active coding session. |
| `/kill` | Cancel Task | Aborts the currently running coding agent process. |
| `/get <filepath>` | Retrieve File | Reads the requested file and sends its content back to WhatsApp. |
| `/zip` | Download Project | Compresses the active project folder and sends it as a document (.zip) via WhatsApp. |

---

## Verification & Safety

1. **Phone Number Authentication**: The WhatsApp Gateway will hardcode the user's specific phone number. Any messages from other numbers are ignored to prevent unauthorized access.
2. **Localhost Execution**: No external network ports are opened on the user's router, ensuring high security.
3. **Execution Timeouts**: CLI tasks executed by n8n will have default timeouts to prevent orphan processes from hanging.
