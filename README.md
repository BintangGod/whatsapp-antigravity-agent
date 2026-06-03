# Headless Antigravity: WhatsApp-Controlled Autonomous AI Coding Agent

A lightweight, secure, and 100% free headless implementation of an agentic coding assistant. Control your local development workspace, modify files, and run terminal commands on your computer directly from your WhatsApp chat with interactive **Human-in-the-Loop** safety approvals.

---

## 🚀 Key Features

- **Headless & 100% Free**: Runs locally using Node.js, the WhatsApp Web WebSocket protocol (no public tunnels like ngrok/Cloudflare required for incoming messages), and the Gemini API Free Tier.
- **Autonomous Coding Loop**: Powered by Gemini's tool-calling capabilities, the agent can autonomously read, write, create files, and execute terminal scripts to satisfy your requests.
- **Interactive Approvals (Safety Gate)**: Real-time WhatsApp prompts asking you to permit or deny terminal command executions (`Y` to allow, `T` to reject) before they run on your host machine.
- **Rich Command Set**:
  - `📁 /project [list/select/new]`: Manage your active workspace folder contexts.
  - `🤖 /model [list/set]`: Dynamically switch between Gemini models (e.g., Gemini 3.5 Flash, Gemini 3.1 Pro, etc.).
  - `⚙️ /status`: Monitor the active workspace and selected model.
  - `📄 /get [filepath]`: Preview any code file in your workspace directly on WhatsApp.
  - `📦 /zip`: Compress the active workspace folder into a `.zip` archive.
  - `🛑 /kill`: Force-terminate the active background agent session.
- **Security Protections**: Built-in mechanisms to prevent path traversal directory escaping, safe PowerShell argument escaping, and API Key authorization between endpoints.

---

## 📐 Architecture & Data Flow

All processes run securely on your local machine.

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

---

## 🛠️ Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (Version >= 18.0.0)
- [npm](https://www.npmjs.com/) (bundled with Node.js)

### 1. Clone & Install Dependencies
Clone this repository locally, navigate to the root directory, and install the local packages:
```bash
git clone <your-repository-url>
cd antigravity-whatsapp-n8n

# Install root dependencies (n8n and sqlite3 local database compiler)
npm install

# Install gateway dependencies (Baileys and Express server)
cd gateway
npm install
```

### 2. Configure Environment Variables
In the `gateway` folder, copy `.env.example` to a new file named `.env`:
```bash
cp .env.example .env
```
Open `gateway/.env` in your editor and configure the fields:
- `GEMINI_API_KEY`: Obtain a free API Key from [Google AI Studio](https://aistudio.google.com/).
- `AUTHORIZED_NUMBER`: The WhatsApp number (e.g. `628123456789`) you will use to send commands.
- `API_KEY`: Create a custom secret key (e.g. `mysecretkey123`) to secure communications between the CLI and server.
- `ACTIVE_WORKSPACE`: Absolute path to your default coding workspace directory.

### 3. Setup and Activate n8n
1. Start n8n locally from the **root folder**:
   ```bash
   npx n8n start
   ```
2. Open your browser and navigate to `http://localhost:5678`.
3. Create your local owner profile.
4. Import the pre-configured workflow:
   - Click the three dots menu in the top-right corner -> **Import from File**.
   - Select the [n8n/workflow.json](n8n/workflow.json) file.
5. In the **Router Switch** node inside the editor:
   - Double-click it.
   - Verify/update the `Output` routing indices for rules: `approve` ➜ `0`, `command` ➜ `1`, `agent` ➜ `2`.
6. Click the **Active** toggle in the top-right corner (turns green) to activate the listener.

### 4. Start the WhatsApp Web Gateway
1. Open a new terminal in the `gateway` folder and run:
   ```bash
   npm start
   ```
2. A QR code will print in your terminal.
3. Open WhatsApp on the phone acting as the **Bot** -> **Linked Devices** -> **Link a Device**, and scan the QR code.
4. Once connected, your session state is securely saved in `./auth_info` (ignored by git).

---

## 🎮 How to Use (Prompting Examples)

Open WhatsApp on the **Authorized User phone** and send a message to your **Bot phone**:

### Project Management Commands
- Get workspace status:
  ```text
  /status
  ```
- List available workspace folders:
  ```text
  /project list
  ```
- Select/switch to a workspace:
  ```text
  /project select my-awesome-app
  ```
- Create a new sanitized workspace:
  ```text
  /project new ecommerce-site
  ```

### AI Coding Prompts
Once a workspace is selected, send direct coding requests:
- *"Create a simple landing page in index.html with inline Tailwind styling"*
- *"Refactor calculateTotal function in src/utils.js to support tax additions"*

### Command Approvals
When the agent tries to run a terminal task (e.g. `npm install`), the bot prompts you:
> ⚠️ Requesting permission to run command:
> `npm install`
> 
> Reply Y/T or 1/2.
- Reply `Y` or `1` to **Allow** execution.
- Reply `T` or `2` to **Reject** execution.

### Downloading Deliverables
Compress and download your workspace once finished:
```text
/zip
```
This generates a `.zip` archive of your active workspace in your scratch directory.

---

## 🛡️ License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
