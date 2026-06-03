import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFilePath = path.resolve(__dirname, '.env');

dotenv.config({ path: envFilePath });

// Helper to update .env file
function updateEnv(key, value) {
  let envContent = '';
  if (fs.existsSync(envFilePath)) {
    envContent = fs.readFileSync(envFilePath, 'utf-8');
  }
  const lines = envContent.split(/\r?\n/);
  let found = false;
  const newLines = lines.map(line => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    newLines.push(`${key}=${value}`);
  }
  fs.writeFileSync(envFilePath, newLines.join('\n'), 'utf-8');
  // Update process.env for current run
  process.env[key] = value;
}

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

async function handleCommand() {
  const args = process.argv.slice(2).join(' ').trim();
  if (!args.startsWith('/')) return;

  const parts = args.split(' ');
  const command = parts[0];
  const subCommand = parts[1];
  const value = parts.slice(2).join(' ').trim();

  const scratchPath = 'C:\\Users\\Bintang\\.gemini\\antigravity\\scratch';

  if (command === '/project') {
    if (subCommand === 'list') {
      if (!fs.existsSync(scratchPath)) {
        await sendWAText('📁 No workspaces found (scratch directory does not exist).');
        return;
      }
      const files = fs.readdirSync(scratchPath);
      const dirs = files.filter(file => fs.statSync(path.join(scratchPath, file)).isDirectory());
      if (dirs.length === 0) {
        await sendWAText('📁 Workspaces list is empty.');
      } else {
        const active = process.env.ACTIVE_WORKSPACE ? path.basename(process.env.ACTIVE_WORKSPACE) : 'None';
        const listText = dirs.map(dir => dir === active ? `求 ${dir} (Active)` : `昌 ${dir}`).join('\n');
        await sendWAText(`📁 *Available Workspaces:*\n\n${listText}`);
      }
    } else if (subCommand === 'select') {
      if (!value) {
        await sendWAText('⚠️ Please specify workspace name. Example: `/project select workspace-default`');
        return;
      }
      const targetPath = path.resolve(scratchPath, value);
      if (!targetPath.startsWith(path.resolve(scratchPath) + path.sep)) {
        await sendWAText('❌ Path traversal detected! Workspace must be inside scratch directory.');
        return;
      }
      if (!fs.existsSync(targetPath)) {
        await sendWAText(`❌ Workspace "${value}" does not exist.`);
        return;
      }
      updateEnv('ACTIVE_WORKSPACE', targetPath);
      await sendWAText(`✅ Active workspace set to:\n\`${targetPath}\``);
    } else if (subCommand === 'new') {
      if (!value) {
        await sendWAText('⚠️ Please specify workspace name. Example: `/project new my-new-project`');
        return;
      }
      // Sanitize user-provided folder name to allow only alphanumeric, underscores, and dashes
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        await sendWAText('❌ Invalid folder name. Only alphanumeric characters, underscores, and dashes are allowed.');
        return;
      }
      const targetPath = path.resolve(scratchPath, value);
      if (!targetPath.startsWith(path.resolve(scratchPath) + path.sep)) {
        await sendWAText('❌ Path traversal detected! Workspace must be inside scratch directory.');
        return;
      }
      if (fs.existsSync(targetPath)) {
        await sendWAText(`⚠️ Workspace "${value}" already exists. Selecting it instead.`);
      } else {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      updateEnv('ACTIVE_WORKSPACE', targetPath);
      await sendWAText(`✅ Created and selected workspace:\n\`${targetPath}\``);
    } else {
      await sendWAText('⚠️ Unknown project command. Available:\n- `/project list`\n- `/project select <name>`\n- `/project new <name>`');
    }
  } else if (command === '/model') {
    if (subCommand === 'list') {
      await sendWAText('🤖 *Available Models:*\n\n- `gemini-3.5-flash` (Default/Fast)\n- `gemini-3.5-flash-high`\n- `gemini-3.5-flash-medium`\n- `gemini-3.5-flash-low`\n- `gemini-3.1-pro` (More intelligent)\n- `gemini-3.1-pro-high`\n- `gemini-3.1-pro-low`\n- `gemini-2.5-flash`\n- `gemini-2.5-pro`');
    } else if (subCommand === 'set') {
      if (!value) {
        await sendWAText('⚠️ Please specify model name. Example: `/model set gemini-2.5-pro`');
        return;
      }
      updateEnv('ACTIVE_MODEL', value);
      await sendWAText(`✅ Active model set to: \`${value}\``);
    } else {
      await sendWAText('⚠️ Unknown model command. Available:\n- `/model list`\n- `/model set <name>`');
    }
  } else if (command === '/status') {
    const workspace = process.env.ACTIVE_WORKSPACE || 'None';
    const model = process.env.ACTIVE_MODEL || 'None';
    await sendWAText(`⚙️ *System Status:*\n\nActive Workspace: \`${workspace}\`\nActive Model: \`${model}\``);
  } else if (command === '/kill') {
    exec('wmic process where "CommandLine like \'%agent.js%\' or CommandLine like \'%agent-runner-trigger.js%\'" get ProcessId', (err, stdout) => {
      const pids = stdout.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !isNaN(line) && line !== 'ProcessId');
      
      if (pids.length > 0) {
        pids.forEach(pid => {
          exec(`taskkill /F /PID ${pid}`);
        });
        sendWAText(`🛑 Terminated ${pids.length} active agent session(s).`);
      } else {
        sendWAText('🛑 No active agent sessions running.');
      }
    });
  } else if (command === '/get') {
    const filepath = parts.slice(1).join(' ').trim();
    if (!filepath) {
      await sendWAText('⚠️ Please specify a relative file path. Example: `/get index.js`');
      return;
    }
    const activeWorkspace = path.resolve(process.env.ACTIVE_WORKSPACE);
    if (!activeWorkspace || !fs.existsSync(activeWorkspace)) {
      await sendWAText('❌ No active workspace selected.');
      return;
    }
    const resolvedPath = path.resolve(activeWorkspace, filepath);
    if (!resolvedPath.startsWith(activeWorkspace + path.sep)) {
      await sendWAText('❌ Path traversal detected! Operations outside the workspace are forbidden.');
      return;
    }
    if (!fs.existsSync(resolvedPath)) {
      await sendWAText(`❌ File not found: \`${filepath}\``);
      return;
    }
    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      await sendWAText(`📄 *Content of ${filepath}:*\n\n\`\`\`\n${content}\n\`\`\``);
    } catch (e) {
      await sendWAText(`❌ Error reading file: ${e.message}`);
    }
  } else if (command === '/zip') {
    const activeWorkspace = path.resolve(process.env.ACTIVE_WORKSPACE);
    if (!activeWorkspace || !fs.existsSync(activeWorkspace)) {
      await sendWAText('❌ No active workspace selected.');
      return;
    }
    const resolvedScratch = path.resolve(scratchPath);
    if (!activeWorkspace.startsWith(resolvedScratch + path.sep)) {
      await sendWAText('❌ Path traversal detected! Operations outside the workspace are forbidden.');
      return;
    }
    const folderName = path.basename(activeWorkspace);
    const zipPath = path.resolve(scratchPath, `${folderName}.zip`);
    if (!zipPath.startsWith(resolvedScratch + path.sep)) {
      await sendWAText('❌ Path traversal detected! Operations outside the workspace are forbidden.');
      return;
    }
    
    await sendWAText(`📦 Compressing workspace \`${folderName}\`...`);
    
    const safeWorkspace = activeWorkspace.replace(/'/g, "''");
    const safeZipPath = zipPath.replace(/'/g, "''");
    exec(`powershell -Command "Compress-Archive -Path '${safeWorkspace}\\*' -DestinationPath '${safeZipPath}' -Force"`, async (err) => {
      if (err) {
        await sendWAText(`❌ Compression failed: ${err.message}`);
      } else {
        await sendWAText(`✅ Compression successful! ZIP file saved to:\n\`${zipPath}\``);
      }
    });
  } else {
    await sendWAText(`⚠️ Unknown command: \`${command}\`. Send a direct coding prompt or use /project, /model, /status, /kill, /get, /zip.`);
  }
}

handleCommand().catch(err => {
  console.error(err);
  sendWAText(`❌ Command Handler Error: ${err.message}`);
});
