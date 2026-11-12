import { App } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { marked } from 'marked';
import { Client, DEFAULTS, clean, getPref, setPref, newSessionId } from './api.js';
import { audio, formatVoiceError } from './audio.js';
import { JarvisVisualizer } from './visualizer.js';
import { HolographicBackground } from './particles.js';
import {
  loadAppSettings,
  saveAppSettings,
  getSavedFiles,
  saveFileItem,
  deleteFileItem,
  getReminders,
  saveReminder,
  toggleReminder,
  deleteReminder,
  getSearchHistory,
  addSearchQuery,
  clearSearchHistory,
  clearAllLocalData,
} from './storage.js';

import { AuthManager } from './auth.js';
import { GmailAssistant } from './gmail.js';
import { CalendarAssistant } from './calendar.js';

// DOM Selector Helper
const $ = (id) => document.getElementById(id);

// App State
const client = new Client();
let authManager = null;
let gmailAssistant = null;
let calendarAssistant = null;
let visualizer = null;
let bgParticles = null;
let activeTab = 'home';
let appSettings = {};
let sessionId = '';
let cache = []; // [{ role, content, tasks?, attachments? }]
let pending = []; // [{ name, mime, data, preview }]
let busy = false;

// Global isListening boolean flag for speech recognition session
let isListening = false;
let isContinuousSession = false; // Kept in sync with isListening for complete backward compatibility

// State-Based Lock for SpeechRecognition
const RecognitionState = {
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  STOPPING: 'STOPPING',
};
let recognitionState = RecognitionState.IDLE;
let recognitionInstance = null; // Active recognition instance tracking
let restartVoiceTimeout = null;

function setListeningState(active) {
  isListening = !!active;
  isContinuousSession = isListening;
}

async function stopAndNullRecognition() {
  if (recognitionInstance) {
    try {
      if (typeof recognitionInstance.stop === 'function') {
        recognitionInstance.stop();
      }
    } catch {
      // ignore
    }
    recognitionInstance = null;
  }
  await audio.stopRecognition();
  recognitionInstance = null;
}

// Automation Timers & Stopwatch State
let timerInterval = null;
let timerTotalSeconds = 300;
let timerRemaining = 300;
let timerRunning = false;

let swInterval = null;
let swStartTime = 0;
let swElapsed = 0;
let swRunning = false;
let swLaps = [];

// ----------------- UI Feedback & Toasts -----------------
function toast(msg, type = 'info', ms = 4500) {
  const t = $('toast');
  const txt = $('toast-msg');
  if (!t || !txt) return;
  txt.textContent = msg;
  t.className = 'toast ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  if (type === 'error') audio.playChime('alert');
}
$('toast-close').onclick = () => $('toast').classList.add('hidden');

function banner(msg) {
  const b = $('banner');
  if (!msg) {
    b.classList.add('hidden');
    return;
  }
  b.textContent = msg;
  b.classList.remove('hidden');
}

