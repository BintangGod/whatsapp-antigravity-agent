import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

async function sendWAText(text) {
  try {
    const response = await fetch('http://localhost:3000/send-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.API_KEY
      },
      body: JSON.stringify({
        to: `${process.env.AUTHORIZED_NUMBER}@s.whatsapp.net`,
        text
      })
    });
    if (!response.ok) {
      console.warn(`WhatsApp message dispatch failed with HTTP status: ${response.status}`);
    }
  } catch (e) {
    console.error('Failed to send status update to WhatsApp:', e.message);
  }
}

// Ensure the active workspace directory exists
function ensureWorkspaceDir() {
  const workspacePath = process.env.ACTIVE_WORKSPACE;
  if (workspacePath && !fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }
}

// Tools Implementation
const tools = {
  readFile: async ({ filepath }) => {
    ensureWorkspaceDir();
    const activeWorkspace = path.resolve(process.env.ACTIVE_WORKSPACE);
    const resolvedPath = path.resolve(activeWorkspace, filepath);
    if (!resolvedPath.startsWith(activeWorkspace + path.sep)) {
      throw new Error("Path traversal detected! Operations outside the workspace are forbidden.");
    }
    return fs.readFileSync(resolvedPath, 'utf-8');
  },
  writeFile: async ({ filepath, content }) => {
    ensureWorkspaceDir();
    const activeWorkspace = path.resolve(process.env.ACTIVE_WORKSPACE);
    const resolvedPath = path.resolve(activeWorkspace, filepath);
    if (!resolvedPath.startsWith(activeWorkspace + path.sep)) {
      throw new Error("Path traversal detected! Operations outside the workspace are forbidden.");
    }
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, content, 'utf-8');
    return `File successfully written to ${filepath}`;
  },
  runCommand: async ({ command }) => {
    ensureWorkspaceDir();
    const approvalId = 'app_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    try {
      const response = await fetch('http://localhost:3000/register-approval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.API_KEY
        },
        body: JSON.stringify({ id: approvalId })
      });
      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to register approval on gateway:', err.message);
      throw new Error(`Failed to register command execution approval: ${err.message}`);
    }

    await sendWAText(`⚠️ Requesting permission to run command:\n\`${command}\`\n\nReply Y/T or 1/2.`);

    const approved = await new Promise((resolve) => {
      let timeoutId;
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`http://localhost:3000/check-approval/${approvalId}`, {
            headers: {
              'x-api-key': process.env.API_KEY
            }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'approved') {
              clearInterval(interval);
              if (timeoutId) clearTimeout(timeoutId);
              resolve(true);
            } else if (data.status === 'rejected') {
              clearInterval(interval);
              if (timeoutId) clearTimeout(timeoutId);
              resolve(false);
            }
          }
        } catch (e) {
          console.error('Error polling approval status:', e.message);
        }
      }, 1000);

      timeoutId = setTimeout(async () => {
        clearInterval(interval);
        console.warn(`Command approval request ${approvalId} timed out after 5 minutes.`);
        await sendWAText(`⏳ Command execution request timed out after 5 minutes.`);
        resolve(false);
      }, 300000);
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
  ensureWorkspaceDir();
  const modelName = process.env.ACTIVE_MODEL || 'gemini-2.5-flash';
  await sendWAText(`🚀 Starting task with model ${modelName}...\nPrompt: "${prompt}"`);

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
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
    });

    const chat = model.startChat();
    let result = await chat.sendMessage(prompt);
    let response = result.response;

    let calls = response.functionCalls ? response.functionCalls() : [];
    while (calls && calls.length > 0) {
      const call = calls[0];
      const toolName = call.name;
      const args = call.args;

      console.log(`Tool call: ${toolName}`, args);
      let resultText = '';
      try {
        resultText = await tools[toolName](args);
      } catch (e) {
        resultText = `Error: ${e.message}`;
      }

      const nextResult = await chat.sendMessage([{
        functionResponse: {
          name: toolName,
          response: { result: resultText }
        }
      }]);
      response = nextResult.response;
      calls = response.functionCalls ? response.functionCalls() : [];
    }

    const finalReply = response.text();
    await sendWAText(`✅ Task completed!\n\n${finalReply}`);
  } catch (err) {
    await sendWAText(`❌ Error: ${err.message}`);
  }
}

// Allow direct execution from terminal for testing
if (process.argv[1] === __filename) {
  const prompt = process.argv.slice(2).join(' ');
  if (prompt) {
    console.log(`Running CLI prompt: ${prompt}`);
    runAgentTask(prompt);
  } else {
    console.log('Usage: node agent.js "your prompt here"');
  }
}
