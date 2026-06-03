# Antigravity WhatsApp Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 100% free, local automation system that allows controlling a Gemini-powered AI coding agent via WhatsApp, with workspace management, model selection, and real-time command execution approval.

**Architecture:** A local Node.js Express server acts as a WhatsApp Web Gateway using `@whiskeysockets/baileys`. When coding commands are received, it starts an autonomous Local Agent Loop using `@google/generativeai` that has access to file and execution tools. When a tool requires approval, it pauses, requests permission via WhatsApp, and resumes once approved.

**Tech Stack:** Node.js, Express, `@whiskeysockets/baileys`, `@google/generativeai`, n8n (localhost)

---

### Task 1: Setup WhatsApp Web Gateway

Initialize the gateway directory, install dependencies, and build the WhatsApp client that connects via QR code and exposes endpoints for sending messages.

**Files:**
- Create: `gateway/package.json`
- Create: `gateway/server.js`

- [x] **Step 1: Create package.json for Gateway**
  Create `gateway/package.json` with the required dependencies: Express, Baileys, qrcode-terminal, and dotenv.
  ```json
  {
    "name": "antigravity-wa-gateway",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "start": "node server.js"
    },
    "dependencies": {
      "@whiskeysockets/baileys": "^6.6.0",
      "dotenv": "^16.4.5",
      "express": "^4.19.2",
      "linkifyjs": "^4.1.3",
      "pino": "^9.0.0",
      "qrcode-terminal": "^0.12.0"
    }
  }
  ```

- [x] **Step 2: Install Gateway dependencies**
  Run: `npm install` inside the `gateway` directory.
  Expected: Node modules are installed successfully.

- [x] **Step 3: Implement server.js**
  Write the core Express and Baileys code in `gateway/server.js`. This code will connect to WhatsApp, print a QR code in the terminal, authenticate, save the session to `./auth_info`, and expose a `POST /send-message` API. It will also forward incoming messages from the authorized number to n8n (or directly to the Agent runner).

  ```javascript
  import express from 'express';
  import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
  import qrcode from 'qrcode-terminal';
  import pino from 'pino';
  import fs from 'fs';
  import path from 'path';
  import { exec } from 'child_process';
  import dotenv from 'dotenv';

  dotenv.config();

  const app = express();
  app.use(express.json());

  const PORT = process.env.PORT || 3000;
  const AUTHORIZED_NUMBER = process.env.AUTHORIZED_NUMBER; // Format: 628123456789 (without @s.whatsapp.net)
  const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/whatsapp';

  let sock = null;

  async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket.default({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('Scan the QR code below to connect to WhatsApp:');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Connection closed. Reconnecting...', shouldReconnect);
        if (shouldReconnect) {
          connectToWhatsApp();
        }
      } else if (connection === 'open') {
        console.log('WhatsApp connection opened successfully!');
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const from = msg.key.remoteJid;
        const senderNumber = from.split('@')[0];
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!text) continue;
        if (AUTHORIZED_NUMBER && senderNumber !== AUTHORIZED_NUMBER) {
          console.log(`Ignored message from unauthorized sender: ${senderNumber}`);
          continue;
        }

        console.log(`Received message from ${senderNumber}: ${text}`);
        
        // Forward to n8n webhook
        try {
          fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, text, senderNumber })
          }).catch(err => console.error('Failed to forward message to n8n:', err.message));
        } catch (e) {
          console.error(e);
        }
      }
    });
  }

  app.post('/send-message', async (req, res) => {
    const { to, text } = req.body;
    if (!sock) return res.status(503).json({ error: 'WhatsApp socket not initialized' });

    try {
      await sock.sendMessage(to, { text });
      res.json({ status: 'success' });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`WhatsApp Gateway API running on port ${PORT}`);
    connectToWhatsApp();
  });
  ```

---

### Task 2: Setup Local Agent Loop (The Antigravity Engine)

Write the script `agent.js` that implements the autonomous agent loop. It uses Gemini to run coding tasks, read/write files, execute commands, and request permission via the WhatsApp gateway before executing commands.

**Files:**
- Create: `gateway/agent.js`
- Create: `gateway/.env`

- [x] **Step 1: Install `@google/genai` in gateway**
  Add `@google/genai` to `gateway/package.json` dependencies, or run `npm install @google/genai`.

- [x] **Step 2: Create .env configuration**
  Create `gateway/.env` to store environment variables:
  ```env
  PORT=3000
  AUTHORIZED_NUMBER=628123456789  # Replace with user's actual phone number
  GEMINI_API_KEY=YOUR_GEMINI_API_KEY
  N8N_WEBHOOK_URL=http://localhost:5678/webhook/whatsapp
  ACTIVE_WORKSPACE=C:\path\to\your\scratch\workspace-default
  ACTIVE_MODEL=gemini-2.5-flash
  ```