function setConnectionState(state, label) {
  const dot = $('status-dot');
  const lbl = $('conn-label');
  if (dot) dot.className = 'status-dot ' + (state || '');
  if (lbl) lbl.textContent = label || (state === 'ok' ? 'CONNECTED' : state === 'bad' ? 'OFFLINE' : 'STANDBY');
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ----------------- Tab Navigation -----------------
function switchTab(tabId) {
  activeTab = tabId;
  const viewports = ['home', 'commands', 'chat', 'files'];
  viewports.forEach((id) => {
    const vp = $('viewport-' + id);
    const nav = $('nav-' + id);
    if (vp) vp.classList.toggle('hidden', id !== tabId);
    if (nav) nav.classList.toggle('active', id !== tabId);
  });

  if (tabId === 'files') {
    renderFilesVault();
  } else if (tabId === 'chat') {
    scrollDownMessages();
  }
  audio.playChime('click');
}

document.querySelectorAll('.bottom-nav .nav-tab').forEach((btn) => {
  btn.onclick = () => {
    const tab = btn.dataset.tab;
    if (tab) switchTab(tab);
  };
});

// ----------------- Greeting & Clock Engine -----------------
function updateTimeAndGreeting() {
  const now = new Date();
  const hour = now.getHours();

  let greeting = 'Welcome back.';
  if (hour >= 5 && hour < 12) greeting = 'Good morning.';
  else if (hour >= 12 && hour < 17) greeting = 'Good afternoon.';
  else if (hour >= 17 && hour < 22) greeting = 'Good evening.';

  const gTitle = $('greeting-title');
  if (gTitle) gTitle.textContent = greeting;

  const optionsTime = { hour: 'numeric', minute: '2-digit', hour12: true };
  const optionsDate = { weekday: 'short', month: 'short', day: 'numeric' };
  const timeStr = now.toLocaleTimeString([], optionsTime);
  const dateStr = now.toLocaleDateString([], optionsDate);

  const gTime = $('greeting-time');
  if (gTime) gTime.textContent = `${timeStr} · ${dateStr.toUpperCase()}`;

  // Live HUD Digital Clock in Automate modal
  const clkTime = $('clock-live-time');
  const clkDate = $('clock-live-date');
  if (clkTime) {
    const pad = (n) => String(n).padStart(2, '0');
    clkTime.textContent = `${pad(hour)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  if (clkDate) {
    clkDate.textContent = `${now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  }
}
setInterval(updateTimeAndGreeting, 1000);
updateTimeAndGreeting();

// ----------------- Continuous Voice Interaction Engine -----------------
function setVoiceUIState(state) {
  const btn = $('btn-mic-main');
  const btnStart = $('btn-mic-start');
  const btnStop = $('btn-mic-stop');
  const status = $('voice-status-text');
  const preview = $('voice-transcript');

  if (state === 'LISTENING') {
    if (btn) btn.className = 'btn-mic-main listening';
    if (btnStart) btnStart.classList.add('active');
    if (btnStop) btnStop.classList.remove('active');
    if (status) status.textContent = isListening ? 'Continuous Session Active · Listening...' : 'Listening to your voice...';
    if (preview) {
      preview.textContent = 'Speak now...';
      preview.classList.remove('hidden');
    }
    if (visualizer) visualizer.setState('LISTENING');
  } else if (state === 'THINKING') {
    if (btn) btn.className = 'btn-mic-main';
    if (status) status.textContent = 'Processing request...';
    if (visualizer) visualizer.setState('THINKING');
  } else if (state === 'SPEAKING') {
    if (btn) btn.className = 'btn-mic-main speaking';
    if (status) status.textContent = 'JARVIS Speaking (Tap Stop Mic to halt)';
    if (visualizer) visualizer.setState('SPEAKING');
  } else {
    if (btn) btn.className = 'btn-mic-main';
    if (btnStart) btnStart.classList.remove('active');
    if (btnStop) btnStop.classList.remove('active');
    if (status) status.textContent = 'Ready · Tap Start Mic for continuous hands-free dialogue';
    if (preview) preview.classList.add('hidden');
    if (visualizer) visualizer.setState('IDLE');
  }
}

async function startContinuousVoiceSession() {
  // State-based lock: reject overlapping or re-entrant invocations
  if (recognitionState !== RecognitionState.IDLE) {
    return;
  }

  if (audio.isSpeaking()) {
    audio.stopSpeaking();
  }

  setListeningState(true);
  clearTimeout(restartVoiceTimeout);
  restartVoiceTimeout = null;

  await runVoiceRecognitionTurn({ playFeedback: true });
}

async function stopContinuousVoiceSession() {
  recognitionState = RecognitionState.STOPPING;

  // Set global isListening boolean flag to false (prevents any onend auto-restarts)
  setListeningState(false);
  clearTimeout(restartVoiceTimeout);
  restartVoiceTimeout = null;

  // Ensure stop() is called and recognition instance is explicitly set to null
  await stopAndNullRecognition();

  if (audio.isSpeaking()) {
    audio.stopSpeaking();
  }

  recognitionState = RecognitionState.IDLE;
  setVoiceUIState('IDLE');
  toast('Voice assistant session stopped.', 'info', 2000);
}

async function handleVoiceInteraction() {
  if (isListening || recognitionState !== RecognitionState.IDLE || audio.isSpeaking()) {
    await stopContinuousVoiceSession();
  } else {
    await startContinuousVoiceSession();
  }
}

async function runVoiceRecognitionTurn({ playFeedback = false } = {}) {
  // Guard 1: Verify the global isListening boolean flag is active
  if (!isListening) {
    recognitionState = RecognitionState.IDLE;
    setVoiceUIState('IDLE');
    return;
  }

  // Guard 2: State-based lock prevents multiple concurrent turns or auto-restart recursion loops
  if (recognitionState !== RecognitionState.IDLE) {
    return;
  }

  if (!audio.recSupported) {
    toast('Speech recognition not supported on this device. You can type in Chat.', 'info');
    switchTab('chat');
    setListeningState(false);
    recognitionState = RecognitionState.IDLE;
    setVoiceUIState('IDLE');
    return;
  }

  if (audio.isSpeaking()) {
    return;
  }

  // Engage state-based lock: STARTING
  recognitionState = RecognitionState.STARTING;

  // Ensure stop() is called and recognition instance is set to null before start() is invoked
  await stopAndNullRecognition();

  // Re-verify global isListening boolean flag after asynchronous stop/null cleanup
  if (!isListening) {
    recognitionState = RecognitionState.IDLE;
    setVoiceUIState('IDLE');
    return;
  }

  setVoiceUIState('LISTENING');

  try {
    await audio.startRecognition({
      playFeedback,
      onStart: () => {
        if (!isListening) {
          stopAndNullRecognition();
          recognitionState = RecognitionState.IDLE;
          setVoiceUIState('IDLE');
          return;
        }
        recognitionState = RecognitionState.LISTENING;
        setVoiceUIState('LISTENING');
        recognitionInstance = audio.getRecognitionInstance();
      },
      onResult: (transcript) => {
        if (!isListening) return;
        const p = $('voice-transcript');
        if (p) {
          p.textContent = `"${transcript}"`;
          p.classList.remove('hidden');
        }
      },
      onError: (err) => {
        recognitionInstance = null;
        const errInfo = formatVoiceError(err);

        // onend / onError handlers only trigger a restart if global isListening flag is still active
        if (isListening && (errInfo.type === 'no_speech' || errInfo.type === 'busy' || errInfo.type === 'cancelled')) {
          recognitionState = RecognitionState.IDLE;
          clearTimeout(restartVoiceTimeout);
          restartVoiceTimeout = setTimeout(() => {
            if (isListening && recognitionState === RecognitionState.IDLE && !audio.isSpeaking()) {
              runVoiceRecognitionTurn({ playFeedback: false });
            }
          }, 400);
          return;
        }

        setListeningState(false);
        recognitionState = RecognitionState.IDLE;
        setVoiceUIState('IDLE');
        if (errInfo.userMessage) {
          toast(errInfo.userMessage, 'error', 5000);
        }
      },
      onEnd: async (finalText) => {
        recognitionInstance = null;

        // Modify onend to check a global isListening boolean flag before attempting any auto-restarts
        if (!isListening) {
          recognitionState = RecognitionState.IDLE;
          setVoiceUIState('IDLE');
          return;
        }

        const cleanText = (finalText || '').trim();
        if (!cleanText) {
          // Silence or empty utterance:
          // Check global isListening boolean flag before attempting auto-restart
          recognitionState = RecognitionState.IDLE;
          clearTimeout(restartVoiceTimeout);
          restartVoiceTimeout = setTimeout(() => {
            if (isListening && recognitionState === RecognitionState.IDLE && !audio.isSpeaking()) {
              runVoiceRecognitionTurn({ playFeedback: false });
            }
          }, 350);
          return;
        }

        // Recognized speech ready for AI pipeline: engage PROCESSING lock
        recognitionState = RecognitionState.PROCESSING;
        setVoiceUIState('THINKING');
        await executeUserQuery(cleanText, true);
      },
    });

    recognitionInstance = audio.getRecognitionInstance();
  } catch (err) {
    recognitionInstance = null;
    recognitionState = RecognitionState.IDLE;
    if (isListening) {
      clearTimeout(restartVoiceTimeout);
      restartVoiceTimeout = setTimeout(() => {
        if (isListening && recognitionState === RecognitionState.IDLE && !audio.isSpeaking()) {
          runVoiceRecognitionTurn({ playFeedback: false });
        }
      }, 500);
    }
  }
}

const btnMicStart = $('btn-mic-start');
if (btnMicStart) btnMicStart.onclick = startContinuousVoiceSession;

const btnMicStop = $('btn-mic-stop');
if (btnMicStop) btnMicStop.onclick = stopContinuousVoiceSession;

$('btn-mic-main').onclick = handleVoiceInteraction;
$('visualizer-card').onclick = handleVoiceInteraction;
$('btn-chat-mic').onclick = handleVoiceInteraction;

// ----------------- Query Execution Pipeline -----------------
async function executeUserQuery(text, speakResponse = false) {
  if (!text || !text.trim()) return;
  if (!client.configured) {
    openSettingsSheet('advanced');
    toast('Please enter your backend URL in Settings first.', 'error');
    setVoiceUIState('IDLE');
    return;
  }

  busy = true;
  const sendBtn = $('btn-send');
  if (sendBtn) sendBtn.disabled = true;

  const files = pending.map(({ name, mime, data }) => ({ name, mime, data }));
  const userMsg = {
    role: 'user',
    content: text,
    attachments: pending.map(({ name, preview }) => ({ name, preview })),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  cache.push(userMsg);
  renderMessages();
  showTyping(true);

  if (visualizer) visualizer.setState('THINKING');

  let slowTimer = null;
  try {
    // Show polite warning banner only if both backends take longer than 3.5s (e.g. Render cold start)
    slowTimer = setTimeout(() => {
      if (busy) banner('Connecting to neural core... (cold start may take a few seconds)');
    }, 3500);

    const data = await client.chat(text, sessionId, files);
    clearTimeout(slowTimer);
    banner('');
    setConnectionState('ok', 'CONNECTED');
    const replyText = data.response || '(No text response)';

    cache.push({
      role: 'assistant',
      content: replyText,
      tasks: data.tasks || [],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    audio.playChime('complete');

    if (speakResponse && appSettings.autoSpeak) {
      setVoiceUIState('SPEAKING');
      audio.speak(replyText, {
        voiceName: appSettings.voiceName,
        rate: appSettings.voiceSpeed,
        pitch: appSettings.voicePitch,
        onEnd: () => {
          recognitionState = RecognitionState.IDLE;
          if (isContinuousListening) {
            clearTimeout(restartVoiceTimeout);
            restartVoiceTimeout = setTimeout(() => {
              if (isContinuousListening && recognitionState === RecognitionState.IDLE && !audio.isSpeaking()) {
                runVoiceRecognitionTurn({ playFeedback: false });
              }
            }, 350);
          } else {
            setVoiceUIState('IDLE');
          }
        },
        onError: () => {
          recognitionState = RecognitionState.IDLE;
          if (isContinuousListening) {
            clearTimeout(restartVoiceTimeout);
            restartVoiceTimeout = setTimeout(() => {
              if (isContinuousListening && recognitionState === RecognitionState.IDLE && !audio.isSpeaking()) {
                runVoiceRecognitionTurn({ playFeedback: false });
              }
            }, 350);
          } else {
            setVoiceUIState('IDLE');
          }
        },
      });
    } else {
      recognitionState = RecognitionState.IDLE;
      if (isContinuousListening) {
        clearTimeout(restartVoiceTimeout);
        restartVoiceTimeout = setTimeout(() => {
          if (isContinuousListening && recognitionState === RecognitionState.IDLE && !audio.isSpeaking()) {
            runVoiceRecognitionTurn({ playFeedback: false });
          }
        }, 350);
      } else {
        setVoiceUIState('IDLE');
      }
    }
  } catch (err) {
    if (slowTimer) clearTimeout(slowTimer);
    banner('');
    setConnectionState('bad', 'DISCONNECTED');
    if (visualizer) visualizer.setState('ERROR');
    toast(err.message || 'Request failed.', 'error');
    cache.push({
      role: 'assistant',
      content: '⚠️ ' + (err.message || 'Request failed.'),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    setTimeout(() => {
      if (visualizer && visualizer.state === 'ERROR') visualizer.setState('IDLE');
    }, 4000);
    setContinuousListening(false);
    clearTimeout(restartVoiceTimeout);
    restartVoiceTimeout = null;
    recognitionState = RecognitionState.IDLE;
    setVoiceUIState('IDLE');
  } finally {
    showTyping(false);
    renderMessages();
    await saveCache();
    busy = false;
    if (sendBtn) sendBtn.disabled = false;
    pending = [];
    renderChips();
  }
}

// ----------------- Chat View & Rendering -----------------
function scrollDownMessages() {
  const m = $('messages');
  if (m) m.scrollTop = m.scrollHeight;
}

function renderMedia(parent, url, mime) {
  const isAudio = (mime || '').startsWith('audio') || /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i.test(url);
  if (isAudio) {
    const a = el('audio');
    a.controls = true;
    a.src = url;
    parent.appendChild(a);
  } else {
    const img = el('img', 'media');
    img.src = url;
    img.loading = 'lazy';
    img.alt = 'JARVIS visual artifact';
    img.onclick = () => openZoom(url);
    parent.appendChild(img);
  }
}

function renderStepList(tasks) {
  const d = el('details', 'steps');
  d.appendChild(el('summary', null, `Executed Tasks & Models (${tasks.length})`));
  tasks.forEach((t) => {
    const s = el('div', 'step');
    const head = el('div');
    head.appendChild(el('b', null, t.task || 'Execution Step'));
    head.appendChild(document.createTextNode(` · ${t.model || 'JARVIS Core'} · `));
    head.appendChild(el('span', t.status === 'done' ? 'st-done' : '', t.status || ''));
    s.appendChild(head);
    if (t.text) s.appendChild(el('div', null, t.text));
    if (t.error) s.appendChild(el('div', 'err', t.error));
    d.appendChild(s);
  });
  return d;
}

function renderMessage(m, index) {
  const b = el('div', `msg ${m.role}`);

  const header = el('div', 'msg-header');
  header.appendChild(el('span', null, m.role === 'user' ? 'YOU' : 'JARVIS'));

  const actions = el('div', 'msg-actions');
  if (m.timestamp) actions.appendChild(el('span', null, m.timestamp));

  // Copy button
  const btnCopy = el('button', 'msg-btn-action', '📋');
  btnCopy.title = 'Copy message';
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(m.content || '');
    toast('Copied to clipboard.', 'success');
  };
  actions.appendChild(btnCopy);

  // Read Aloud button for assistant
  if (m.role === 'assistant') {
    const btnSpeak = el('button', 'msg-btn-action', '🔊');
    btnSpeak.title = 'Read aloud';
    btnSpeak.onclick = () => {
      audio.speak(m.content || '', {
        voiceName: appSettings.voiceName,
        rate: appSettings.voiceSpeed,
        pitch: appSettings.voicePitch,
        onStart: () => {
          if (visualizer) visualizer.setState('SPEAKING');
        },
        onEnd: () => {
          if (visualizer) visualizer.setState('IDLE');
        },
      });
    };
    actions.appendChild(btnSpeak);
  }

  header.appendChild(actions);
  b.appendChild(header);

  // Markdown rendering
  const body = el('div', 'msg-body');
  try {
    body.innerHTML = marked.parse(m.content || '');
  } catch {
    body.textContent = m.content || '';
  }
  b.appendChild(body);

  // Attachments
  (m.attachments || []).forEach((a) => {
    if (a.preview) {
      const i = el('img', 'media');
      i.src = a.preview;
      i.alt = a.name;
      i.onclick = () => openZoom(a.preview);
      b.appendChild(i);
    } else {
      b.appendChild(el('div', 'attach-note', '📎 ' + a.name));
    }
  });

  // Generated tasks/files
  (m.tasks || []).forEach((t) => {
    if (t.file_url) renderMedia(b, t.file_url, t.mime);
  });
  if (m.tasks && m.tasks.length) b.appendChild(renderStepList(m.tasks));

  return b;
}

function renderMessages() {
  const box = $('messages');
  if (!box) return;
  box.innerHTML = '';
  if (!cache.length) {
    const empty = el('div', 'empty-state');
    empty.innerHTML = `
      <div style="font-size: 32px; color: var(--accent); margin-bottom: 8px;">✦</div>
      <div style="font-weight: 600; color: var(--text);">JARVIS Live Chat</div>
      <div style="font-size: 13px;">Type a message or tap the microphone to begin.</div>
    `;
    box.appendChild(empty);
    return;
  }
  cache.forEach((m, idx) => box.appendChild(renderMessage(m, idx)));
  scrollDownMessages();
}

function showTyping(on) {
  let t = $('typing');
  const box = $('messages');
  if (!box) return;
  if (on && !t) {
    t = el('div', 'typing');
    t.id = 'typing';
    t.append(el('span'), el('span'), el('span'));
    box.appendChild(t);
    scrollDownMessages();
  } else if (!on && t) {
    t.remove();
  }
}

function openZoom(url) {
  const z = $('zoom');
  if (!z) return;
  z.querySelector('img').src = url;
  z.classList.remove('hidden');
}
$('zoom').onclick = () => $('zoom').classList.add('hidden');

// ----------------- Chat Input & Attachments -----------------
function renderChips() {
  const c = $('chips');
  if (!c) return;
  c.innerHTML = '';
  pending.forEach((f, i) => {
    const chip = el('div', 'chip');
    if (f.preview) {
      const im = el('img');
      im.src = f.preview;
      chip.appendChild(im);
    } else {
      chip.appendChild(el('span', null, '🎵'));
    }
    chip.appendChild(el('span', 'nm', f.name));
    const x = el('button', null, '✕');
    x.onclick = () => {
      pending.splice(i, 1);
      renderChips();
    };
    chip.appendChild(x);
    c.appendChild(chip);
  });
}

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

async function resizeToJpeg(dataUrl, max = 1600, q = 0.85) {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

const stripPrefix = (d) => d.replace(/^data:[^;]+;base64,/, '');

async function addFile(file) {
  if (pending.length >= 4) return toast('Up to 4 files per message.', 'error');
  try {
    const dataUrl = await readAsDataURL(file);
    if (file.type.startsWith('image/')) {
      const jpg = await resizeToJpeg(dataUrl);
      const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
      pending.push({ name: base + '.jpg', mime: 'image/jpeg', data: stripPrefix(jpg), preview: jpg });
    } else if (file.type.startsWith('audio/')) {
      pending.push({ name: file.name || 'audio', mime: file.type, data: stripPrefix(dataUrl), preview: null });
    } else {
      toast('Images and audio files are supported.', 'error');
    }
    renderChips();
  } catch {
    toast('Could not read file.', 'error');
  }
}

$('btn-attach').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  for (const f of Array.from(e.target.files)) await addFile(f);
  e.target.value = '';
};

const cameraInput = $('camera-file');
if (cameraInput) {
  cameraInput.onchange = async (e) => {
    for (const f of Array.from(e.target.files)) await addFile(f);
    e.target.value = '';
  };
}

$('btn-camera').onclick = async () => {
  if (pending.length >= 4) return toast('Up to 4 files per message.', 'error');
  try {
    const p = await Camera.getPhoto({ quality: 90, resultType: CameraResultType.DataUrl, source: CameraSource.Camera });
    const jpg = await resizeToJpeg(p.dataUrl);
    pending.push({ name: `camera-${Date.now()}.jpg`, mime: 'image/jpeg', data: stripPrefix(jpg), preview: jpg });
    renderChips();
  } catch (e) {
    if (!/cancel/i.test(String(e?.message || e))) {
      if (cameraInput) cameraInput.click();
      else toast('Camera unavailable.', 'error');
    }
  }
};

$('btn-send').onclick = () => {
  const input = $('input');
  const text = input.value.trim();
  if (!text && !pending.length) return;
  input.value = '';
  input.style.height = 'auto';
  executeUserQuery(text, false);
};

$('input').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
});

$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('btn-send').click();
  }
});

// ----------------- Chat Sessions & Persistence -----------------
async function saveCache() {
  const slim = cache.slice(-150).map((m) => ({
    ...m,
    attachments: (m.attachments || []).map((a) => ({ name: a.name })),
  }));
  await setPref('chat_' + sessionId, JSON.stringify(slim));
}

async function loadSession() {
  sessionId = await getPref('session_id', '');
  if (!sessionId) {
    sessionId = newSessionId();
    await setPref('session_id', sessionId);
  }
  try {
    cache = JSON.parse(await getPref('chat_' + sessionId, '[]'));
  } catch {
    cache = [];
  }
  renderMessages();
}

$('btn-new-chat').onclick = async () => {
  sessionId = newSessionId();
  await setPref('session_id', sessionId);
  cache = [];
  pending = [];
  renderChips();
  renderMessages();
  toast('Started new conversation session.', 'success');
};

$('btn-view-history').onclick = async () => {
  $('history').classList.remove('hidden');
  const list = $('history-list');
  list.innerHTML = '';
  if (!client.configured) {
    list.innerHTML = '<div class="empty-state">Configure backend first in Settings.</div>';
    return;
  }
  list.innerHTML = '<div class="empty-state">Loading history...</div>';
  try {
    const data = await client.history(sessionId);
    list.innerHTML = '';
    (data.messages || []).forEach((m) => {
      const msg = el('div', `msg ${m.role}`);
      msg.textContent = m.content;
      list.appendChild(msg);
    });
    if (!list.children.length) {
      list.innerHTML = '<div class="empty-state">No past messages in this session.</div>';
    }
  } catch (err) {
    list.innerHTML = `<div class="empty-state">Could not load history: ${err.message}</div>`;
  }
};
$('btn-close-history').onclick = () => $('history').classList.add('hidden');

// ----------------- 6 Home Action Handlers -----------------
$('card-chat').onclick = () => switchTab('chat');
$('card-system').onclick = () => openSheet('modal-system');
$('card-create').onclick = () => openSheet('modal-create');
$('card-search').onclick = () => {
  openSheet('modal-search');
  renderRecentSearches();
};
$('card-analyze').onclick = () => openSheet('modal-analyze');
$('card-automate').onclick = () => openSheet('modal-clock');

// ----------------- System Control Modal -----------------
$('btn-close-system').onclick = () => closeSheet('modal-system');

const openExternalLink = (url, label) => {
  toast(`Opening ${label}...`, 'info');
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    toast(`Please open ${url} in browser.`, 'info');
  }
};

