
import { ELEMENTS, Element, ElementType } from './elements';
import { particleManager } from './ParticleManager';

export class SandEngine {
  width: number;
  height: number;
  grid: Int32Array;
  nextGrid: Int32Array;
  tempGrid: Float32Array;
  nextTempGrid: Float32Array;
  powerGrid: Uint8Array;
  nextPowerGrid: Uint8Array;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cellSize: number;
  frameCount: number = 0;
  cloneTargets: Map<number, number> = new Map();
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
    this.powerGrid = new Uint8Array(this.width * this.height);
    this.nextPowerGrid = new Uint8Array(this.width * this.height);
    
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
    this.frameCount++;
    this.nextGrid.set(this.grid);
    this.nextTempGrid.set(this.tempGrid);
    this.nextPowerGrid.fill(0);

    this.stats.fireCount = 0;
    this.stats.liquidCount = 0;
    this.stats.solidCount = 0;

    // Power propagation pass (multiple directions for speed)
    for (let y = this.height - 1; y >= 0; y--) {
      for (let x = 0; x < this.width; x++) {
        this.updatePower(x, y);
      }
    }
    this.powerGrid.set(this.nextPowerGrid);
    // Update power grid (multiple passes for faster propagation)
    for (let pass = 0; pass < 5; pass++) {
      for (let y = 0; y < this.height; y++) {
        for (let x = this.width - 1; x >= 0; x--) {
          this.updatePower(x, y);
        }
      }
      this.powerGrid.set(this.nextPowerGrid);
    }

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
    this.powerGrid.set(this.nextPowerGrid);
    this.render();
  }

  updatePower(x: number, y: number) {
    const idx = this.getIndex(x, y);
    const elementId = this.grid[idx];
    const element = ELEMENTS[elementId];

    if (elementId === 221) { // Battery
      this.nextPowerGrid[idx] = 1;
      return;
    }

    if (!element.conductive) {
      this.nextPowerGrid[idx] = 0;
      return;
    }

    // Conductive elements check neighbors for power
    let hasPower = false;
    const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
    for (const [nx, ny] of neighbors) {
      const nIdx = this.getIndex(nx, ny);
      // Check both current power and next power (to allow propagation in one frame)
      // Actually, standard cellular automata propagation is better for "circuits"
      if (nIdx !== -1 && (this.powerGrid[nIdx] === 1 || this.nextPowerGrid[nIdx] === 1)) {
        hasPower = true;
        break;
      }
    }
    this.nextPowerGrid[idx] = hasPower ? 1 : 0;

    // Clone Wall logic
    if (hasPower && elementId === 225) {
      this.interactCloneWall(x, y);
      if (Math.random() < 0.05) {
        particleManager.addParticle(x, y, 'spark', '#ba68c8');
      }
    }
  }

  interactCloneWall(x: number, y: number) {
    const idx = this.getIndex(x, y);
    const targetId = this.cloneTargets.get(idx);
    if (targetId === undefined) return;

    // Output to bottom if empty
    const bottomIdx = this.getIndex(x, y + 1);
    if (bottomIdx !== -1 && this.grid[bottomIdx] === 0) {
      this.nextGrid[bottomIdx] = targetId;
      this.nextTempGrid[bottomIdx] = 20; // Default temp for cloned elements
    }
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

    // Machine logic for heat
    if (this.powerGrid[idx] === 1) {
      if (elementId === 223) { // Burner
        this.nextTempGrid[idx] += 10;
      } else if (elementId === 224) { // Cooler
        this.nextTempGrid[idx] -= 10;
      }
    }

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

    // Napalm interaction
    if (element.id === 216) {
      this.interactNapalm(x, y);
    }

    // Helium interaction
    if (element.id === 217) {
      this.interactHelium(x, y);
    }

    // Molten interaction
    if ([211, 212, 213, 214, 215, 219, 220].includes(element.id)) {
      this.interactMolten(x, y);
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

    // Anti-matter interaction
    if (element.id === 151) {
        this.interactAntiMatter(x, y);
    }

    // Grass interaction
    if (element.id === 141) {
        this.interactGrass(x, y);
    }

    // Mushroom interaction
    if (element.id === 150) {
        this.interactMushroom(x, y);
    }

    // Popcorn interaction
    if (element.id === 171) {
        this.interactPopcorn(x, y);
    }

    // TNT, C4, Nuke, Grenade, Blazer, Blade interaction
    if ([238, 239, 240, 241, 261, 266].includes(element.id)) {
        this.interactExplosive(x, y, element);
    }

    // Blazer interaction
    if (element.id === 261) {
        this.interactBlazer(x, y);
    }

    // Gun interaction
    if (element.id === 262) {
        this.interactGun(x, y);
    }

    // Bullet interaction
    if (element.id === 263) {
        this.interactBullet(x, y);
    }

    // Explosion interaction
    if (element.id === 264) {
        this.interactExplosion(x, y);
    }

    // Shockwave interaction
    if (element.id === 265) {
        this.interactShockwave(x, y);
    }

    // Life form interactions
    if (element.id === 256) this.interactHuman(x, y);
    if (element.id === 257) this.interactCat(x, y);
    if (element.id === 258) this.interactDog(x, y);
    if (element.id === 259) this.interactRat(x, y);
    if (element.id === 260) this.interactBird(x, y);
    if (element.id === 267) this.interactFish(x, y);
    if (element.id === 268) this.interactBug(x, y);
    if (element.id === 269) this.interactFrog(x, y);
    if (element.id === 270) this.interactZombie(x, y);

    // Longevity
    if (element.longevity && Math.random() < 0.1) {
        if (Math.random() > 0.9) this.nextGrid[this.getIndex(x, y)] = 0;
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
        if (this.canMoveTo(x + dir, y, element)) {
          this.moveElement(x, y, x + dir, y);
        } else if (this.canMoveTo(x - dir, y, element)) {
          this.moveElement(x, y, x - dir, y);
        } else {
          // Aggressive gap filling: if there's air (ID 0) nearby, move into it
          // This prevents trapped air bubbles
          const neighbors = [[x, y-1], [x+1, y], [x-1, y], [x, y+1]];
          for (const [nx, ny] of neighbors) {
            const nIdx = this.getIndex(nx, ny);
            if (nIdx !== -1 && this.grid[nIdx] === 0 && this.nextGrid[nIdx] === 0) {
              if (Math.random() < 0.1) { // Small chance to "jump" into gaps
                this.moveElement(x, y, nx, ny);
                break;
              }
            }
          }
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

  interactNapalm(x: number, y: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.flammability && Math.random() < 0.8) {
        this.nextGrid[this.getIndex(nx, ny)] = 6; // Ignite
      }
    }
    // Napalm itself burns
    if (Math.random() < 0.05) {
      this.nextGrid[this.getIndex(x, y)] = 6;
    }
  }

  interactHelium(x: number, y: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      // Freeze water to ice
      if (target.id === 3) {
        this.nextGrid[this.getIndex(nx, ny)] = 12; // Ice
      }
      // Put out fire
      if (target.id === 6) {
        this.nextGrid[this.getIndex(nx, ny)] = 0;
      }
    }
  }

  interactMolten(x: number, y: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 3) { // Water
        this.nextGrid[this.getIndex(nx, ny)] = 11; // Steam
      } else if (target.flammability && Math.random() < 0.3) {
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

  interactAntiMatter(x: number, y: number) {
      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbors) {
          const target = this.getElementAt(nx, ny);
          if (target.id !== 0 && target.id !== 151 && target.id !== 1) {
              this.nextGrid[this.getIndex(nx, ny)] = 0; // Annihilate
              this.nextGrid[this.getIndex(x, y)] = 0; // Self-destruct
              if (Math.random() < 0.5) {
                  particleManager.addParticle(nx, ny, 'spark', '#ff00ff');
              }
          }
      }
  }

  interactGrass(x: number, y: number) {
      if (Math.random() > 0.05) return;
      const below = this.getElementAt(x, y + 1);
      if (below.type !== 'solid' && below.type !== 'powder' && below.id !== 141) {
          this.nextGrid[this.getIndex(x, y)] = 0; // Needs support
          return;
      }

      // Spread sideways or grow up
      const dir = Math.random() > 0.5 ? 1 : -1;
      if (this.getElementAt(x + dir, y).id === 0 && (this.getElementAt(x + dir, y + 1).type === 'solid' || this.getElementAt(x + dir, y + 1).type === 'powder')) {
          this.nextGrid[this.getIndex(x + dir, y)] = 141;
      } else if (this.getElementAt(x, y - 1).id === 0 && Math.random() < 0.1) {
          this.nextGrid[this.getIndex(x, y - 1)] = 141;
      }
  }

  interactMushroom(x: number, y: number) {
      if (Math.random() > 0.01) return;
      const below = this.getElementAt(x, y + 1);
      if (below.type !== 'solid' && below.type !== 'powder' && below.id !== 150) {
          this.nextGrid[this.getIndex(x, y)] = 0; // Needs support
          return;
      }

      // Grow near water or soil
      let fertile = false;
      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbors) {
          const target = this.getElementAt(nx, ny);
          if (target.id === 3 || target.id === 37 || target.id === 20) {
              fertile = true;
              break;
          }
      }

      if (fertile && Math.random() < 0.05) {
          const rx = x + (Math.random() > 0.5 ? 1 : -1);
          if (this.getElementAt(rx, y).id === 0 && (this.getElementAt(rx, y + 1).type === 'solid' || this.getElementAt(rx, y + 1).type === 'powder')) {
              this.nextGrid[this.getIndex(rx, y)] = 150;
          }
      }
  }

  interactPopcorn(x: number, y: number) {
      if (this.tempGrid[this.getIndex(x, y)] > 150 && Math.random() < 0.1) {
          this.nextGrid[this.getIndex(x, y)] = 210; // Turn to Foam (proxy for popped popcorn)
          particleManager.addParticle(x, y, 'smoke', '#ffffff');
      }
  }

  interactExplosive(x: number, y: number, element: Element) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    let triggered = false;
    let virusTrigger = false;
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id !== 0 && target.id !== element.id) { 
        triggered = true;
        if (target.id === 21) { // Virus
            virusTrigger = true;
        }
        break;
      }
    }
    if (this.tempGrid[this.getIndex(x, y)] > 100) triggered = true;

    if (triggered) {
      let radius = 5;
      if (element.id === 239) radius = 10; // C4
      if (element.id === 240) radius = 30; // Nuke
      if (element.id === 241) radius = 8; // Grenade
      if (element.id === 261) radius = 12; // Blazer (if it explodes)
      if (element.id === 266) radius = 6; // Blade
      
      if (virusTrigger) {
          radius *= 5; // "Wipe everything out"
      }
      
      this.explode(x, y, radius);
    }
  }

  explode(x: number, y: number, radius: number) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          const nx = x + dx;
          const ny = y + dy;
          const idx = this.getIndex(nx, ny);
          if (idx !== -1) {
            const target = ELEMENTS[this.grid[idx]];
            if (target.id !== 1) { // Don't destroy walls
              if (Math.random() < 0.7) {
                this.nextGrid[idx] = 264; // Explosion
                this.nextTempGrid[idx] = 1000;
              } else if (Math.random() < 0.3) {
                this.nextGrid[idx] = 265; // Shockwave
              }
            }
          }
        }
      }
    }
    particleManager.addParticle(x, y, 'smoke', '#ff9800');
  }

  interactBlazer(x: number, y: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id !== 0 && target.id !== 1 && target.id !== 261) {
        this.nextGrid[this.getIndex(nx, ny)] = 0; // Destroy
        if (Math.random() < 0.1) {
          particleManager.addParticle(nx, ny, 'spark', '#ff5722');
        }
      }
    }
    // Blazer itself moves randomly
    if (Math.random() < 0.2) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      if (this.getElementAt(x + dx, y + dy).id === 0) {
        this.moveElement(x, y, x + dx, y + dy);
      }
    }
  }

  interactGun(x: number, y: number) {
    // Guns fire bullets if they have power or randomly
    if (Math.random() < 0.05) {
      const dir = Math.random() > 0.5 ? 1 : -1;
      const nx = x + dir;
      if (this.getElementAt(nx, y).id === 0) {
        this.nextGrid[this.getIndex(nx, y)] = 263; // Bullet
        this.nextTempGrid[this.getIndex(nx, y)] = dir; // Store direction in tempGrid
      }
    }
  }

  interactBullet(x: number, y: number) {
    // Bullets move fast in the direction they were fired
    const dx = this.tempGrid[this.getIndex(x, y)] || 1; 
    const nx = x + Math.sign(dx);
    const ny = y;
    const target = this.getElementAt(nx, ny);
    if (target.id === 0) {
      this.moveElement(x, y, nx, ny);
      this.nextTempGrid[this.getIndex(nx, ny)] = dx; // Carry over direction
    } else if (target.id !== 1 && target.id !== 263) {
      this.nextGrid[this.getIndex(nx, ny)] = 264; // Explosion on hit
      this.nextGrid[this.getIndex(x, y)] = 0; // Bullet destroyed
    } else {
      this.nextGrid[this.getIndex(x, y)] = 0; // Hit wall or another bullet
    }
  }

  interactExplosion(x: number, y: number) {
    // Explosions expand and die out
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 0 && Math.random() < 0.2) {
        this.nextGrid[this.getIndex(nx, ny)] = 264;
      } else if (target.id !== 1 && target.id !== 264 && Math.random() < 0.1) {
        this.nextGrid[this.getIndex(nx, ny)] = 6; // Turn to fire
      }
    }
    // Die out
    if (Math.random() < 0.3) {
      this.nextGrid[this.getIndex(x, y)] = 7; // Turn to smoke
    }
  }

  interactShockwave(x: number, y: number) {
    // Shockwaves push neighbors
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.type === 'powder' || target.type === 'liquid') {
        const dx = nx - x;
        const dy = ny - y;
        if (this.getElementAt(nx + dx, ny + dy).id === 0) {
          this.moveElement(nx, ny, nx + dx, ny + dy);
        }
      }
    }
    // Die out
    if (Math.random() < 0.5) {
      this.nextGrid[this.getIndex(x, y)] = 0;
    }
  }

  interactHuman(x: number, y: number) {
    // Humans walk on solids, eat food, drink water, and die from hazards
    const idx = this.getIndex(x, y);
    const below = this.getElementAt(x, y + 1);
    
    // Drowning check
    if (this.getElementAt(x, y).id === 3 || this.getElementAt(x, y).id === 37) {
      if (Math.random() < 0.05) {
        this.die(x, y);
        return;
      }
    }

    if (below.id === 0) {
      this.updatePowder(x, y, ELEMENTS[256]);
      return;
    }

    // Feeding and drinking
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if ([242, 243, 244, 245].includes(target.id)) { // Food
        this.nextGrid[this.getIndex(nx, ny)] = 0; // Eat
        if (Math.random() < 0.1) this.spawn(x, y, 256); // Reproduce
        return;
      }
      if (target.id === 3) { // Drink water
        if (Math.random() < 0.01) {
          // Just a visual effect or something? No, let's just say they are happy.
        }
      }
    }

    // Movement
    if (Math.random() < 0.1) {
      const dx = Math.random() > 0.5 ? 1 : -1;
      if (this.getElementAt(x + dx, y).id === 0 && (this.getElementAt(x + dx, y + 1).type === 'solid' || this.getElementAt(x + dx, y + 1).type === 'powder')) {
        this.moveElement(x, y, x + dx, y);
      }
    }
  }

  interactCat(x: number, y: number) {
    // Cats walk, jump, eat rats/birds/fish, and avoid dogs
    const below = this.getElementAt(x, y + 1);
    
    if (this.getElementAt(x, y).id === 3 || this.getElementAt(x, y).id === 37) {
      if (Math.random() < 0.1) { this.die(x, y); return; }
    }

    if (below.id === 0) {
      this.updatePowder(x, y, ELEMENTS[257]);
      return;
    }

    // Predation
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if ([259, 260, 267].includes(target.id)) { // Rat, Bird, Fish
        this.nextGrid[this.getIndex(nx, ny)] = 271; // Eat and leave blood
        if (Math.random() < 0.05) this.spawn(x, y, 257);
        return;
      }
    }

    // Movement
    if (Math.random() < 0.2) {
      const dx = Math.random() > 0.5 ? 1 : -1;
      if (this.getElementAt(x + dx, y).id === 0) {
        this.moveElement(x, y, x + dx, y);
      } else if (this.getElementAt(x + dx, y - 1).id === 0) {
        this.moveElement(x, y, x + dx, y - 1); // Jump
      }
    }
  }

  interactDog(x: number, y: number) {
    // Dogs walk, chase cats, and eat meat
    const below = this.getElementAt(x, y + 1);
    
    if (this.getElementAt(x, y).id === 3 || this.getElementAt(x, y).id === 37) {
      if (Math.random() < 0.05) { this.die(x, y); return; }
    }

    if (below.id === 0) {
      this.updatePowder(x, y, ELEMENTS[258]);
      return;
    }

    // Chase cats or eat meat
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 245 || target.id === 242) { // Steak or Burger
        this.nextGrid[this.getIndex(nx, ny)] = 0;
        if (Math.random() < 0.05) this.spawn(x, y, 258);
        return;
      }
      if (target.id === 257) { // Cat
        // Bark or chase? Let's just move towards it if possible
        const dx = nx > x ? 1 : -1;
        if (this.getElementAt(x + dx, y).id === 0) {
          this.moveElement(x, y, x + dx, y);
          return;
        }
      }
    }

    if (Math.random() < 0.1) {
      const dx = Math.random() > 0.5 ? 1 : -1;
      if (this.getElementAt(x + dx, y).id === 0) {
        this.moveElement(x, y, x + dx, y);
      }
    }
  }

  interactRat(x: number, y: number) {
    // Rats walk fast and eat anything organic
    const below = this.getElementAt(x, y + 1);
    
    if (this.getElementAt(x, y).id === 3 || this.getElementAt(x, y).id === 37) {
      if (Math.random() < 0.2) { this.die(x, y); return; }
    }

    if (below.id === 0) {
      this.updatePowder(x, y, ELEMENTS[259]);
      return;
    }

    // Eat
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if ([242, 243, 244, 245, 141, 150].includes(target.id)) { // Food, Grass, Mushroom
        this.nextGrid[this.getIndex(nx, ny)] = 0;
        if (Math.random() < 0.2) this.spawn(x, y, 259);
        return;
      }
    }

    if (Math.random() < 0.3) {
      const dx = Math.random() > 0.5 ? 1 : -1;
      if (this.getElementAt(x + dx, y).id === 0) {
        this.moveElement(x, y, x + dx, y);
      }
    }
  }

  die(x: number, y: number) {
    const idx = this.getIndex(x, y);
    if (Math.random() < 0.5) {
      this.nextGrid[idx] = 271; // Blood
    } else {
      this.nextGrid[idx] = 245; // Steak (Meat)
    }
    particleManager.addParticle(x, y, 'smoke', '#b71c1c');
  }

  spawn(x: number, y: number, id: number) {
    const neighbors = [[x + 1, y], [x - 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of neighbors) {
      if (this.getElementAt(nx, ny).id === 0) {
        this.nextGrid[this.getIndex(nx, ny)] = id;
        return;
      }
    }
  }

  interactBird(x: number, y: number) {
    // Birds fly, eat bugs, and die in water
    if (this.getElementAt(x, y).id === 3 || this.getElementAt(x, y).id === 37) {
      if (Math.random() < 0.2) { this.die(x, y); return; }
    }

    // Eat bugs
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 268 || target.id === 106) { // Bug
        this.nextGrid[this.getIndex(nx, ny)] = 0;
        if (Math.random() < 0.1) this.spawn(x, y, 260);
        return;
      }
    }

    if (Math.random() < 0.3) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1 - (Math.random() < 0.1 ? 1 : 0); // Tendency to fly up
      if (this.getElementAt(x + dx, y + dy).id === 0) {
        this.moveElement(x, y, x + dx, y + dy);
      }
    }
  }

  interactFish(x: number, y: number) {
    // Fish swim in water, eat bugs, and die in air
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 268 || target.id === 106) { // Bug
        this.nextGrid[this.getIndex(nx, ny)] = 0;
        if (Math.random() < 0.1) this.spawn(x, y, 267);
        return;
      }
    }

    if (Math.random() < 0.2) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      const target = this.getElementAt(x + dx, y + dy);
      if (target.id === 3 || target.id === 37) { // Water or Salt Water
        this.moveElement(x, y, x + dx, y + dy);
      } else if (target.id === 0) {
        // Fall if in air
        this.updatePowder(x, y, ELEMENTS[267]);
        // Die in air eventually
        if (Math.random() < 0.01) this.die(x, y);
      }
    }
  }

  interactBug(x: number, y: number) {
    // Bugs crawl, eat plants
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 141 || target.id === 150 || target.id === 101) { // Grass, Mushroom, Vine
        this.nextGrid[this.getIndex(nx, ny)] = 0;
        if (Math.random() < 0.1) this.spawn(x, y, 268);
        return;
      }
    }

    if (Math.random() < 0.3) {
      let attached = false;
      for (const [nx, ny] of neighbors) {
        const target = this.getElementAt(nx, ny);
        if (target.type === 'solid' || target.id === 1) {
          attached = true;
          break;
        }
      }

      if (attached) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        if (this.getElementAt(x + dx, y + dy).id === 0) {
          this.moveElement(x, y, x + dx, y + dy);
        }
      } else {
        // Fall if not attached
        this.updatePowder(x, y, ELEMENTS[268]);
      }
    }
  }

  interactFrog(x: number, y: number) {
    // Frogs jump, swim, eat bugs
    const below = this.getElementAt(x, y + 1);
    
    // Eat bugs
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if (target.id === 268 || target.id === 106) { // Bug
        this.nextGrid[this.getIndex(nx, ny)] = 0;
        if (Math.random() < 0.1) this.spawn(x, y, 269);
        return;
      }
    }

    if (below.id === 3 || below.id === 37) { // In water
      if (Math.random() < 0.1) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        if (this.getElementAt(x + dx, y + dy).id === 3) {
          this.moveElement(x, y, x + dx, y + dy);
        }
      }
    } else if (below.id === 0) {
      this.updatePowder(x, y, ELEMENTS[269]);
    } else {
      // On land, jump
      if (Math.random() < 0.05) {
        const dx = (Math.random() > 0.5 ? 1 : -1) * 2;
        const dy = -2;
        if (this.getElementAt(x + dx, y + dy).id === 0) {
          this.moveElement(x, y, x + dx, y + dy);
        }
      }
    }
  }

  interactZombie(x: number, y: number) {
    // Zombies walk and infect humans/animals
    const below = this.getElementAt(x, y + 1);
    if (below.id === 0) {
      this.updatePowder(x, y, ELEMENTS[270]);
      return;
    }

    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      const target = this.getElementAt(nx, ny);
      if ([256, 257, 258, 259, 260].includes(target.id)) { // Human, Cat, Dog, Rat, Bird
        this.nextGrid[this.getIndex(nx, ny)] = 270; // Infect
        particleManager.addParticle(nx, ny, 'smoke', '#4caf50');
      }
    }

    if (Math.random() < 0.05) {
      const dx = Math.random() > 0.5 ? 1 : -1;
      if (this.getElementAt(x + dx, y).id === 0 && (this.getElementAt(x + dx, y + 1).type === 'solid' || this.getElementAt(x + dx, y + 1).type === 'powder')) {
        this.moveElement(x, y, x + dx, y);
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
    const idx = this.getIndex(x, y);
    if (idx === -1) return false;

    // CRITICAL: Check if the spot in nextGrid has already been claimed this frame
    // If nextGrid[idx] != grid[idx], it means another particle already moved here.
    if (this.nextGrid[idx] !== this.grid[idx]) return false;

    const target = ELEMENTS[this.grid[idx]];
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
      if (elementId === 0) {
        const p = i * 4;
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 255;
        continue;
      }

      let color = ELEMENTS[elementId].color;
      
      // Visual feedback for power
      if (this.powerGrid[i] === 1) {
        if (elementId === 222) { // Wire charge animation
          // Moving pulse based on position
          const x = i % this.width;
          const y = Math.floor(i / this.width);
          const pulse = (x + y + this.frameCount * 3) % 15;
          if (pulse < 3) color = '#ffffff'; // White pulse
          else if (pulse < 7) color = '#ffeb3b'; // Yellow
          else color = '#795548'; // Brownish/Dark Yellow like the photo
        }
        else if (elementId === 221) color = '#81c784'; // Powered battery glows lighter green
        else if (elementId === 223) color = '#ff8a65'; // Powered burner glows lighter red
        else if (elementId === 224) color = '#64b5f6'; // Powered cooler glows lighter blue
        else if (elementId === 225) color = '#ba68c8'; // Powered clone wall glows lighter purple
      }

      // Fast hex to RGB
      let r = parseInt(color.slice(1, 3), 16);
      let g = parseInt(color.slice(3, 5), 16);
      let b = parseInt(color.slice(5, 7), 16);

      // Add texture (per-pixel noise)
      // Use a more complex hash to avoid repeating patterns
      const hash = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      let noiseRange = 30;
      if (ELEMENTS[elementId].type === 'liquid') noiseRange = 10; // More subtle for liquids
      const noise = (hash - Math.floor(hash)) * noiseRange - (noiseRange / 2);
      
      r = Math.max(0, Math.min(255, r + noise));
      g = Math.max(0, Math.min(255, g + noise));
      b = Math.max(0, Math.min(255, b + noise));

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
