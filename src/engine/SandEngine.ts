
import { ELEMENTS, Element, ElementType } from './elements';
import { particleManager } from './ParticleManager';

export class SandEngine {
  width: number;
  height: number;
  grid: Int32Array;
  nextGrid: Int32Array;
  tempGrid: Float32Array;
  nextTempGrid: Float32Array;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cellSize: number;
  public stats = {
    fireCount: 0,
    liquidCount: 0,
    solidCount: 0
  };

  constructor(canvas: HTMLCanvasElement, width: number, height: number, cellSize: number = 4) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.width = Math.floor(width / cellSize);
    this.height = Math.floor(height / cellSize);
    this.cellSize = cellSize;
    this.grid = new Int32Array(this.width * this.height);
    this.nextGrid = new Int32Array(this.width * this.height);
    this.tempGrid = new Float32Array(this.width * this.height);
    this.nextTempGrid = new Float32Array(this.width * this.height);
    
    this.canvas.width = this.width * cellSize;
    this.canvas.height = this.height * cellSize;
  }

  getIndex(x: number, y: number) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
    return y * this.width + x;
  }

  getElementAt(x: number, y: number) {
    const idx = this.getIndex(x, y);
    if (idx === -1) return ELEMENTS[1]; // Wall
    return ELEMENTS[this.grid[idx]];
  }

  getTempAt(x: number, y: number) {
    const idx = this.getIndex(x, y);
    if (idx === -1) return 20;
    return this.tempGrid[idx];
  }

  setElementAt(x: number, y: number, elementId: number) {
    const idx = this.getIndex(x, y);
    if (idx !== -1) {
      this.grid[idx] = elementId;
      this.tempGrid[idx] = ELEMENTS[elementId].temperature || 20; // Default room temp
    }
  }

  setTempAt(x: number, y: number, temp: number) {
    const idx = this.getIndex(x, y);
    if (idx !== -1) {
      this.tempGrid[idx] = temp;
      this.nextTempGrid[idx] = temp;
    }
  }

  changeTempAt(x: number, y: number, delta: number) {
    const idx = this.getIndex(x, y);
    if (idx !== -1) {
      this.tempGrid[idx] += delta;
      this.nextTempGrid[idx] += delta;
    }
  }

  update() {
    this.nextGrid.set(this.grid);
    this.nextTempGrid.set(this.tempGrid);

    this.stats.fireCount = 0;
    this.stats.liquidCount = 0;
    this.stats.solidCount = 0;

    // Update from bottom to top, left to right for gravity
    for (let y = this.height - 1; y >= 0; y--) {
      for (let x = 0; x < this.width; x++) {
        const idx = this.getIndex(x, y);
        const elementId = this.grid[idx];
        
        // Heat diffusion and state changes
        this.updateTemperature(x, y);

        if (elementId === 0) continue;

        const element = ELEMENTS[elementId];
        
        // Count for sounds
        if (element.type === 'fire' || elementId === 8) {
          this.stats.fireCount++;
          if (Math.random() < 0.01) {
            particleManager.addParticle(x, y, 'spark', '#ffcc00');
          }
        }
        if (element.type === 'liquid') {
          this.stats.liquidCount++;
          if (this.tempGrid[idx] > 80 && Math.random() < 0.02) {
            particleManager.addParticle(x, y, 'bubble', '#ffffff');
          }
        }
        if (element.type === 'powder' && this.isMoving(x, y)) this.stats.solidCount++;

        this.updateElement(x, y, element);
      }
    }

    this.grid.set(this.nextGrid);
    this.tempGrid.set(this.nextTempGrid);
  }

  private isMoving(x: number, y: number): boolean {
    const below = this.getIndex(x, y + 1);
    if (below === -1) return false;
    return this.grid[below] === 0;
  }

  updateTemperature(x: number, y: number) {
    const idx = this.getIndex(x, y);
    const elementId = this.grid[idx];
    const element = ELEMENTS[elementId];
    
    // Heat diffusion (simple version)
    let avgTemp = this.tempGrid[idx];
    let count = 1;
    const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
    
    for (const [nx, ny] of neighbors) {
      const nIdx = this.getIndex(nx, ny);
      if (nIdx !== -1) {
        avgTemp += this.tempGrid[nIdx];
        count++;
      }
    }
    
    // Diffusion rate
    const diffusion = 0.1;
    this.nextTempGrid[idx] = this.tempGrid[idx] + (avgTemp / count - this.tempGrid[idx]) * diffusion;

    // Apply element's inherent temperature
    if (element.temperature !== undefined) {
        // Elements like Lava or Ice pull the local temperature towards their own
        this.nextTempGrid[idx] = this.nextTempGrid[idx] * 0.9 + element.temperature * 0.1;
    }

    // State changes based on temperature
    if (element.stateChange) {
        const currentTemp = this.nextTempGrid[idx];
        if (element.stateChange.above) {
            if (currentTemp > element.stateChange.temp) {
                this.nextGrid[idx] = element.stateChange.to;
            }
        } else {
            if (currentTemp < element.stateChange.temp) {
                this.nextGrid[idx] = element.stateChange.to;
            }
        }
    }
    
    // Special hardcoded state changes
    if (elementId === 3 && this.nextTempGrid[idx] > 100) { // Water -> Steam
        this.nextGrid[idx] = 11;
    }
    if (elementId === 3 && this.nextTempGrid[idx] < 0) { // Water -> Ice
        this.nextGrid[idx] = 14;
    }
    if (elementId === 11 && this.nextTempGrid[idx] < 100) { // Steam -> Water
        this.nextGrid[idx] = 3;
    }
  }

  updateElement(x: number, y: number, element: Element) {
    const idx = this.getIndex(x, y);

    switch (element.type) {
      case 'powder':
        this.updatePowder(x, y, element);
        break;
      case 'liquid':
        this.updateLiquid(x, y, element);
        break;
      case 'gas':
        this.updateGas(x, y, element);
        break;
      case 'fire':
        this.updateFire(x, y, element);
        break;
      case 'special':
        this.updateSpecial(x, y, element);
        break;
    }

    // Acid interaction
    if (element.id === 8) { // Acid
      this.interactAcid(x, y);
    }

    // Lava interaction
    if (element.id === 10) { // Lava
      this.interactLava(x, y);
    }

    // Virus interaction
    if (element.id === 21) { // Virus
      this.interactVirus(x, y);
    }
    
    // Plant interaction
    if (element.id === 20) { // Plant
        this.interactPlant(x, y);
    }

    // Void interaction
    if (element.id === 100) { // Void
        this.interactVoid(x, y);
    }

    // Vine interaction
    if (element.id === 101) {
        this.interactVine(x, y);
    }

    // Moss interaction
    if (element.id === 102) {
        this.interactMoss(x, y);
    }

    // Flower interaction
    if (element.id === 103) {
        this.interactFlower(x, y);
    }

    // Fish interaction
    if (element.id === 104) {
        this.interactFish(x, y);
    }

    // Bird interaction
    if (element.id === 105) {
        this.interactBird(x, y);
    }

    // Bug interaction
    if (element.id === 106) {
        this.interactBug(x, y);
    }
  }

  updatePowder(x: number, y: number, element: Element) {
    const idx = this.getIndex(x, y);
    
    // Try down
    if (this.canMoveTo(x, y + 1, element)) {
      this.moveElement(x, y, x, y + 1);
    } else {
      // Try diagonals
      const dir = Math.random() > 0.5 ? 1 : -1;
      if (this.canMoveTo(x + dir, y + 1, element)) {
        this.moveElement(x, y, x + dir, y + 1);
      } else if (this.canMoveTo(x - dir, y + 1, element)) {
        this.moveElement(x, y, x - dir, y + 1);
      }
    }
  }

  updateLiquid(x: number, y: number, element: Element) {
    // Try down
    if (this.canMoveTo(x, y + 1, element)) {
      this.moveElement(x, y, x, y + 1);
    } else {
      // Try diagonals
      const dir = Math.random() > 0.5 ? 1 : -1;
      if (this.canMoveTo(x + dir, y + 1, element)) {
        this.moveElement(x, y, x + dir, y + 1);
      } else if (this.canMoveTo(x - dir, y + 1, element)) {
        this.moveElement(x, y, x - dir, y + 1);
      } else {
        // Try horizontal flow
        const flowRange = 3;
        if (this.canMoveTo(x + dir, y, element)) {
          this.moveElement(x, y, x + dir, y);
        } else if (this.canMoveTo(x - dir, y, element)) {
          this.moveElement(x, y, x - dir, y);
        }
      }
    }
  }

  updateGas(x: number, y: number, element: Element) {
    // Try up
    if (this.canMoveTo(x, y - 1, element)) {
      this.moveElement(x, y, x, y - 1);
    } else {
      // Try diagonals up
      const dir = Math.random() > 0.5 ? 1 : -1;
      if (this.canMoveTo(x + dir, y - 1, element)) {
        this.moveElement(x, y, x + dir, y - 1);
      } else if (this.canMoveTo(x - dir, y - 1, element)) {
        this.moveElement(x, y, x - dir, y - 1);
      } else {
        // Horizontal drift
        if (this.canMoveTo(x + dir, y, element)) {
          this.moveElement(x, y, x + dir, y);
        }
      }
    }

    // Longevity
    if (element.longevity && Math.random() < 0.05) {
      if (Math.random() > 0.95) this.nextGrid[this.getIndex(x, y)] = 0;
    }
  }

  updateFire(x: number, y: number, element: Element) {
    // Fire spreads to flammable neighbors
    const neighbors = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
    ];

    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.flammability && Math.random() < target.flammability) {
        this.nextGrid[this.getIndex(nx, ny)] = 6; // Spread fire
      }
    }

    // Fire rises like gas
    if (Math.random() < 0.5) {
        this.updateGas(x, y, element);
    }

    // Fire dies out
    if (Math.random() < 0.1) {
      this.nextGrid[this.getIndex(x, y)] = 7; // Turn to smoke
    }
  }

  updateSpecial(x: number, y: number, element: Element) {
      // Custom logic for special elements if needed
  }

  interactAcid(x: number, y: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id !== 0 && target.id !== 8 && target.id !== 1 && target.dissolvable !== false) {
        if (Math.random() < 0.1) {
          this.nextGrid[this.getIndex(nx, ny)] = 0; // Dissolve
          if (Math.random() < 0.5) {
            this.nextGrid[this.getIndex(x, y)] = 0; // Acid consumed
          }
          if (Math.random() < 0.2) {
            particleManager.addParticle(nx, ny, 'smoke', '#88ff88');
          }
        }
      }
    }
  }

  interactLava(x: number, y: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 3) { // Water
        this.nextGrid[this.getIndex(nx, ny)] = 11; // Steam
        this.nextGrid[this.getIndex(x, y)] = 35; // Obsidian
      } else if (target.flammability && Math.random() < 0.5) {
        this.nextGrid[this.getIndex(nx, ny)] = 6; // Ignite
      }
    }
  }

  interactVirus(x: number, y: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id !== 0 && target.id !== 21 && target.id !== 1) {
        if (Math.random() < 0.05) {
          this.nextGrid[this.getIndex(nx, ny)] = 21; // Infect
        }
      }
    }
  }
  
  interactPlant(x: number, y: number) {
      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      let hasWater = false;
      for (const [nx, ny] of neighbors) {
          if (this.getElementAt(nx, ny).id === 3) {
              hasWater = true;
              if (Math.random() < 0.05) {
                  this.nextGrid[this.getIndex(nx, ny)] = 0; // Consume water
              }
              break;
          }
      }
      
      if (hasWater && Math.random() < 0.1) {
          const rx = x + (Math.random() > 0.5 ? 1 : -1);
          const ry = y + (Math.random() > 0.5 ? 1 : -1);
          if (this.getElementAt(rx, ry).id === 0) {
              this.nextGrid[this.getIndex(rx, ry)] = 20; // Grow
          }
      }
  }

  interactVoid(x: number, y: number) {
      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbors) {
          if (this.getElementAt(nx, ny).id !== 100 && this.getElementAt(nx, ny).id !== 1) {
              this.nextGrid[this.getIndex(nx, ny)] = 0; // Consume
          }
      }
  }

  interactVine(x: number, y: number) {
    if (Math.random() > 0.05) return;
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    let attached = false;
    for (const [nx, ny] of neighbors) {
        const target = this.getElementAt(nx, ny);
        if (target.type === 'solid' || target.id === 101) {
            attached = true;
            break;
        }
    }
    if (!attached) {
        this.nextGrid[this.getIndex(x, y)] = 0; // Fall if not attached
        return;
    }

    // Grow downwards or sideways
    const dir = Math.random() > 0.5 ? 1 : -1;
    const targets = [[x, y + 1], [x + dir, y]];
    for (const [tx, ty] of targets) {
        if (this.getElementAt(tx, ty).id === 0) {
            this.nextGrid[this.getIndex(tx, ty)] = 101;
            break;
        }
    }
  }

  interactMoss(x: number, y: number) {
    if (Math.random() > 0.02) return;
    const below = this.getElementAt(x, y + 1);
    if (below.type !== 'solid' && below.id !== 102) {
        this.nextGrid[this.getIndex(x, y)] = 0; // Moss needs support
        return;
    }

    // Spread sideways
    const dir = Math.random() > 0.5 ? 1 : -1;
    if (this.getElementAt(x + dir, y).id === 0 && this.getElementAt(x + dir, y + 1).type === 'solid') {
        this.nextGrid[this.getIndex(x + dir, y)] = 102;
    }
  }

  interactFlower(x: number, y: number) {
      // Flowers don't grow, they just stay on plants
      const below = this.getElementAt(x, y + 1);
      if (below.id !== 20 && below.id !== 101 && below.id !== 103) {
          this.nextGrid[this.getIndex(x, y)] = 0; // Die without support
      }
  }

  interactFish(x: number, y: number) {
    // Fish need water
    const current = this.getElementAt(x, y);
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    let inWater = false;
    for (const [nx, ny] of neighbors) {
        if (this.getElementAt(nx, ny).id === 3) {
            inWater = true;
            break;
        }
    }

    if (!inWater && Math.random() < 0.1) {
        this.nextGrid[this.getIndex(x, y)] = 50; // Die and turn to blood/meat? No, just empty for now or a dead fish element.
        return;
    }

    // Swim
    if (Math.random() < 0.2) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        if (this.getElementAt(x + dx, y + dy).id === 3) {
            this.moveElement(x, y, x + dx, y + dy);
        }
    }
  }

  interactBird(x: number, y: number) {
    // Birds fly
    if (Math.random() < 0.3) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1 - (Math.random() < 0.1 ? 1 : 0); // Tendency to fly up
        if (this.getElementAt(x + dx, y + dy).id === 0) {
            this.moveElement(x, y, x + dx, y + dy);
        }
    }
    // Land occasionally
    const below = this.getElementAt(x, y + 1);
    if (below.type === 'solid' && Math.random() < 0.01) {
        // Stay still
    }
  }

  interactBug(x: number, y: number) {
    // Bugs crawl on solids
    const below = this.getElementAt(x, y + 1);
    if (below.id === 0) {
        this.updatePowder(x, y, ELEMENTS[106]); // Fall like powder
        return;
    }

    if (Math.random() < 0.1) {
        const dx = Math.random() > 0.5 ? 1 : -1;
        if (this.getElementAt(x + dx, y).id === 0 && this.getElementAt(x + dx, y + 1).type === 'solid') {
            this.moveElement(x, y, x + dx, y);
        } else if (this.getElementAt(x + dx, y - 1).id === 0 && this.getElementAt(x + dx, y).type === 'solid') {
            this.moveElement(x, y, x + dx, y - 1); // Climb
        }
    }
  }

  saveState(): string {
      const state = {
          grid: Array.from(this.grid),
          tempGrid: Array.from(this.tempGrid),
          width: this.width,
          height: this.height
      };
      return JSON.stringify(state);
  }

  loadState(stateStr: string) {
      try {
          const state = JSON.parse(stateStr);
          if (state.width !== this.width || state.height !== this.height) {
              console.error("Save state dimensions mismatch");
              return;
          }
          this.grid.set(state.grid);
          this.tempGrid.set(state.tempGrid);
          this.nextGrid.set(state.grid);
          this.nextTempGrid.set(state.tempGrid);
      } catch (e) {
          console.error("Failed to load state", e);
      }
  }

  canMoveTo(x: number, y: number, element: Element) {
    const target = this.getElementAt(x, y);
    if (target.id === 0) return true;
    
    // Density check: heavier things sink in lighter things
    if (element.type === 'powder' || element.type === 'liquid') {
        if (target.type === 'liquid' || target.type === 'gas') {
            return element.density > target.density;
        }
    }
    
    if (element.type === 'gas') {
        if (target.type === 'gas') {
            return element.density < target.density;
        }
    }

    return false;
  }

  moveElement(x1: number, y1: number, x2: number, y2: number) {
    const idx1 = this.getIndex(x1, y1);
    const idx2 = this.getIndex(x2, y2);
    
    const temp = this.nextGrid[idx2];
    this.nextGrid[idx2] = this.grid[idx1];
    this.nextGrid[idx1] = temp;
  }

  render() {
    const imageData = this.ctx.createImageData(this.width, this.height);
    const data = imageData.data;

    for (let i = 0; i < this.grid.length; i++) {
      const elementId = this.grid[i];
      const color = ELEMENTS[elementId].color;
      
      // Fast hex to RGB
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);

      const p = i * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }

    // Draw to a temporary canvas then scale up to main canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.width;
    tempCanvas.height = this.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(tempCanvas, 0, 0, this.canvas.width, this.canvas.height);

    // Update and render particles
    particleManager.update();
    particleManager.render(this.ctx, this.cellSize);
  }
}