$('sys-maps').onclick = () => openExternalLink('https://maps.google.com', 'Google Maps');
$('sys-calendar').onclick = () => openExternalLink('https://calendar.google.com', 'Google Calendar');
$('sys-gmail').onclick = () => openExternalLink('https://mail.google.com', 'Gmail');

$('sys-clock').onclick = () => {
  closeSheet('modal-system');
  openSheet('modal-clock');
};

// ----------------- Create Tool Modal -----------------
let activeCreateTpl = 'email';
const createTemplates = {
  email: {
    label: 'Describe the email topic, recipient, and tone:',
    prefix: 'Draft a professional email regarding: ',
  },
  summary: {
    label: 'Paste text or describe the material to summarize:',
    prefix: 'Provide an executive summary of the following: ',
  },
  notes: {
    label: 'Enter the key points or meeting topics for structured notes:',
    prefix: 'Format the following into clear, bulleted executive notes: ',
  },
  ideas: {
    label: 'What topic or project would you like to brainstorm?',
    prefix: 'Brainstorm 5 innovative, strategic ideas for: ',
  },
};

document.querySelectorAll('#modal-create .filter-tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('#modal-create .filter-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeCreateTpl = tab.dataset.tpl;
    const tpl = createTemplates[activeCreateTpl];
    if (tpl) $('create-prompt-label').textContent = tpl.label;
  };
});

