import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// Global Error Handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUTHORIZED_NUMBER = process.env.AUTHORIZED_NUMBER; // Format: 628123456789 (without @s.whatsapp.net)
if (!AUTHORIZED_NUMBER) {
  console.error('FATAL ERROR: AUTHORIZED_NUMBER environment variable is not configured. Exiting...');
  process.exit(1);
}
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/whatsapp';
const AUTH_DIR = process.env.AUTH_DIR || path.resolve(__dirname, 'auth_info');

// Simple memory-based approval storage
const approvals = new Map();

// Authentication middleware using X-API-Key header
function checkApiKey(req, res, next) {
  const apiKey = process.env.API_KEY;
  const clientKey = req.headers['x-api-key'];

  if (!apiKey || clientKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

let sock = null;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // Defensive handling of baileys default export
  const makeSocket = makeWASocket.default || makeWASocket;

  sock = makeSocket({
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
      sock = null;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Error details:', lastDisconnect?.error, 'Reconnecting in 5 seconds...', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => {
          connectToWhatsApp();
        }, 5000);
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connection opened successfully!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    console.log('DEBUG: Incoming messages.upsert event type:', m.type);
    if (m.messages && m.messages.length > 0) {
      console.log('DEBUG: First message key:', JSON.stringify(m.messages[0].key));
      console.log('DEBUG: First message keys/types:', Object.keys(m.messages[0].message || {}));
    }
    if (m.type !== 'notify') return;
    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      let from = msg.key.remoteJid;
      // Handle WhatsApp's new LID format by resolving to the alternative JID if available
      if (msg.key.remoteJidAlt && msg.key.remoteJidAlt.endsWith('@s.whatsapp.net')) {
        from = msg.key.remoteJidAlt;
      }

      // Filter out group chats and non-user JIDs (e.g. @g.us, @broadcast, @lid without alt)
      if (!from || !from.endsWith('@s.whatsapp.net')) continue;

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
        const response = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, text, senderNumber })
        });
        if (!response.ok) {
          console.warn(`Webhook forwarding failed with status ${response.status}: ${response.statusText}`);
        }
      } catch (err) {
        console.error('Failed to forward message to n8n:', err.message);
      }
    }
  });
}

app.post('/send-message', checkApiKey, async (req, res) => {
  // Validate request body parameters
  const { to, text } = req.body;
  if (!to || typeof to !== 'string' || !text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing parameters. "to" and "text" must be provided as strings.' });
  }

  if (!sock) return res.status(503).json({ error: 'WhatsApp socket not initialized' });

  // Format JID if it is just a phone number
  let recipient = to;
  if (recipient && !recipient.includes('@')) {
    recipient = `${recipient}@s.whatsapp.net`;
  }

  try {
    await sock.sendMessage(recipient, { text });
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/register-approval', checkApiKey, (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing parameter: id' });
  }
  approvals.set(id, 'pending');
  res.json({ status: 'pending', id });
});

app.get('/check-approval/:id', checkApiKey, (req, res) => {
  const { id } = req.params;
  const status = approvals.get(id) || 'pending';
  res.json({ status });
});

app.post('/approve', checkApiKey, (req, res) => {
  const { id, approved } = req.body;
  let targetId = id;
  if (!targetId) {
    // Find the most recent pending approval
    for (const [key, val] of approvals.entries()) {
      if (val === 'pending') {
        targetId = key;
      }
    }
  }
  if (!targetId) {
    return res.status(400).json({ error: 'No pending approval found' });
  }

  const isApproved = approved === true || approved === 'Y' || approved === 'y' || approved === '1' || approved === 'yes' || approved === 'approved';
  const isRejected = approved === false || approved === 'T' || approved === 't' || approved === '2' || approved === 'no' || approved === 'rejected';

  if (isApproved) {
    approvals.set(targetId, 'approved');
    res.json({ status: 'approved', id: targetId });
  } else if (isRejected) {
    approvals.set(targetId, 'rejected');
    res.json({ status: 'rejected', id: targetId });
  } else {
    res.status(400).json({ error: 'Invalid approval status value' });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp Gateway API running on port ${PORT}`);
  connectToWhatsApp();
});
