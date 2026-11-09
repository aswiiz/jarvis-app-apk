// Advanced Holographic HUD Visualizer for JARVIS
import { audio } from './audio.js';

export class JarvisVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'IDLE'; // 'IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'PROCESSING', 'ERROR'
    this.animId = null;
    this.lastTime = performance.now();

    // Independent Gyroscopic Rotations
    this.angleOuter = 0;
    this.angleMid = 0;
    this.angleInner = 0;
    this.angleTelemetry = 0;
    this.radarAngle = 0;

    // Phases
    this.pulsePhase = 0;
    this.wavePhase = 0;
    this.energyRipples = []; // [{ r, alpha, speed }]
    this.orbitSatellites = [
      { angle: 0, speed: 1.4, radiusMul: 0.96, size: 2.5 },
      { angle: Math.PI, speed: -1.8, radiusMul: 0.84, size: 2.0 },
      { angle: Math.PI * 0.5, speed: 2.2, radiusMul: 0.72, size: 1.8 },
    ];
    this.sparkParticles = []; // [{ x, y, vx, vy, life, maxLife, size }]

    this.reducedMotion = false;
    this.active = true;
    this.accentColor = '#00f0ff'; // Cyan default
    this.rippleTimer = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stop();
      } else {
        this.start();
      }
    });

    this.start();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(260, Math.min(rect.width || 300, 360));
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.scale(dpr, dpr);
    this.displaySize = size;
  }

  setState(newState) {
    this.state = newState.toUpperCase();
    if (this.state === 'ERROR') {
      this.glitchOffset = 6;
    }
  }

  setAccentColor(color) {
    this.accentColor = color;
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
  }

  start() {
    if (this.animId) return;
    this.active = true;
    this.lastTime = performance.now();
    const loop = (now) => {
      this.render(now);
      if (this.active) {
        this.animId = requestAnimationFrame(loop);
      }
    };
    this.animId = requestAnimationFrame(loop);
  }

  stop() {
    this.active = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  getColorTheme() {
    switch (this.state) {
      case 'LISTENING':
        return {
          primary: '#00f0ff',
          secondary: '#38bdf8',
          glow: 'rgba(0, 240, 255, 0.45)',
          core: '#e0faff',
          radar: 'rgba(0, 240, 255, 0.12)',
        };
      case 'THINKING':
      case 'PROCESSING':
        return {
          primary: '#38bdf8',
          secondary: '#818cf8',
          glow: 'rgba(56, 189, 248, 0.4)',
          core: '#c7d2fe',
          radar: 'rgba(56, 189, 248, 0.18)',
        };
      case 'SPEAKING':
        return {
          primary: '#22d3ee',
          secondary: '#00f0ff',
          glow: 'rgba(34, 211, 238, 0.5)',
          core: '#ffffff',
          radar: 'rgba(34, 211, 238, 0.15)',
        };
      case 'ERROR':
        return {
          primary: '#ef4444',
          secondary: '#f87171',
          glow: 'rgba(239, 68, 68, 0.4)',
          core: '#fee2e2',
          radar: 'rgba(239, 68, 68, 0.15)',
        };
      case 'IDLE':
      default:
        return {
          primary: this.accentColor,
          secondary: '#38bdf8',
          glow: 'rgba(0, 240, 255, 0.25)',
          core: '#f1f5f9',
          radar: 'rgba(0, 240, 255, 0.08)',
        };
    }
  }

  addSparks(cx, cy, count = 2) {
    if (this.reducedMotion || this.sparkParticles.length > 25) return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 25 + 10;
      this.sparkParticles.push({
        x: cx + Math.cos(angle) * 35,
        y: cy + Math.sin(angle) * 35,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: Math.random() * 0.8 + 0.5,
        size: Math.random() * 1.6 + 0.8,
      });
    }
  }

  render(now) {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const ctx = this.ctx;
    const size = this.displaySize;
    if (!ctx || !size) return;

    ctx.clearRect(0, 0, size, size);

    let cx = size / 2;
    let cy = size / 2;
    const r = size * 0.42;

    // Glitch jitter in ERROR state
    if (this.state === 'ERROR' && Math.random() > 0.6) {
      cx += (Math.random() - 0.5) * 4;
      cy += (Math.random() - 0.5) * 4;
    }

    const speedMul = this.reducedMotion ? 0.2 : 1;
    let baseSpeed = 0.5;
    if (this.state === 'THINKING' || this.state === 'PROCESSING') baseSpeed = 2.6;
    else if (this.state === 'LISTENING') baseSpeed = 1.4;
    else if (this.state === 'SPEAKING') baseSpeed = 1.6;

    this.angleOuter += dt * baseSpeed * speedMul;
    this.angleMid -= dt * (baseSpeed * 0.75) * speedMul;
    this.angleInner += dt * (baseSpeed * 1.2) * speedMul;
    this.angleTelemetry -= dt * (baseSpeed * 0.4) * speedMul;
    this.radarAngle += dt * (baseSpeed * 1.8) * speedMul;

    this.pulsePhase += dt * (this.state === 'LISTENING' ? 4.5 : 2) * speedMul;
    this.wavePhase += dt * 6.5 * speedMul;

    const colors = this.getColorTheme();

    // 1. Ambient Radial Breathing Glow
    const pulseScale = 1 + Math.sin(this.pulsePhase) * (this.state === 'LISTENING' ? 0.08 : 0.03);
    const radGlow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.15 * pulseScale);
    radGlow.addColorStop(0, 'rgba(12, 17, 29, 0)');
    radGlow.addColorStop(0.7, colors.glow.replace(/[\d\.]+\)$/, '0.09)'));
    radGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.15 * pulseScale, 0, Math.PI * 2);
    ctx.fill();

    // 2. Pulsating Energy Ripples (expanding outwards)
    this.rippleTimer += dt;
    if (this.rippleTimer > (this.state === 'LISTENING' ? 0.7 : this.state === 'SPEAKING' ? 0.9 : 1.8)) {
      this.rippleTimer = 0;
      this.energyRipples.push({ r: r * 0.48, alpha: 0.7, speed: r * 0.55 });
    }

    ctx.save();
    for (let i = this.energyRipples.length - 1; i >= 0; i--) {
      const rip = this.energyRipples[i];
      rip.r += rip.speed * dt * speedMul;
      rip.alpha -= dt * 0.75;
      if (rip.alpha <= 0 || rip.r > r * 1.1) {
        this.energyRipples.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = colors.primary;
      ctx.globalAlpha = rip.alpha * 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rip.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Radar Sweep Line (active in THINKING, PROCESSING, LISTENING, or subtle in IDLE)
    if (!this.reducedMotion) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.radarAngle);
      const sweepGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      sweepGrad.addColorStop(0, 'rgba(0, 240, 255, 0)');
      sweepGrad.addColorStop(0.8, colors.radar);
      sweepGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = sweepGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, 0, 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 4. Outermost Gyroscopic Segmented Ring (Clockwise)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angleOuter);
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = colors.primary;
    ctx.shadowBlur = this.state === 'LISTENING' || this.state === 'SPEAKING' ? 9 : 4;

    const segments = 4;
    const segAngle = (Math.PI * 2) / segments;
    const gap = 0.26;
    for (let i = 0; i < segments; i++) {
      const start = i * segAngle + gap / 2;
      const end = (i + 1) * segAngle - gap / 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, start, end);
      ctx.stroke();

      // Corner accent holographic nodes
      const cornerX = Math.cos(start) * r;
      const cornerY = Math.sin(start) * r;
      ctx.fillStyle = colors.primary;
      ctx.beginPath();
      ctx.arc(cornerX, cornerY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer Telemetry Ticks (24 ticks with major/minor scales)
    const numTicks = 24;
    ctx.strokeStyle = colors.secondary;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < numTicks; i++) {
      const a = (i / numTicks) * Math.PI * 2;
      const x1 = Math.cos(a) * (r + 2);
      const y1 = Math.sin(a) * (r + 2);
      const len = i % 6 === 0 ? 8 : 4.5;
      const x2 = Math.cos(a) * (r + 2 + len);
      const y2 = Math.sin(a) * (r + 2 + len);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    // 5. Middle Gyroscopic Ring (Counter-Clockwise Dashed + Segmented Arcs)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angleMid);
    ctx.setLineDash([5, 8]);
    ctx.strokeStyle = colors.secondary;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.83, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]); // reset dash

    // Minor decorative arc brackets
    for (let i = 0; i < 2; i++) {
      const bStart = (i * Math.PI) + 0.3;
      const bEnd = (i * Math.PI) + 0.9;
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.83, bStart, bEnd);
      ctx.stroke();
    }
    ctx.restore();

    // 6. Third Inner Gyroscopic Ring with 3 Glowing Bracket Arcs
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angleInner);
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 3; i++) {
      const aStart = (i * Math.PI * 2) / 3 + 0.16;
      const aEnd = aStart + (Math.PI * 2) / 3 - 0.32;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.68, aStart, aEnd);
      ctx.stroke();
    }
    ctx.restore();

    // 7. Orbiting Light Satellites / Nodes
    ctx.save();
    ctx.translate(cx, cy);
    this.orbitSatellites.forEach((sat) => {
      sat.angle += dt * sat.speed * speedMul;
      const satR = r * sat.radiusMul;
      const sx = Math.cos(sat.angle) * satR;
      const sy = Math.sin(sat.angle) * satR;

      ctx.fillStyle = colors.core;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(sx, sy, sat.size, 0, Math.PI * 2);
      ctx.fill();

      // Satellite faint motion trail
      ctx.strokeStyle = colors.primary;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, satR, sat.angle - (sat.speed > 0 ? 0.35 : -0.35), sat.angle);
      ctx.stroke();
    });
    ctx.restore();

    // 8. Central Reactive Waveform / Energy Core
    const micLevel = this.state === 'LISTENING' ? audio.getMicEnergy() : 0;
    const waveR = r * 0.48;

    ctx.save();
    ctx.translate(cx, cy);

    // Deep Obsidian Glass Core
    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, waveR);
    coreGrad.addColorStop(0, 'rgba(10, 15, 26, 0.96)');
    coreGrad.addColorStop(0.8, 'rgba(14, 20, 36, 0.88)');
    coreGrad.addColorStop(1, 'rgba(0, 240, 255, 0.18)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, waveR, 0, Math.PI * 2);
    ctx.fill();

    // Concentric inner boundary circle
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, waveR, 0, Math.PI * 2);
    ctx.stroke();

    // Waveform frequency bars
    const numBars = 16;
    const barWidth = 2.6;
    ctx.fillStyle = colors.primary;
    ctx.shadowColor = colors.primary;
    ctx.shadowBlur = 6;
    ctx.globalAlpha = 1;

    const baseH = this.state === 'LISTENING' ? 10 + micLevel * 48 : this.state === 'SPEAKING' ? 24 : this.state === 'THINKING' ? 15 : 8;

    for (let i = 0; i < numBars; i++) {
      const x = (i - numBars / 2 + 0.5) * (barWidth + 3.4);
      const distFromCenter = 1 - Math.abs(i - (numBars - 1) / 2) / ((numBars - 1) / 2);

      let h = baseH * (0.3 + distFromCenter * 0.7);
      if (this.state === 'SPEAKING') {
        h += Math.sin(this.wavePhase + i * 0.65) * 14 * distFromCenter;
      } else if (this.state === 'LISTENING') {
        h += Math.sin(this.wavePhase * 1.5 + i * 0.5) * (micLevel * 28 + 5);
      } else if (this.state === 'THINKING' || this.state === 'PROCESSING') {
        h = 6 + Math.abs(Math.sin(this.wavePhase * 2 + i * 0.4)) * 18 * distFromCenter;
      } else {
        // Idle organic breathing wave
        h += Math.sin(this.pulsePhase * 2 + i * 0.3) * 2.2;
      }
      h = Math.max(3, Math.min(h, waveR * 0.82));

      ctx.beginPath();
      ctx.roundRect(x - barWidth / 2, -h / 2, barWidth, h, 2);
      ctx.fill();
    }

    // 9. Floating Holographic Sparks
    if (this.state === 'THINKING' || this.state === 'LISTENING' || this.state === 'SPEAKING') {
      this.addSparks(0, 0, 1);
    }

    for (let i = this.sparkParticles.length - 1; i >= 0; i--) {
      const sp = this.sparkParticles[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.life += dt;
      if (sp.life >= sp.maxLife) {
        this.sparkParticles.splice(i, 1);
        continue;
      }
      const sparkAlpha = (1 - sp.life / sp.maxLife) * 0.7;
      ctx.fillStyle = colors.core;
      ctx.globalAlpha = sparkAlpha;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 10. Center Branding & Status Readout
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1;

    // Top status indicator text
    ctx.font = '600 10px "Rajdhani", system-ui, sans-serif';
    ctx.fillStyle = colors.secondary;
    ctx.letterSpacing = '2px';
    ctx.fillText(this.state, 0, -waveR * 0.55);

    // Center JARVIS Wordmark
    ctx.font = '700 15px "Rajdhani", system-ui, sans-serif';
    ctx.fillStyle = colors.core;
    ctx.shadowColor = colors.primary;
    ctx.shadowBlur = 8;
    ctx.letterSpacing = '3px';
    ctx.fillText('JARVIS', 0, waveR * 0.58);

    ctx.restore();
  }
}