$('btn-close-create').onclick = () => closeSheet('modal-create');

$('btn-create-submit').onclick = async () => {
  const promptVal = $('create-prompt-input').value.trim();
  if (!promptVal) return toast('Please enter a description.', 'error');
  const tpl = createTemplates[activeCreateTpl];
  const query = (tpl?.prefix || '') + promptVal;

  $('btn-create-submit').disabled = true;
  $('btn-create-submit').textContent = 'Generating with JARVIS...';

  try {
    const data = await client.chat(query, sessionId, []);
    const resText = data.response || '(No response)';
    $('create-result-text').value = resText;
    $('create-result-box').classList.remove('hidden');
    audio.playChime('complete');
  } catch (err) {
    toast('Generation failed: ' + err.message, 'error');
  } finally {
    $('btn-create-submit').disabled = false;
    $('btn-create-submit').textContent = 'Generate Draft';
  }
};

$('btn-copy-created').onclick = () => {
  const val = $('create-result-text').value;
  if (val) {
    navigator.clipboard.writeText(val);
    toast('Draft copied to clipboard.', 'success');
  }
};

$('btn-save-created').onclick = async () => {
  const val = $('create-result-text').value;
  if (!val) return;
  const title = $('create-prompt-input').value.slice(0, 40) || 'AI Draft';
  await saveFileItem({ title, category: activeCreateTpl, content: val });
  toast('Draft saved to Vault (Files tab).', 'success');
  audio.playChime('complete');
};

