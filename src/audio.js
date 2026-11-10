// Audio, Native Speech Recognition, and Speech Synthesis module for JARVIS
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export function formatVoiceError(err) {
  const msg = String(err?.message || err?.error || err || '').toLowerCase();
  if (msg.includes('permission') || msg.includes('not-allowed') || msg.includes('denied') || msg.includes('missing_permission')) {
    return {
      type: 'permission_denied',
      userMessage: 'Microphone permission was denied. Please allow microphone access in Android Settings > Apps > JARVIS > Permissions.',
      suggestChat: true,
    };
  }
  if (msg.includes('not_available') || msg.includes('unavailable') || msg.includes('no speech recognizer') || msg.includes('no_match')) {
    return {
      type: 'unavailable',
      userMessage: 'Speech recognition service is unavailable on this device. You can type directly in Chat.',
      suggestChat: true,
    };
  }
  if (msg.includes('no-speech') || msg.includes('speech_timeout')) {
    return {
      type: 'no_speech',
      userMessage: 'No speech was detected. Tap the microphone and speak clearly.',
      suggestChat: false,
    };
  }
  if (msg.includes('network')) {
    return {
      type: 'network',
      userMessage: 'Speech recognition requires an active network connection. Please check your internet.',
      suggestChat: true,
    };
  }
  if (msg.includes('busy') || msg.includes('already_started')) {
    return {
      type: 'busy',
      userMessage: 'Voice recognition service is currently busy. Please tap again.',
      suggestChat: false,
    };
  }
  if (msg.includes('cancel') || msg.includes('abort')) {
    return {
      type: 'cancelled',
      userMessage: '',
      suggestChat: false,
    };
  }
  return {
    type: 'unknown',
    userMessage: 'Voice input error: ' + (err?.message || err || 'Recognition interrupted'),
    suggestChat: true,
  };
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.soundEnabled = true;
    this.unlocked = false;
    this.isRecognizing = false;
    this.lastTranscript = '';
    this.simulatedEnergy = 0;
    this.nativeListeners = [];

    // Web Speech Recognition Fallback (for browser preview)
    const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
    this.webRecSupported = !!SpeechRec;
    this.webRecognition = null;
    if (this.webRecSupported) {
      try {
        this.webRecognition = new SpeechRec();
        this.webRecognition.continuous = false;
        this.webRecognition.interimResults = true;
        this.webRecognition.lang = 'en-US';
      } catch {
        this.webRecognition = null;
      }
    }

    // Speech Synthesis
    this.synth = typeof window !== 'undefined' ? (window.speechSynthesis || null) : null;
    this.voices = [];
    if (this.synth) {
      this.loadVoices();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.loadVoices();
      }
    }

    // Auto-unlock AudioContext on first user interaction
    const unlock = () => {
      this.unlocked = true;
      this.initAudioContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  get recSupported() {
    if (Capacitor.isNativePlatform()) return true;
    return this.webRecSupported;
  }

  initAudioContext() {
    try {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended' && this.unlocked) {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
    } catch {
      // Autoplay policy or unsupported
    }
  }

  loadVoices() {
    if (!this.synth) return [];
    try {
      this.voices = this.synth.getVoices() || [];
    } catch {
      this.voices = [];
    }
    return this.voices;
  }

  getVoices() {
    if (!this.voices.length && this.synth) {
      this.voices = this.synth.getVoices() || [];
    }
    return this.voices;
  }

  // ----------------- Sci-Fi Sound Synthesizer -----------------
  playChime(type) {
    if (!this.soundEnabled) return;
    try {
      this.initAudioContext();
      if (!this.ctx || this.ctx.state === 'suspended') return;

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (type === 'startup') {
        const oscSub = this.ctx.createOscillator();
        const gainSub = this.ctx.createGain();
        oscSub.type = 'sine';
        oscSub.frequency.setValueAtTime(140, t);
        oscSub.frequency.exponentialRampToValueAtTime(520, t + 0.4);
        gainSub.gain.setValueAtTime(0.001, t);
        gainSub.gain.linearRampToValueAtTime(0.06, t + 0.15);
        gainSub.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        oscSub.connect(gainSub);
        gainSub.connect(this.ctx.destination);
        oscSub.start(t);
        oscSub.stop(t + 0.48);

        [659.25, 987.77, 1318.5].forEach((f, idx) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'sine';
          const startT = t + 0.3 + idx * 0.09;
          o.frequency.setValueAtTime(f, startT);
          g.gain.setValueAtTime(0.04, startT);
          g.gain.exponentialRampToValueAtTime(0.001, startT + 0.3);
          o.connect(g);
          g.connect(this.ctx.destination);
          o.start(startT);
          o.stop(startT + 0.35);
        });
        return;
      } else if (type === 'processing') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, t);
        osc.frequency.exponentialRampToValueAtTime(780, t + 0.06);
        gain.gain.setValueAtTime(0.03, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        osc.start(t);
        osc.stop(t + 0.08);
      } else if (type === 'start') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.start(t);
        osc.stop(t + 0.15);
      } else if (type === 'complete') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, t);
        osc.frequency.setValueAtTime(987.77, t + 0.08);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.26);
      } else if (type === 'alert') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.2);
        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.start(t);
        osc.stop(t + 0.23);
      } else if (type === 'timer') {
        const freqs = [523.25, 659.25, 783.99, 1046.5];
        freqs.forEach((freq, idx) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t + idx * 0.12);
          g.gain.setValueAtTime(0.1, t + idx * 0.12);
          g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.12 + 0.35);
          o.connect(g);
          g.connect(this.ctx.destination);
          o.start(t + idx * 0.12);
          o.stop(t + idx * 0.12 + 0.4);
        });
      } else if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, t);
        gain.gain.setValueAtTime(0.04, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        osc.start(t);
        osc.stop(t + 0.05);
      }
    } catch {
      // AudioContext policy or unsupported
    }
  }

  // ----------------- Visualizer Audio Energy Modulation -----------------
  // Prevents opening a conflicting concurrent getUserMedia() session on Android.
  // Generates an organic, responsive energy waveform for the visualizer.
  getMicEnergy() {
    if (!this.isRecognizing) return 0;
    const now = Date.now();
    const baseWave = 0.22 + Math.sin(now * 0.009) * 0.12 + Math.cos(now * 0.017) * 0.08;
    const speechBonus = this.lastTranscript ? 0.35 : 0;
    return Math.max(0.1, Math.min(1.0, baseWave + speechBonus));
  }

  // ----------------- Native & Web Speech Recognition -----------------
  async checkPermissions() {
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await SpeechRecognition.checkPermissions();
        return status.speechRecognition === 'granted';
      } catch {
        return false;
      }
    }
    return true; // Web browsers manage permission during start()
  }

  async requestPermissions() {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await SpeechRecognition.requestPermissions();
        return res.speechRecognition === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  async startRecognition({ onStart, onResult, onError, onEnd }) {
    if (this.isRecognizing) {
      await this.stopRecognition();
    }

    this.isRecognizing = true;
    this.lastTranscript = '';
    this.playChime('start');

    // 1. NATIVE ANDROID SPEECH RECOGNITION
    if (Capacitor.isNativePlatform()) {
      try {
        // Verify native availability
        const { available } = await SpeechRecognition.available();
        if (!available) {
          throw new Error('not_available: Android Speech Recognition is not available on this device');
        }

        // Check & request runtime permissions
        let granted = await this.checkPermissions();
        if (!granted) {
          granted = await this.requestPermissions();
        }
        if (!granted) {
          throw new Error('permission_denied: Microphone permission denied');
        }

        // Clean up any stale listeners
        await this.clearNativeListeners();

        // Register partial result listener
        const pSub = await SpeechRecognition.addListener('partialResults', (data) => {
          const match = data?.matches?.[0] || '';
          if (match) {
            this.lastTranscript = match;
            onResult?.(match, false);
          }
        });
        this.nativeListeners.push(pSub);

        // Register listening state listener
        const sSub = await SpeechRecognition.addListener('listeningState', (data) => {
          if (data.status === 'stopped' && this.isRecognizing) {
            // Stopped by native recognizer
          }
        });
        this.nativeListeners.push(sSub);

        onStart?.();

        // Start recognition session
        const result = await SpeechRecognition.start({
          language: 'en-US',
          maxResults: 3,
          prompt: 'Speak to JARVIS...',
          partialResults: true,
          popup: false,
        });

        const finalMatch = (result?.matches && result.matches[0]) || this.lastTranscript;
        this.isRecognizing = false;
        await this.clearNativeListeners();
        onResult?.(finalMatch, true);
        onEnd?.(finalMatch);
      } catch (err) {
        this.isRecognizing = false;
        await this.clearNativeListeners();
        onError?.(err);
      }
      return;
    }

    // 2. WEB BROWSER FALLBACK (for development & desktop preview)
    if (!this.webRecSupported || !this.webRecognition) {
      this.isRecognizing = false;
      onError?.(new Error('Speech recognition is not supported in this browser environment.'));
      return;
    }

    try {
      let fullTranscript = '';

      this.webRecognition.onstart = () => {
        this.isRecognizing = true;
        onStart?.();
      };

      this.webRecognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            fullTranscript += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const current = fullTranscript || interim;
        this.lastTranscript = current;
        onResult?.(current, !!fullTranscript);
      };

      this.webRecognition.onerror = (err) => {
        this.isRecognizing = false;
        onError?.(err);
      };

      this.webRecognition.onend = () => {
        this.isRecognizing = false;
        onEnd?.(fullTranscript || this.lastTranscript);
      };

      this.webRecognition.start();
    } catch (err) {
      this.isRecognizing = false;
      onError?.(err);
    }
  }

  async clearNativeListeners() {
    for (const sub of this.nativeListeners) {
      try {
        await sub.remove();
      } catch {
        // ignore
      }
    }
    this.nativeListeners = [];
    try {
      await SpeechRecognition.removeAllListeners();
    } catch {
      // ignore
    }
  }

  async stopRecognition() {
    this.isRecognizing = false;
    if (Capacitor.isNativePlatform()) {
      try {
        await SpeechRecognition.stop();
      } catch {
        // ignore
      }
      await this.clearNativeListeners();
    } else if (this.webRecognition) {
      try {
        this.webRecognition.stop();
      } catch {
        // ignore
      }
    }
  }

  // ----------------- Speech Synthesis (TTS) -----------------
  speak(text, { voiceName = '', rate = 1.0, pitch = 1.0, onStart, onEnd, onError } = {}) {
    if (!this.synth) return;
    try {
      this.synth.cancel();

      const cleanText = text
        .replace(/```[\s\S]*?```/g, 'Code block omitted.')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/#{1,6}\s+/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .slice(0, 1000);

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = Math.max(0.6, Math.min(2.0, rate));
      utterance.pitch = Math.max(0.5, Math.min(1.5, pitch));

      const voices = this.getVoices();
      if (voiceName) {
        const match = voices.find((v) => v.name === voiceName);
        if (match) utterance.voice = match;
      } else {
        const best = voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('UK') ||
              v.name.includes('Natural') ||
              v.name.includes('Google') ||
              v.name.includes('Samantha') ||
              v.name.includes('Male'))
        );
        if (best) utterance.voice = best;
      }

      utterance.onstart = () => onStart?.();
      utterance.onend = () => onEnd?.();
      utterance.onerror = (e) => onError?.(e);

      this.synth.speak(utterance);
    } catch (e) {
      onError?.(e);
    }
  }

  stopSpeaking() {
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch {
        // ignore
      }
    }
  }

  isSpeaking() {
    return !!(this.synth && this.synth.speaking);
  }
}

export const audio = new AudioEngine();
