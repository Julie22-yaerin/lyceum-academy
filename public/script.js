const socket = io();
const orb = document.getElementById('orb');
const micBtn = document.getElementById('mic-btn');
const statusEl = document.getElementById('status');
const responseEl = document.getElementById('response');

let isRecording = false;
let audioCtx;
let analyser;
let mediaStream;
let processor;
let source;
let audioQueue = [];

function initAudio() {
  if (audioCtx) return;

  audioCtx = new AudioContext({ sampleRate: 16000 });
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const animate = () => {
    requestAnimationFrame(animate);
    analyser.getByteFrequencyData(freqData);
    const avg = freqData.reduce((sum, value) => sum + value, 0) / freqData.length;
    orb.style.transform = `scale(${1 + avg / 140})`;
  };

  animate();
}

async function startRecording() {
  initAudio();
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  source = audioCtx.createMediaStreamSource(mediaStream);
  source.connect(analyser);

  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(audioCtx.destination);

  processor.onaudioprocess = (event) => {
    if (!isRecording) return;

    const input = event.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(input.length);

    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    const buffer = Buffer.from(pcm.buffer);
    socket.emit('audio-data', buffer);
    audioQueue.push(buffer);
  };

  isRecording = true;
  micBtn.classList.add('active');
  statusEl.textContent = 'Listening...';
}

function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  micBtn.classList.remove('active');
  statusEl.textContent = 'Processing audio...';
  socket.emit('stop-audio');

  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
  }
  if (source) {
    source.disconnect();
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }
  audioQueue = [];
}

micBtn.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
    return;
  }

  try {
    await startRecording();
  } catch (error) {
    statusEl.textContent = 'Microphone access is blocked';
    console.error(error);
  }
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
});

socket.on('status', ({ text }) => {
  statusEl.textContent = text;
});

socket.on('ai-response', ({ transcript, reply }) => {
  responseEl.textContent = `${reply}`;
  orb.classList.add('ai-speaking');
  setTimeout(() => orb.classList.remove('ai-speaking'), 1500);

  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = 'en-US';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  statusEl.textContent = transcript;
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
});