// ----------------- Search Tool Modal -----------------
$('btn-close-search').onclick = () => closeSheet('modal-search');

async function renderRecentSearches() {
  const list = await getSearchHistory();
  const c = $('recent-search-chips');
  c.innerHTML = '';
  if (!list.length) {
    c.innerHTML = '<span style="font-size: 12px; color: var(--text-dim);">No recent searches</span>';
    return;
  }
  list.slice(0, 8).forEach((q) => {
    const chip = el('button', 'filter-tab', q);
    chip.onclick = () => {
      $('search-query-input').value = q;
      $('btn-search-exec').click();
    };
    c.appendChild(chip);
  });
}

$('btn-search-exec').onclick = async () => {
  const q = $('search-query-input').value.trim();
  if (!q) return;
  await addSearchQuery(q);
  renderRecentSearches();

  $('btn-search-exec').disabled = true;
  $('btn-search-exec').textContent = 'Searching...';

  try {
    const data = await client.chat(`Perform an intelligence search and summary for: "${q}"`, sessionId, []);
    const resBox = $('search-result-box');
    const content = $('search-result-content');
    resBox.classList.remove('hidden');
    content.innerHTML = marked.parse(data.response || 'No information found.');
    audio.playChime('complete');
  } catch (err) {
    toast('Search failed: ' + err.message, 'error');
  } finally {
    $('btn-search-exec').disabled = false;
    $('btn-search-exec').textContent = 'Search';
  }
};

// ----------------- Analyze Tool Modal -----------------
$('btn-close-analyze').onclick = () => closeSheet('modal-analyze');

let analyzeFileObj = null;
$('analyze-file-input').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const wrap = $('analyze-preview-wrap');
  wrap.innerHTML = '';

  const dataUrl = await readAsDataURL(file);
  if (file.type.startsWith('image/')) {
    const jpg = await resizeToJpeg(dataUrl);
    analyzeFileObj = { name: file.name, mime: 'image/jpeg', data: stripPrefix(jpg), preview: jpg };
    const img = el('img', 'media');
    img.src = jpg;
    img.style.maxHeight = '140px';
    wrap.appendChild(img);
  } else {
    analyzeFileObj = { name: file.name, mime: file.type, data: stripPrefix(dataUrl), preview: null };
    wrap.innerHTML = `<div class="attach-note">📎 Selected: ${file.name}</div>`;
  }
};

$('btn-analyze-submit').onclick = async () => {
  if (!analyzeFileObj) return toast('Please select an image or audio file first.', 'error');
  const taskPrompt = $('analyze-task-select').value;

  $('btn-analyze-submit').disabled = true;
  $('btn-analyze-submit').textContent = 'Analyzing Media...';

  try {
    const data = await client.chat(taskPrompt, sessionId, [analyzeFileObj]);
    $('analyze-result-box').classList.remove('hidden');
    $('analyze-result-content').innerHTML = marked.parse(data.response || 'Analysis complete.');
    audio.playChime('complete');
  } catch (err) {
    toast('Analysis failed: ' + err.message, 'error');
  } finally {
    $('btn-analyze-submit').disabled = false;
    $('btn-analyze-submit').textContent = 'Analyze with JARVIS';
  }
};

$('btn-save-analyze').onclick = async () => {
  const content = $('analyze-result-content').innerText;
  if (!content) return;
  await saveFileItem({
    title: 'Analysis Report: ' + (analyzeFileObj?.name || 'File Inspection'),
    category: 'analysis',
    content,
    previewUrl: analyzeFileObj?.preview || null,
  });
  toast('Analysis report saved to Vault.', 'success');
};

// ----------------- Clock, Timers & Reminders Modal -----------------
$('btn-close-clock').onclick = () => closeSheet('modal-clock');

document.querySelectorAll('#modal-clock .filter-tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('#modal-clock .filter-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const panel = tab.dataset.cpanel;
    ['timer', 'stopwatch', 'reminders'].forEach((p) => {
      $('cpanel-' + p).classList.toggle('hidden', p !== panel);
    });
    if (panel === 'reminders') renderRemindersList();
  };
});

// Countdown Timer
function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

document.querySelectorAll('.timer-preset').forEach((btn) => {
  btn.onclick = () => {
    const s = parseInt(btn.dataset.sec, 10);
    timerTotalSeconds = s;
    timerRemaining = s;
    $('timer-display').textContent = formatSeconds(s);
  };
});

$('btn-timer-start').onclick = () => {
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    $('btn-timer-start').textContent = 'Resume';
    return;
  }
  timerRunning = true;
  $('btn-timer-start').textContent = 'Pause';
  timerInterval = setInterval(() => {
    if (timerRemaining > 0) {
      timerRemaining--;
      $('timer-display').textContent = formatSeconds(timerRemaining);
    } else {
      clearInterval(timerInterval);
      timerRunning = false;
      $('btn-timer-start').textContent = 'Start Timer';
      audio.playChime('timer');
      toast('⏰ Timer finished!', 'success', 8000);
      if (visualizer) visualizer.setState('SPEAKING');
      setTimeout(() => {
        if (visualizer) visualizer.setState('IDLE');
      }, 3000);
    }
  }, 1000);
};

$('btn-timer-reset').onclick = () => {
  clearInterval(timerInterval);
  timerRunning = false;
  timerRemaining = timerTotalSeconds;
  $('timer-display').textContent = formatSeconds(timerRemaining);
  $('btn-timer-start').textContent = 'Start Timer';
};

