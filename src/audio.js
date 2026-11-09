// Audio, Speech Recognition, and Speech Synthesis module for JARVIS

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.micStream = null;
    this.analyser = null;
    this.dataArray = null;
    this.soundEnabled = true;

    // Speech Recognition
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recSupported = !!SpeechRec;
    this.recognition = SpeechRec ? new SpeechRec() : null;
    if (this.recognition) {
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
    }

    // Speech Synthesis
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    if (this.synth) {
      this.loadVoices();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.loadVoices();
      }
    }
  }

  initAudioContext() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  loadVoices() {
    if (!this.synth) return [];
    this.voices = this.synth.getVoices() || [];
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
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (type === 'startup') {
        // High-tech ascending cyber boot sequence: sub sweep + dual chime harmonics
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
        // Ascending high-tech chirp
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.start(t);
        osc.stop(t + 0.15);
      } else if (type === 'complete') {
        // Futuristic two-tone confirmation
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, t); // E5
        osc.frequency.setValueAtTime(987.77, t + 0.08); // B5
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.26);
      } else if (type === 'alert') {
        // Low sci-fi error pulse
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.2);
        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.start(t);
        osc.stop(t + 0.23);
      } else if (type === 'timer') {
        // Melodic triple chime
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
        // Micro HUD tactile click
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

  // ----------------- Real Microphone Spectrum Analyzer -----------------
  async startMicAnalyzer() {
    try {
      this.initAudioContext();
      if (!this.ctx) return null;
      if (!navigator.mediaDevices?.getUserMedia) return null;

      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.ctx.createMediaStreamSource(this.micStream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      return this.analyser;
    } catch {
      return null;
    }
  }

  getMicEnergy() {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    return sum / (this.dataArray.length * 255); // 0.0 to 1.0
  }

  stopMicAnalyzer() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    this.analyser = null;
    this.dataArray = null;
  }

  // ----------------- Speech Recognition -----------------
  startRecognition({ onStart, onResult, onError, onEnd }) {
    if (!this.recSupported || !this.recognition) {
      onError?.(new Error('Speech recognition is not supported in this environment.'));
      return;
    }

    this.playChime('start');
    this.startMicAnalyzer();

    let recognizedText = '';

    this.recognition.onstart = () => {
      onStart?.();
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          recognizedText += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      onResult?.(recognizedText || interim, !!recognizedText);
    };

    this.recognition.onerror = (err) => {
      this.stopMicAnalyzer();
      onError?.(err);
    };

    this.recognition.onend = () => {
      this.stopMicAnalyzer();
      onEnd?.(recognizedText);
    };

    try {
      this.recognition.start();
    } catch {
      // already started or busy
    }
  }

  stopRecognition() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.stopMicAnalyzer();
  }

  // ----------------- Speech Synthesis -----------------
  speak(text, { voiceName = '', rate = 1.0, pitch = 1.0, onStart, onEnd, onError } = {}) {
    if (!this.synth) return;
    this.synth.cancel(); // cancel any active speech

    // Clean text of markdown artifacts for natural reading
    const cleanText = text
      .replace(/```[\s\S]*?```/g, 'Code block omitted.')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .slice(0, 1000); // reasonable speech chunk length

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = Math.max(0.6, Math.min(2.0, rate));
    utterance.pitch = Math.max(0.5, Math.min(1.5, pitch));

    const voices = this.getVoices();
    if (voiceName) {
      const match = voices.find((v) => v.name === voiceName);
      if (match) utterance.voice = match;
    } else {
      // Pick best English voice if available (e.g. Google or British/US)
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
  }

  stopSpeaking() {
    if (this.synth) {
      this.synth.cancel();
    }
  }

  isSpeaking() {
    return !!(this.synth && this.synth.speaking);
  }
}

export const audio = new AudioEngine();
