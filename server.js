const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const fs = require('fs');
const notesPath = path.join(__dirname, 'data', 'notes.json');
const indexTemplatePath = path.join(__dirname, 'public', 'index.html');
const indexTemplate = fs.readFileSync(indexTemplatePath, 'utf-8');

const PORT = process.env.PORT || 3000;
const SUPPORTED_LOCALES = ['vi', 'en'];
const DEFAULT_LOCALE = 'vi';
const REGION_TO_LOCALE = {
  VN: 'vi',
  US: 'en',
  GB: 'en',
  AU: 'en',
  CA: 'en',
  NZ: 'en',
  IE: 'en',
  SG: 'en',
  PH: 'en',
  IN: 'en',
  MY: 'en',
};

const COPY = {
  vi: {
    pageTitle: 'Orb S2S AI Assistant',
    mainTitle: 'Trợ lý AI S2S gốc',
    readyText: 'Sẵn sàng',
    promptText: 'Nhấn mic để nói hoặc ngắt lời AI',
    micAria: 'Bật hoặc tắt micro',
    notesLink: 'Mở trình ghi chú',
    connected: 'Đã kết nối',
    disconnected: 'Đã ngắt kết nối',
    listening: 'Đang nghe...',
    processing: 'Đang xử lý âm thanh...',
    blocked: 'Quyền truy cập micro đang bị chặn',
    processingStatus: 'Trợ lý đang xử lý giọng nói của bạn...',
    interrupted: 'Bị ngắt bởi người dùng.',
    noAudio: 'Không ghi nhận được âm thanh.',
    aiSystemPrompt: 'Bạn là trợ lý lắng nghe theo phong cách Feynman. Hãy trả lời ngắn gọn, rõ ràng, hữu ích và bằng tiếng Việt.',
    fallbackReply: (transcript) => `Dự phòng AI: Tôi đã nghe "${transcript || 'giọng nói của bạn'}" và sẵn sàng hỗ trợ.`,
  },
  en: {
    pageTitle: 'Orb S2S AI Assistant',
    mainTitle: 'Native S2S AI Assistant',
    readyText: 'Ready',
    promptText: 'Press the mic to speak or interrupt the AI',
    micAria: 'Toggle microphone',
    notesLink: 'Open Notes Editor',
    connected: 'Connected',
    disconnected: 'Disconnected',
    listening: 'Listening...',
    processing: 'Processing audio...',
    blocked: 'Microphone access is blocked',
    processingStatus: 'AI listener is processing your speech...',
    interrupted: 'Interrupted by user.',
    noAudio: 'No audio captured.',
    aiSystemPrompt: 'You are a Feynman-style listener. Respond briefly, clearly, helpfully, and in English.',
    fallbackReply: (transcript) => `AI fallback: I heard "${transcript || 'your speech'}" and I am ready to help.`,
  },
};

function detectLocaleFromRequest(req) {
  const forced = normalizeLocale(req.query?.lang);
  if (forced) return forced;

  const acceptLanguage = req.headers['accept-language'];
  if (acceptLanguage) {
    const candidates = acceptLanguage
      .split(',')
      .map((item) => item.split(';')[0].trim().toLowerCase())
      .filter(Boolean);

    for (const candidate of candidates) {
      const primary = candidate.split('-')[0];
      const match = normalizeLocale(primary);
      if (match) return match;
    }
  }

  const regionHeader = String(
    req.headers['x-vercel-ip-country'] ||
      req.headers['cf-ipcountry'] ||
      req.headers['x-country-code'] ||
      ''
  ).toUpperCase();

  if (REGION_TO_LOCALE[regionHeader]) {
    return REGION_TO_LOCALE[regionHeader];
  }

  return DEFAULT_LOCALE;
}

function normalizeLocale(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  if (SUPPORTED_LOCALES.includes(normalized)) return normalized;
  return null;
}