// Stopwatch
function formatSw(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

$('btn-sw-toggle').onclick = () => {
  if (swRunning) {
    clearInterval(swInterval);
    swRunning = false;
    $('btn-sw-toggle').textContent = 'Resume';
    return;
  }
  swRunning = true;
  swStartTime = Date.now() - swElapsed;
  $('btn-sw-toggle').textContent = 'Pause';
  swInterval = setInterval(() => {
    swElapsed = Date.now() - swStartTime;
    $('sw-display').textContent = formatSw(swElapsed);
  }, 100);
};

$('btn-sw-lap').onclick = () => {
  if (!swElapsed) return;
  swLaps.unshift(formatSw(swElapsed));
  const list = $('sw-laps-list');
  list.innerHTML = swLaps.map((l, i) => `<div>Lap ${swLaps.length - i}: ${l}</div>`).join('');
};

$('btn-sw-reset').onclick = () => {
  clearInterval(swInterval);
  swRunning = false;
  swElapsed = 0;
  swLaps = [];
  $('sw-display').textContent = '00:00.0';
  $('btn-sw-toggle').textContent = 'Start';
  $('sw-laps-list').innerHTML = '';
};

// Reminders
async function renderRemindersList() {
  const container = $('reminders-list-container');
  const items = await getReminders();
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">No reminders set. Add one above.</div>';
    return;
  }
  items.forEach((r) => {
    const card = el('div', 'assistant-card');
    const info = el('div');
    const title = el('div', null, r.title);
    title.style.textDecoration = r.completed ? 'line-through' : 'none';
    title.style.color = r.completed ? 'var(--text-dim)' : 'var(--text)';
    info.appendChild(title);
    info.appendChild(el('div', 'assistant-status-badge', r.date));
    card.appendChild(info);

    const actions = el('div', 'row');
    const btnCheck = el('button', 'btn', r.completed ? 'Undo' : 'Done');
    btnCheck.onclick = async () => {
      await toggleReminder(r.id);
      renderRemindersList();
    };
    const btnDel = el('button', 'btn danger', '✕');
    btnDel.onclick = async () => {
      await deleteReminder(r.id);
      renderRemindersList();
    };
    actions.appendChild(btnCheck);
    actions.appendChild(btnDel);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

$('btn-add-reminder').onclick = async () => {
  const text = $('reminder-input').value.trim();
  if (!text) return;
  await saveReminder({ title: text });
  $('reminder-input').value = '';
  renderRemindersList();
  toast('Reminder created.', 'success');
};

// ----------------- Commands Execution -----------------
document.querySelectorAll('#viewport-commands .command-card').forEach((card) => {
  const btn = card.querySelector('.cmd-run-btn');
  const action = card.dataset.action;
  const cmd = card.dataset.cmd;

  const run = () => {
    if (action === 'maps') $('sys-maps').click();
    else if (action === 'calendar') $('sys-calendar').click();
    else if (action === 'timer-5') {
      timerRemaining = 300;
      openSheet('modal-clock');
      $('btn-timer-start').click();
    } else if (cmd) {
      switchTab('chat');
      executeUserQuery(cmd, true);
    }
  };

  card.onclick = run;
  if (btn) btn.onclick = (e) => {
    e.stopPropagation();
    run();
  };
});

// ----------------- Files Vault Screen -----------------
let activeFileFilter = 'all';

document.querySelectorAll('#viewport-files .filter-tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('#viewport-files .filter-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeFileFilter = tab.dataset.filter;
    renderFilesVault();
  };
});

async function renderFilesVault() {
  const container = $('files-list');
  const allFiles = await getSavedFiles();
  const filtered = activeFileFilter === 'all' ? allFiles : allFiles.filter((f) => f.category === activeFileFilter);

  container.innerHTML = '';
  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 28px; margin-bottom: 6px;">📂</div>
        <div style="font-weight: 600;">Vault is empty</div>
        <div>Create drafts or analyze files to save them here.</div>
      </div>
    `;
    return;
  }

  filtered.forEach((file) => {
    const card = el('div', 'file-item-card');

    const head = el('div', 'file-card-header');
    head.appendChild(el('span', 'file-badge-tag', file.category));
    head.appendChild(el('span', 'file-date-tag', new Date(file.createdAt).toLocaleDateString()));
    card.appendChild(head);

    card.appendChild(el('div', 'file-card-title', file.title));

    if (file.content) {
      card.appendChild(el('div', 'file-card-snippet', file.content));
    }

    const actions = el('div', 'file-card-actions');
    const btnCopy = el('button', 'file-action-btn', '📋 Copy');
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(file.content || '');
      toast('Copied to clipboard.', 'success');
    };
    actions.appendChild(btnCopy);

    const btnExport = el('button', 'file-action-btn', '💾 Export');
    btnExport.onclick = () => {
      const blob = new Blob([file.content || ''], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (file.title.replace(/\s+/g, '_') || 'jarvis_export') + '.txt';
      a.click();
    };
    actions.appendChild(btnExport);

    const btnDel = el('button', 'file-action-btn danger', '🗑️ Delete');
    btnDel.onclick = async () => {
      await deleteFileItem(file.id);
      renderFilesVault();
      toast('File removed from Vault.', 'info');
    };
    actions.appendChild(btnDel);

    card.appendChild(actions);
    container.appendChild(card);
  });
}

// ----------------- Profile & Hidden Settings -----------------
function openSheet(id) {
  const s = $(id);
  if (s) s.classList.remove('hidden');
}

function closeSheet(id) {
  const s = $(id);
  if (s) s.classList.add('hidden');
}

function openSettingsSheet(panel = 'ai') {
  openSheet('settings');
  document.querySelectorAll('.settings-tabs-bar .settings-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.spanel === panel);
  });
  document.querySelectorAll('.settings-panel').forEach((p) => {
    p.classList.toggle('hidden', p.id !== 'spanel-' + panel);
  });
  populateSettingsUI();
}

$('btn-avatar').onclick = () => openSettingsSheet('ai');
$('btn-close-settings').onclick = () => closeSheet('settings');

document.querySelectorAll('.settings-tabs-bar .settings-nav-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.settings-tabs-bar .settings-nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.spanel;
    document.querySelectorAll('.settings-panel').forEach((p) => {
      p.classList.toggle('hidden', p.id !== 'spanel-' + target);
    });
  };
});

async function populateSettingsUI() {
  $('set-url').value = await getPref('backend_url', DEFAULTS.url);
  $('set-url2').value = await getPref('backend_url2', DEFAULTS.url2);
  $('set-token').value = await getPref('app_token', DEFAULTS.token);

  // Wire up token show/hide and clear buttons
  const tokenInp = $('set-token');
  const btnToggleVis = $('btn-toggle-token-vis');
  const btnClr = $('btn-clear-token');

  if (btnToggleVis && tokenInp) {
    btnToggleVis.onclick = (e) => {
      e.preventDefault();
      if (tokenInp.type === 'password') {
        tokenInp.type = 'text';
        btnToggleVis.textContent = '🔒';
        btnToggleVis.title = 'Hide Token';
      } else {
        tokenInp.type = 'password';
        btnToggleVis.textContent = '👁️';
        btnToggleVis.title = 'Show Token';
      }
    };
  }

  if (btnClr && tokenInp) {
    btnClr.onclick = (e) => {
      e.preventDefault();
      tokenInp.value = '';
      tokenInp.focus();
      toast('App Token cleared. Tap Save Configuration to persist.', 'info');
    };
  }

  // Populate Voices
  const voices = audio.getVoices();
  const select = $('set-voice-select');
  select.innerHTML = '';
  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.name === appSettings.voiceName) opt.selected = true;
    select.appendChild(opt);
  });

  $('set-auto-speak').checked = appSettings.autoSpeak;
  $('set-voice-speed').value = appSettings.voiceSpeed;
  $('set-speed-label').textContent = appSettings.voiceSpeed + 'x';
  $('set-theme-accent').value = appSettings.themeAccent;
  $('set-sound-fx').checked = appSettings.soundEffects;
  $('set-reduced-motion').checked = appSettings.animationIntensity === 'reduced';

  // Populate provider availability in Settings AI
  renderSettingsProviders();
}

function renderSettingsProviders() {
  const container = $('settings-providers-list');
  if (!container) return;
  const providers = ['JARVIS', 'Gemini', 'Groq', 'Mistral', 'OpenRouter', 'OpenAI', 'Claude', 'Copilot'];
  container.innerHTML = '';
  providers.forEach((p) => {
    const stat = client.getProviderStatus(p);
    const item = el('div', 'assistant-card');
    item.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div style="font-weight:600; color:var(--text);">${stat.name}</div>
        <div style="font-size:12px; color:var(--text-dim);">${stat.label}</div>
      </div>
      <div class="assistant-status-badge ${stat.status}">${stat.status === 'active' ? 'ACTIVE' : stat.status === 'ready' ? 'AVAILABLE' : stat.status === 'server-config' ? 'REQUIRES KEY' : 'EXTERNAL'}</div>
    `;
    container.appendChild(item);
  });
}

$('set-voice-speed').oninput = (e) => {
  $('set-speed-label').textContent = e.target.value + 'x';
};

