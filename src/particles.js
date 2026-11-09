// Lightweight, High-Performance Holographic Particle Background for JARVIS

export class HolographicBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.numParticles = 38;
    this.animId = null;
    this.active = true;
    this.reducedMotion = false;
    this.accentColor = 'rgba(0, 240, 255, ';
    this.lastTime = performance.now();
    this.sweepPhase = 0;
    this.mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000 };

    this.resize();
    this.initParticles();

    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      const curW = window.innerWidth;
      this.resize();
      if (Math.abs(curW - lastW) > 50) {
        lastW = curW;
        this.initParticles();
      }
    });

    const handlePointer = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = clientX - rect.left;
      this.mouse.y = clientY - rect.top;
    };

    window.addEventListener('mousemove', handlePointer, { passive: true });
    window.addEventListener('touchmove', handlePointer, { passive: true });
    window.addEventListener('mouseleave', () => {
      this.mouse.x = -1000;
      this.mouse.y = -1000;
    });

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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = w;
    this.height = h;

    // Scale particle count based on screen size
    this.numParticles = Math.min(45, Math.max(20, Math.floor((w * h) / 25000)));
  }

  setAccentColor(color) {
    if (color === 'blue') this.accentColor = 'rgba(56, 189, 248, ';
    else if (color === 'emerald') this.accentColor = 'rgba(16, 185, 129, ';
    else if (color === 'amber') this.accentColor = 'rgba(245, 158, 11, ';
    else this.accentColor = 'rgba(0, 240, 255, ';
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
  }

  initParticles() {
    this.particles = [];
    const count = this.reducedMotion ? 12 : this.numParticles;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        radius: Math.random() * 1.8 + 0.8,
        depth: Math.random() * 0.7 + 0.3, // 0.3 to 1.0 depth factor
        alpha: Math.random() * 0.45 + 0.15,
        pulseSpeed: Math.random() * 1.5 + 0.5,
        phase: Math.random() * Math.PI * 2,
        isHex: i % 8 === 0, // occasional subtle geometric hexagon
      });
    }
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

  render(now) {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (!ctx || !w || !h) return;

    ctx.clearRect(0, 0, w, h);

    if (this.reducedMotion) {
      // Draw static soft star points
      this.particles.forEach((p) => {
        ctx.fillStyle = `${this.accentColor}${p.alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    this.sweepPhase += dt * 0.15;

    // 1. Subtle Occasional Holographic Light Sweep
    const sweepY = ((this.sweepPhase % 3) / 3) * (h + 200) - 100;
    const sweepGrad = ctx.createLinearGradient(0, sweepY - 40, 0, sweepY + 40);
    sweepGrad.addColorStop(0, 'rgba(0, 240, 255, 0)');
    sweepGrad.addColorStop(0.5, 'rgba(0, 240, 255, 0.025)');
    sweepGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = sweepGrad;
    ctx.fillRect(0, sweepY - 40, w, 80);

    // 2. Update and Draw Particles
    const mouseRadius = 120;
    const maxLinkDist = 85;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Subtle mouse gentle repulsion
      const dx = p.x - this.mouse.x;
      const dy = p.y - this.mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mouseRadius && dist > 0) {
        const force = (1 - dist / mouseRadius) * 0.8;
        p.x += (dx / dist) * force;
        p.y += (dy / dist) * force;
      }

      // Movement
      p.x += p.vx * p.depth * (dt * 60);
      p.y += p.vy * p.depth * (dt * 60);

      // Screen wrapping
      if (p.x < -10) p.x = w + 10;
      else if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      else if (p.y > h + 10) p.y = -10;

      // Pulse alpha
      p.phase += dt * p.pulseSpeed;
      const currentAlpha = p.alpha * (0.7 + Math.sin(p.phase) * 0.3) * p.depth;

      // Draw particle or geometric node
      if (p.isHex) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.phase * 0.2);
        ctx.strokeStyle = `${this.accentColor}${currentAlpha * 0.7})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const hexR = p.radius * 3.5;
        for (let a = 0; a < 6; a++) {
          const angle = (a * Math.PI) / 3;
          const hx = Math.cos(angle) * hexR;
          const hy = Math.sin(angle) * hexR;
          if (a === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = `${this.accentColor}${currentAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * p.depth, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Connect close nodes with thin holographic lines
      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const ndx = p.x - p2.x;
        const ndy = p.y - p2.y;
        const nDist = Math.sqrt(ndx * ndx + ndy * ndy);

        if (nDist < maxLinkDist) {
          const lineAlpha = (1 - nDist / maxLinkDist) * 0.12 * p.depth * p2.depth;
          ctx.strokeStyle = `${this.accentColor}${lineAlpha})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
  }
}
