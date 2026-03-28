
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private fireGain: GainNode | null = null;
  private liquidGain: GainNode | null = null;
  private solidGain: GainNode | null = null;
  private initialized = false;

  constructor() {}

  init() {
    if (this.initialized) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.15; // Low overall volume
    this.masterGain.connect(this.ctx.destination);

    this.setupFire();
    this.setupLiquid();
    this.setupSolid();
    this.initialized = true;
  }

  private setupFire() {
    if (!this.ctx || !this.masterGain) return;
    this.fireGain = this.ctx.createGain();
    this.fireGain.gain.value = 0;
    this.fireGain.connect(this.masterGain);

    // Crackle sound (Noise with random spikes)
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 1;

    noise.connect(filter);
    filter.connect(this.fireGain);
    noise.start();
  }

  private setupLiquid() {
    if (!this.ctx || !this.masterGain) return;
    this.liquidGain = this.ctx.createGain();
    this.liquidGain.gain.value = 0;
    this.liquidGain.connect(this.masterGain);

    // Bubbling sound (Sine waves with frequency modulation)
    const createBubble = () => {
      if (!this.ctx || !this.liquidGain || this.liquidGain.gain.value === 0) {
        setTimeout(createBubble, 100 + Math.random() * 500);
        return;
      }

      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400 + Math.random() * 600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100 + Math.random() * 100, this.ctx.currentTime + 0.1);

      g.gain.setValueAtTime(0, this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.2, this.ctx.currentTime + 0.01);
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);

      osc.connect(g);
      g.connect(this.liquidGain);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.1);

      setTimeout(createBubble, 50 + Math.random() * 200);
    };

    createBubble();
  }

  private setupSolid() {
    if (!this.ctx || !this.masterGain) return;
    this.solidGain = this.ctx.createGain();
    this.solidGain.gain.value = 0;
    this.solidGain.connect(this.masterGain);

    // Crumbling sound (Low frequency noise)
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;

    noise.connect(filter);
    filter.connect(this.solidGain);
    noise.start();
  }

  updateVolumes(fireCount: number, liquidCount: number, solidCount: number) {
    if (!this.initialized || !this.ctx) return;

    const targetFire = Math.min(0.5, fireCount / 500);
    const targetLiquid = Math.min(0.4, liquidCount / 1000);
    const targetSolid = Math.min(0.3, solidCount / 1000);

    this.fireGain?.gain.setTargetAtTime(targetFire, this.ctx.currentTime, 0.1);
    this.liquidGain?.gain.setTargetAtTime(targetLiquid, this.ctx.currentTime, 0.1);
    this.solidGain?.gain.setTargetAtTime(targetSolid, this.ctx.currentTime, 0.1);
  }

  playPlace() {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.05);

    g.gain.setValueAtTime(0.1, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05);

    osc.connect(g);
    g.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }
}

export const soundManager = new SoundManager();