$('btn-test-voice').onclick = () => {
  audio.speak('Greetings. JARVIS voice synthesis active and responsive.', {
    voiceName: $('set-voice-select').value,
    rate: parseFloat($('set-voice-speed').value),
    onStart: () => toast('Speaking sample...', 'info'),
  });
};

$('btn-stop-voice').onclick = () => audio.stopSpeaking();

// Test Location
$('btn-test-location').onclick = () => {
  const out = $('location-test-result');
  out.textContent = 'Requesting geolocation...';
  if (!navigator.geolocation) {
    out.textContent = 'Geolocation not supported by device.';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      out.textContent = `📍 Latitude: ${pos.coords.latitude.toFixed(4)}, Longitude: ${pos.coords.longitude.toFixed(4)} (Accuracy: ${pos.coords.accuracy}m)`;
    },
    (err) => {
      out.textContent = 'Geolocation error: ' + err.message;
    }
  );
};

// Device Permissions Check
$('btn-perm-mic').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    toast('Microphone permission GRANTED.', 'success');
  } catch (e) {
    toast('Microphone permission DENIED: ' + e.message, 'error');
  }
};

$('btn-perm-notif').onclick = async () => {
  if (!('Notification' in window)) return toast('Notifications not supported in this browser.', 'info');
  const res = await Notification.requestPermission();
  toast('Notification permission: ' + res, res === 'granted' ? 'success' : 'info');
};

// Privacy Actions (with safe non-blocking 2-tap confirmation)
let clearChatPending = false;
let clearChatTimer = null;
$('btn-clear-chat').onclick = async () => {
  if (!clearChatPending) {
    clearChatPending = true;
    $('btn-clear-chat').textContent = 'Confirm?';
    clearTimeout(clearChatTimer);
    clearChatTimer = setTimeout(() => {
      clearChatPending = false;
      $('btn-clear-chat').textContent = 'Clear';
    }, 3500);
    return;
  }
  clearChatPending = false;
  $('btn-clear-chat').textContent = 'Clear';
  cache = [];
  await setPref('chat_' + sessionId, '[]');
  renderMessages();
  toast('Conversation history erased.', 'info');
};

let clearFilesPending = false;
let clearFilesTimer = null;
$('btn-clear-files').onclick = async () => {
  if (!clearFilesPending) {
    clearFilesPending = true;
    $('btn-clear-files').textContent = 'Confirm?';
    clearTimeout(clearFilesTimer);
    clearFilesTimer = setTimeout(() => {
      clearFilesPending = false;
      $('btn-clear-files').textContent = 'Clear';
    }, 3500);
    return;
  }
  clearFilesPending = false;
  $('btn-clear-files').textContent = 'Clear';
  await setPref('saved_files', '[]');
  renderFilesVault();
  toast('Saved Vault files erased.', 'info');
};

$('btn-clear-search').onclick = async () => {
  await clearSearchHistory();
  renderRecentSearches();
  toast('Search history cleared.', 'info');
};

// Save Settings
$('btn-save-settings').onclick = async () => {
  await setPref('backend_url', clean($('set-url').value));
  await setPref('backend_url2', clean($('set-url2').value));
  await setPref('app_token', $('set-token').value.trim());

  appSettings.autoSpeak = $('set-auto-speak').checked;
  appSettings.voiceSpeed = parseFloat($('set-voice-speed').value);
  appSettings.voiceName = $('set-voice-select').value;
  appSettings.themeAccent = $('set-theme-accent').value;
  appSettings.soundEffects = $('set-sound-fx').checked;
  appSettings.animationIntensity = $('set-reduced-motion').checked ? 'reduced' : 'full';

  audio.soundEnabled = appSettings.soundEffects;
  if (visualizer) {
    visualizer.setReducedMotion(appSettings.animationIntensity === 'reduced');
    visualizer.setAccentColor(appSettings.themeAccent === 'blue' ? '#38bdf8' : appSettings.themeAccent === 'emerald' ? '#10b981' : appSettings.themeAccent === 'amber' ? '#f59e0b' : '#00f0ff');
  }
  if (bgParticles) {
    bgParticles.setReducedMotion(appSettings.animationIntensity === 'reduced');
    bgParticles.setAccentColor(appSettings.themeAccent);
  }
  document.documentElement.setAttribute('data-accent', appSettings.themeAccent);
  document.documentElement.setAttribute('data-reduced-motion', appSettings.animationIntensity === 'reduced' ? 'true' : 'false');

  await saveAppSettings(appSettings);
  await client.load();
  client.lastOk = 0;

  closeSheet('settings');
  toast('JARVIS Configuration Saved.', 'success');
  audio.playChime('complete');
  pingStatus();
};

$('btn-test').onclick = async () => {
  const out = $('test-result');
  const primary = clean($('set-url').value);
  const backup = clean($('set-url2').value);
  const testToken = $('set-token').value.trim();

  if (!primary && !backup) {
    out.textContent = 'Enter at least one Backend URL first.';
    return;
  }

  out.textContent = 'CHECKING... (probing /health & verifying App Token authentication)';

  try {
    const results = await client.testConnection(primary, backup, testToken);
    const lines = results.map((r) => {
      if (r.online) {
        const isOk = r.statusText.includes('VALID');
        const icon = isOk ? '✅' : r.statusText.includes('INVALID') ? '⚠️' : 'ℹ️';
        return `${icon} ${r.statusText} — ${r.name}\n   URL: ${r.url}\n   Storage: ${r.storage} | Models: ${r.providers}\n   Authentication: ${r.tokenStatus}`;
      } else {
        return `❌ ${r.statusText} — ${r.name}\n   URL: ${r.url}\n   Error: ${r.error}`;
      }
    });

    out.textContent = lines.join('\n\n');
  } catch (err) {
    out.textContent = 'CONNECTION ERROR: ' + (err.message || 'Test failed');
  }
};

// ----------------- Cinematic Intro Sequence -----------------
let introTimeout = null;
function playCinematicIntro(force = false) {
  const overlay = $('intro-overlay');
  if (!overlay) return;

  const alreadyPlayed = sessionStorage.getItem('jarvis_intro_played');
  if (!force && alreadyPlayed) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden', 'intro-dissolve');
  const fill = $('intro-progress-fill');
  const telemetry = $('intro-telemetry');
  if (fill) fill.style.width = '0%';

  // Fast high-tech sequence: total ~950ms
  const steps = [
    { t: 0, msg: 'INITIALIZING NEURAL CORE // STANDBY...', pct: '25%' },
    { t: 200, msg: 'CALIBRATING HOLOGRAPHIC GYROSCOPES...', pct: '60%' },
    { t: 450, msg: 'LINKING AUDIO SPECTRUM & SENSORS...', pct: '88%' },
    { t: 700, msg: 'SYSTEM NOMINAL // ALL SYSTEMS GO', pct: '100%' },
  ];

  steps.forEach(({ t, msg, pct }) => {
    setTimeout(() => {
      if (telemetry) telemetry.textContent = msg;
      if (fill) fill.style.width = pct;
    }, t);
  });

  const dismissIntro = () => {
    clearTimeout(introTimeout);
    overlay.classList.add('intro-dissolve');
    setTimeout(() => {
      overlay.classList.add('hidden');
    }, 200);
    sessionStorage.setItem('jarvis_intro_played', 'true');

    // Trigger staggered animation on dashboard action cards
    document.querySelectorAll('.actions-grid .action-card').forEach((card) => {
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = '';
    });
  };

  introTimeout = setTimeout(dismissIntro, 950);

  const skipBtn = $('intro-skip-btn');
  if (skipBtn) {
    skipBtn.onclick = (e) => {
      e.stopPropagation();
      dismissIntro();
    };
  }
  overlay.onclick = dismissIntro;
}