- [x] **Step 3: Implement agent.js**
  Write the agent loop that handles:
  - Tool definitions: `readFile`, `writeFile`, `runCommand`.
  - Tool execution logic.
  - The WhatsApp approval flow: when `runCommand` is called, it sends a WhatsApp message and starts an Express HTTP endpoint `/approve` on port 3001, waiting for n8n or the user to send `POST /approve` before executing.

  ```javascript
  import { GoogleGenAI } from '@google/generativeai';
  import fs from 'fs';
  import path from 'path';
  import { exec } from 'child_process';
  import express from 'express';
  import dotenv from 'dotenv';

  dotenv.config();

  const API_KEY = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // Express server for waiting approval callbacks
  const approvalApp = express();
  approvalApp.use(express.json());
  let currentApprovalResolver = null;

  approvalApp.post('/approve', (req, res) => {
    const { approved } = req.body;
    if (currentApprovalResolver) {
      currentApprovalResolver(approved === true || approved === 'yes' || approved === '1' || approved === 'Y');
      currentApprovalResolver = null;
      res.json({ status: 'received' });
    } else {
      res.status(400).json({ error: 'No pending approval' });
    }
  });

  approvalApp.listen(3001, () => {
    console.log('Approval listener API running on port 3001');
  });

  async function sendWAText(text) {
    try {
      await fetch('http://localhost:3000/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: `${process.env.AUTHORIZED_NUMBER}@s.whatsapp.net`,
          text
        })
      });
    } catch (e) {
      console.error('Failed to send status update to WhatsApp:', e.message);
    }
  }

  // Tools Implementation
  const tools = {
    readFile: async ({ filepath }) => {
      const fullPath = path.resolve(process.env.ACTIVE_WORKSPACE, filepath);
      return fs.readFileSync(fullPath, 'utf-8');
    },
    writeFile: async ({ filepath, content }) => {
      const fullPath = path.resolve(process.env.ACTIVE_WORKSPACE, filepath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      return `File successfully written to ${filepath}`;
    },
    runCommand: async ({ command }) => {
      await sendWAText(`⚠️ Requesting permission to run command:\n\`${command}\`\n\nReply "Y" to Allow or "T" to Reject.`);
      
      const approved = await new Promise((resolve) => {
        currentApprovalResolver = resolve;
      });

      if (!approved) {
        return 'Execution REJECTED by user.';
      }

      await sendWAText(`⚙️ Running command: \`${command}\`...`);
      return new Promise((resolve) => {
        exec(command, { cwd: process.env.ACTIVE_WORKSPACE }, (error, stdout, stderr) => {
          if (error) {
            resolve(`Error executing command: ${error.message}\nStderr: ${stderr}`);
          } else {
            resolve(`Command executed successfully.\nStdout: ${stdout}\nStderr: ${stderr}`);
          }
        });
      });
    }
  };

  export async function runAgentTask(prompt) {
    const modelName = process.env.ACTIVE_MODEL || 'gemini-2.5-flash';
    await sendWAText(`🚀 Starting task with model ${modelName}...\nPrompt: "${prompt}"`);

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: "You are an autonomous AI coding assistant. You have tools to read files, write files, and run commands. Modify code to satisfy the user's prompt.",
          tools: [{
            functionDeclarations: [
              {
                name: 'readFile',
                description: 'Read contents of a file',
                parameters: {
                  type: 'OBJECT',
                  properties: { filepath: { type: 'STRING', description: 'Relative path to file' } },
                  required: ['filepath']
                }
              },
              {
                name: 'writeFile',
                description: 'Create or overwrite a file with contents',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    filepath: { type: 'STRING', description: 'Relative path to file' },
                    content: { type: 'STRING', description: 'Contents of the file' }
                  },
                  required: ['filepath', 'content']
                }
              },
              {
                name: 'runCommand',
                description: 'Execute a terminal command in the workspace',
                parameters: {
                  type: 'OBJECT',
                  properties: { command: { type: 'STRING', description: 'Command to run' } },
                  required: ['command']
                }
              }
            ]
          }]
        }
      });

      // Tool handling loop (simplified)
      let message = response;
      while (message.candidates?.[0]?.content?.parts?.[0]?.functionCall) {
        const call = message.candidates[0].content.parts[0].functionCall;
        const toolName = call.name;
        const args = call.args;

        console.log(`Tool call: ${toolName}`, args);
        let result = '';
        try {
          result = await tools[toolName](args);
        } catch (e) {
          result = `Error: ${e.message}`;
        }

        // Send tool results back to Gemini
        message = await ai.models.generateContent({
          model: modelName,
          contents: [
            ...message.candidates[0].content.parts,
            {
              functionResponse: {
                name: toolName,
                response: { result }
              }
            }
          ]
        });
      }

      const finalReply = message.text;
      await sendWAText(`✅ Task completed!\n\n${finalReply}`);
    } catch (err) {
      await sendWAText(`❌ Error: ${err.message}`);
    }
  }
  ```

---

### Task 3: Configure n8n Workflow

Configure the local n8n workflow. Create the workflow json file so that the user can import it directly.

**Files:**
- Create: `n8n/workflow.json`

- [x] **Step 1: Create workflow.json**
  Create a workflow JSON that contains:
  1. A Webhook node on route `/webhook/whatsapp`.
  2. A Router switch:
     - If the message is `Y` or `T` and there is a pending approval, call `POST http://localhost:3001/approve` with `{ "approved": msg }`.
     - If it starts with `/project`, parse workspace.
     - Otherwise, trigger `node agent-runner-trigger.js` with the prompt.
  ```json
  {
    "name": "Antigravity WhatsApp Connector",
    "nodes": [
      {
        "parameters": {
          "httpMethod": "POST",
          "path": "whatsapp",
          "options": {}
        },
        "id": "1",
        "name": "Webhook Trigger",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 1,
        "position": [250, 300]
      }
    ],
    "connections": {}
  }
  ```

- [x] **Step 2: Start n8n locally**
  Run: `npx n8n start`
  Expected: n8n starts successfully on `http://localhost:5678`.
