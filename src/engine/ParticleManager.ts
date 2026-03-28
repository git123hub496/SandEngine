
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  type: 'spark' | 'bubble' | 'smoke';
}

export class ParticleManager {
  private particles: Particle[] = [];
  private maxParticles = 200;

  constructor() {}

  addParticle(x: number, y: number, type: 'spark' | 'bubble' | 'smoke', color?: string) {
    if (this.particles.length >= this.maxParticles) return;

    const particle: Particle = {
      x,
      y,
      vx: (Math.random() - 0.5) * 1.5,
      vy: type === 'spark' ? (Math.random() - 1) * 2 : (Math.random() - 0.5) * -1,
      life: 0,
      maxLife: 20 + Math.random() * 30,
      color: color || (type === 'spark' ? '#ffaa00' : type === 'bubble' ? '#ffffff' : '#888888'),
      size: type === 'bubble' ? 1 + Math.random() * 2 : 1,
      type
    };

    this.particles.push(particle);
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      
      if (p.type === 'spark') {
        p.vy += 0.05; // Gravity for sparks
      } else {
        p.vy -= 0.02; // Buoyancy for bubbles/smoke
      }

      p.life++;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, cellSize: number) {
    ctx.save();
    for (const p of this.particles) {
      const alpha = 1 - (p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      
      if (p.type === 'bubble') {
        ctx.beginPath();
        ctx.arc(p.x * cellSize, p.y * cellSize, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(
          Math.floor(p.x) * cellSize, 
          Math.floor(p.y) * cellSize, 
          cellSize * p.size, 
          cellSize * p.size
        );
      }
    }
    ctx.restore();
  }

  clear() {
    this.particles = [];
  }
}

export const particleManager = new ParticleManager();