const btnReplay = $('btn-replay-intro');
if (btnReplay) {
  btnReplay.onclick = () => {
    closeSheet('settings');
    playCinematicIntro(true);
  };
}

const brandZone = $('brand-zone');
if (brandZone) {
  brandZone.onclick = () => {
    audio.playChime('click');
    if (visualizer) {
      visualizer.setState('PROCESSING');
      setTimeout(() => {
        if (visualizer && visualizer.state === 'PROCESSING') visualizer.setState('IDLE');
      }, 2000);
    }
  };
}

// ----------------- Assistant Selector -----------------
$('btn-change-assistant').onclick = () => openAssistantSelector();
$('btn-open-assistant-modal').onclick = () => {
  closeSheet('settings');
  openAssistantSelector();
};
$('btn-close-assistant').onclick = () => closeSheet('assistant-modal');

function openAssistantSelector() {
  openSheet('assistant-modal');
  const container = $('assistant-options-list');
  container.innerHTML = '';
  const assistants = ['JARVIS', 'Gemini', 'Groq', 'Mistral', 'OpenRouter', 'OpenAI', 'Claude', 'Copilot'];

  assistants.forEach((a) => {
    const stat = client.getProviderStatus(a);
    const card = el('div', `assistant-card ${appSettings.selectedAssistant === a ? 'selected' : ''}`);
    card.innerHTML = `
      <div>
        <div style="font-weight:700; color:var(--text);">${stat.name}</div>
        <div style="font-size:12px; color:var(--text-dim);">${stat.label}</div>
      </div>
      <div class="assistant-status-badge ${stat.status}">
        ${stat.status === 'active' ? 'ACTIVE' : stat.status === 'ready' ? 'AVAILABLE' : stat.status === 'server-config' ? 'SERVER KEY' : 'EXTERNAL'}
      </div>
    `;
    card.onclick = async () => {
      appSettings.selectedAssistant = a;
      await saveAppSettings(appSettings);
      $('active-assistant-name').textContent = a;
      $('settings-current-assistant-sub').textContent = a + ' Active';
      closeSheet('assistant-modal');
      toast(`Selected assistant: ${a}`, 'success');
      audio.playChime('click');
    };
    container.appendChild(card);
  });
}

// ----------------- Startup & Health Checks -----------------
async function pingStatus() {
  if (!client.bases.length) return;
  setConnectionState('', 'CHECKING');
  const r = await client.probe(6000);
  if (r) {
    setConnectionState('ok', 'CONNECTED');
    if (client.healthData) renderSettingsProviders();
  } else {
    setConnectionState('bad', 'OFFLINE');
  }
}

(async function init() {
  appSettings = await loadAppSettings();
  audio.soundEnabled = appSettings.soundEffects;

  document.documentElement.setAttribute('data-accent', appSettings.themeAccent);
  document.documentElement.setAttribute('data-reduced-motion', appSettings.animationIntensity === 'reduced' ? 'true' : 'false');

  const bgCanvas = $('bg-particles-canvas');
  if (bgCanvas) {
    bgParticles = new HolographicBackground(bgCanvas);
    bgParticles.setReducedMotion(appSettings.animationIntensity === 'reduced');
    bgParticles.setAccentColor(appSettings.themeAccent);
  }

  const canvas = $('hud-visualizer');
  if (canvas) {
    visualizer = new JarvisVisualizer(canvas);
    visualizer.setReducedMotion(appSettings.animationIntensity === 'reduced');
    visualizer.setAccentColor(
      appSettings.themeAccent === 'blue'
        ? '#38bdf8'
        : appSettings.themeAccent === 'emerald'
        ? '#10b981'
        : appSettings.themeAccent === 'amber'
        ? '#f59e0b'
        : '#00f0ff'
    );
  }

  await client.load();
  await loadSession();

  // Global unhandled error resilience
  window.addEventListener('error', (e) => {
    console.warn('[JARVIS runtime error caught]', e?.message || e);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.warn('[JARVIS unhandled rejection caught]', e?.reason || e);
  });

  // Android Hardware & Gesture Back Button Handling (Prevents accidental app closing)
  let lastBackPress = 0;
  function handleSafeBack() {
    // 0. If soft keyboard or active input is focused, blur it first to dismiss keyboard safely
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      document.activeElement.blur();
      return true;
    }

    // 1. Dismiss image zoom overlay if active
    const zoom = $('zoom');
    if (zoom && !zoom.classList.contains('hidden')) {
      zoom.classList.add('hidden');
      return true;
    }

    // 2. Dismiss cinematic intro overlay if active
    const intro = $('intro-overlay');
    if (intro && !intro.classList.contains('hidden')) {
      intro.classList.add('intro-dissolve');
      setTimeout(() => intro.classList.add('hidden'), 450);
      return true;
    }

    // 3. Close any open sheets or modals
    const openSheets = Array.from(document.querySelectorAll('.sheet:not(.hidden)'));
    if (openSheets.length > 0) {
      openSheets.forEach((s) => s.classList.add('hidden'));
      return true;
    }

    // 4. Stop speech or voice recognition if active
    if (isListening || audio.isSpeaking() || recognitionState !== RecognitionState.IDLE) {
      stopContinuousVoiceSession();
      return true;
    }

    // 5. If on Commands, Chat, or Files tab, navigate back to Home tab
    if (activeTab !== 'home') {
      switchTab('home');
      return true;
    }

    // 6. On Home tab: double back press within 2s to exit
    const now = Date.now();
    if (now - lastBackPress < 2000) {
      try {
        App.exitApp();
      } catch {
        // browser environment
      }
      return false;
    } else {
      lastBackPress = now;
      toast('Press back again to exit JARVIS.', 'info', 2000);
      return true;
    }
  }

  try {
    App.addListener('backButton', () => {
      handleSafeBack();
    });

    // App state changes (suspend background animations with permission dialog grace period)
    let appBackgroundTimer = null;
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        visualizer?.stop();
        bgParticles?.stop();
        // 3.5s grace period: prevents Android system permission dialogs from prematurely aborting speech recognition
        appBackgroundTimer = setTimeout(() => {
          if (isListening) {
            stopContinuousVoiceSession();
          } else {
            stopAndNullRecognition();
            if (audio.isSpeaking()) audio.stopSpeaking();
            setVoiceUIState('IDLE');
          }
        }, 3500);
      } else {
        if (appBackgroundTimer) {
          clearTimeout(appBackgroundTimer);
          appBackgroundTimer = null;
        }
        visualizer?.start();
        bgParticles?.start();
        if (client.configured) pingStatus();
      }
    });
  } catch (err) {
    console.warn('[Capacitor App listeners not available]', err);
  }

  // Web popstate trap to prevent accidental browser back exits
  try {
    window.history.pushState({ page: 'jarvis' }, '');
    window.addEventListener('popstate', () => {
      window.history.pushState({ page: 'jarvis' }, '');
      handleSafeBack();
    });
  } catch {
    // ignore
  }

  playCinematicIntro(false);

  if (!client.configured) {
    openSettingsSheet('advanced');
  } else {
    pingStatus();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && client.configured) pingStatus();
  });
})();
