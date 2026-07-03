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

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

async function getAIReply(transcript) {
  const apiKey = process.env.OPENAI_API_KEY;

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
              content: 'You are Feyman-style listener. Respond briefly, clearly, and helpfully.',
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

  return `AI fallback: I heard ${transcript || 'your speech'} and I am ready to help.`;
}

async function handleS2SStream(audioBuffer, socket) {
  const payload = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
  const sampleLength = payload.length;
  const durationSeconds = Math.max(1, Math.round(sampleLength / 16000 / 2));
  const transcript = `Captured ${durationSeconds}s of speech from the orb listener.`;

  socket.emit('status', { text: 'AI listener is processing your speech...' });

  const reply = await getAIReply(transcript);
  socket.emit('ai-response', { transcript, reply });
}

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.data.audioChunks = [];

  socket.on('audio-data', async (data) => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    socket.data.audioChunks.push(chunk);
    await handleS2SStream(chunk, socket);
  });

  socket.on('stop-audio', async () => {
    const combined = Buffer.concat(socket.data.audioChunks || []);
    socket.data.audioChunks = [];

    if (combined.length === 0) {
      socket.emit('ai-response', { transcript: 'No audio captured.', reply: 'No audio captured.' });
      return;
    }

    await handleS2SStream(combined, socket);
  });

  socket.on('interrupt', () => {
    socket.emit('status', { text: 'Interrupted by user.' });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