function renderIndex(locale) {
  const copy = COPY[locale] || COPY[DEFAULT_LOCALE];
  return indexTemplate
    .replaceAll('__HTML_LANG__', locale)
    .replaceAll('__HTML_DIR__', 'ltr')
    .replaceAll('__PAGE_TITLE__', copy.pageTitle)
    .replaceAll('__MAIN_TITLE__', copy.mainTitle)
    .replaceAll('__READY_TEXT__', copy.readyText)
    .replaceAll('__PROMPT_TEXT__', copy.promptText)
    .replaceAll('__MIC_ARIA__', copy.micAria)
    .replaceAll('__NOTES_LINK__', copy.notesLink)
    .replaceAll('__APP_LOCALE__', locale);
}

app.use(express.json());

function serveLocalizedIndex(req, res) {
  const locale = detectLocaleFromRequest(req);
  res.type('html').send(renderIndex(locale));
}

app.get('/', serveLocalizedIndex);
app.get('/index.html', serveLocalizedIndex);

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/notes', (req, res) => {
  const { title, content, drawing } = req.body;
  if (!title || typeof content !== 'string') {
    return res.status(400).json({ error: 'Title and content are required.' });
  }

  const filename = sanitizeTitle(title);
  const notes = loadNotes();
  notes[filename] = {
    title,
    content,
    drawing: drawing || null,
    updatedAt: new Date().toISOString(),
  };
  saveNotes(notes);

  return res.status(201).json({ ok: true, title });
});

app.get('/api/notes/:title', (req, res) => {
  const filename = sanitizeTitle(req.params.title);
  const notes = loadNotes();
  const note = notes[filename];

  if (!note) {
    return res.status(404).json({ error: 'Note not found.' });
  }

  return res.json(note);
});

function sanitizeTitle(title) {
  return title.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
}

function loadNotes() {
  try {
    const content = fs.readFileSync(notesPath, 'utf-8');
    return JSON.parse(content || '{}');
  } catch (error) {
    return {};
  }
}

function saveNotes(notes) {
  fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
}

async function getAIReply(transcript, locale) {
  const apiKey = process.env.OPENAI_API_KEY;
  const copy = COPY[locale] || COPY[DEFAULT_LOCALE];

  if (apiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: copy.aiSystemPrompt,
            },
            {
              role: 'user',
              content: transcript,
            },
          ],
          temperature: 0.7,
        }),
      });

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || 'AI service returned no content.';
    } catch (error) {
      console.error('OpenAI error:', error.message);
    }
  }

  return copy.fallbackReply(transcript);
}

async function handleS2SStream(audioBuffer, socket) {
  const payload = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
  const sampleLength = payload.length;
  const durationSeconds = Math.max(1, Math.round(sampleLength / 16000 / 2));
  const transcript = `Captured ${durationSeconds}s of speech from the orb listener.`;
  const locale = socket.data.locale || DEFAULT_LOCALE;
  const copy = COPY[locale] || COPY[DEFAULT_LOCALE];

  socket.emit('status', { text: copy.processingStatus });

  const reply = await getAIReply(transcript, locale);
  socket.emit('ai-response', { transcript, reply });
}

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.data.audioChunks = [];
  socket.data.locale = normalizeLocale(socket.handshake?.query?.lang) || detectLocaleFromRequest(socket.request);
  const copy = COPY[socket.data.locale] || COPY[DEFAULT_LOCALE];

  socket.on('audio-data', async (data) => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    socket.data.audioChunks.push(chunk);
    await handleS2SStream(chunk, socket);
  });

  socket.on('stop-audio', async () => {
    const combined = Buffer.concat(socket.data.audioChunks || []);
    socket.data.audioChunks = [];

    if (combined.length === 0) {
      socket.emit('ai-response', { transcript: copy.noAudio, reply: copy.noAudio });
      return;
    }

    await handleS2SStream(combined, socket);
  });

  socket.on('interrupt', () => {
    socket.emit('status', { text: copy.interrupted });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
