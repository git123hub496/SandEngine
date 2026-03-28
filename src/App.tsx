import React, { useEffect, useRef, useState } from 'react';
import { ELEMENTS, Element, ElementType } from './engine/elements';
import { SandEngine } from './engine/SandEngine';
import { soundManager } from './engine/SoundManager';
import { particleManager } from './engine/ParticleManager';
import { 
  Eraser, 
  Trash2, 
  Play, 
  Pause, 
  Settings, 
  Info,
  ChevronDown,
  ChevronUp,
  MousePointer2,
  Brush,
  Maximize,
  RotateCcw,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SandEngine | null>(null);
  const [selectedElement, setSelectedElement] = useState<number>(2); // Default to Sand
  const [brushSize, setBrushSize] = useState<number>(2);
  const [isReplaceMode, setIsReplaceMode] = useState<boolean>(true);
  const [toolType, setToolType] = useState<'brush' | 'mix' | 'paint' | 'drag'>('brush');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMouseDown, setIsMouseDown] = useState<boolean>(false);
  const [category, setCategory] = useState<string>('Land');
  const [fps, setFps] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [screenMousePos, setScreenMousePos] = useState({ x: 0, y: 0 });
  const [hoverTemp, setHoverTemp] = useState(20);
  
  // Search states
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (canvasRef.current && !engineRef.current) {
      // Bigger pixels: cellSize = 8
      engineRef.current = new SandEngine(canvasRef.current, window.innerWidth, window.innerHeight - 200, 8);
    }

    let animationId: number;
    let lastTime = performance.now();
    let frames = 0;

    const loop = () => {
      const now = performance.now();
      frames++;
      if (now > lastTime + 1000) {
        setFps(Math.round((frames * 1000) / (now - lastTime)));
        lastTime = now;
        frames = 0;
      }

      if (engineRef.current && !isPaused) {
        engineRef.current.update();
        soundManager.updateVolumes(
          engineRef.current.stats.fireCount,
          engineRef.current.stats.liquidCount,
          engineRef.current.stats.solidCount
        );
      }
      if (engineRef.current) {
        engineRef.current.render();
        // Update hover temp
        setHoverTemp(Math.round(engineRef.current.getTempAt(mousePos.x, mousePos.y)));
        
        // Continuous tool application
        if (isMouseDown && (selectedElement === -1 || selectedElement === -2)) {
          applyTool(mousePos.x, mousePos.y);
        }

        // Handle dragging visual
        if (toolType === 'drag' && isMouseDown && engineRef.current.heldElement) {
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx) {
                const el = ELEMENTS[engineRef.current.heldElement.id];
                ctx.fillStyle = el.color;
                ctx.fillRect(screenMousePos.x - 4, screenMousePos.y - 4, 8, 8);
            }
        }
      }
      animationId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationId);
  }, [isPaused, mousePos.x, mousePos.y, isMouseDown, selectedElement, brushSize]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    soundManager.init(); // Initialize on first click
    setIsMouseDown(true);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      let clientX, clientY;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const x = Math.floor((clientX - rect.left) / (engineRef.current?.cellSize || 1));
      const y = Math.floor((clientY - rect.top) / (engineRef.current?.cellSize || 1));
      setMousePos({ x, y });
      setScreenMousePos({ x: clientX - rect.left, y: clientY - rect.top });
      
      if (toolType === 'drag' && engineRef.current) {
        engineRef.current.pickUp(x, y);
      } else if (selectedElement >= 0) {
        applyTool(x, y);
        soundManager.playPlace();
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      let clientX, clientY;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const x = Math.floor((clientX - rect.left) / (engineRef.current?.cellSize || 1));
      const y = Math.floor((clientY - rect.top) / (engineRef.current?.cellSize || 1));
      setMousePos({ x, y });
      setScreenMousePos({ x: clientX - rect.left, y: clientY - rect.top });

      if (isMouseDown && toolType !== 'drag' && selectedElement >= 0) {
        applyTool(x, y);
      }
    }
  };

  const handleMouseUp = () => {
    if (toolType === 'drag' && engineRef.current && isMouseDown) {
      engineRef.current.dropHeld(mousePos.x, mousePos.y);
    }
    setIsMouseDown(false);
  };

  const applyTool = (x: number, y: number) => {
    if (!engineRef.current) return;

    for (let i = -brushSize; i <= brushSize; i++) {
      for (let j = -brushSize; j <= brushSize; j++) {
        if (i * i + j * j <= brushSize * brushSize) {
          const targetX = x + i;
          const targetY = y + j;
          const currentElement = engineRef.current.getElementAt(targetX, targetY);

          if (selectedElement === -1) { // Heat
            engineRef.current.changeTempAt(targetX, targetY, 5);
          } else if (selectedElement === -2) { // Cool
            engineRef.current.changeTempAt(targetX, targetY, -5);
          } else {
            // Check tool type
            if (toolType === 'mix' && Math.random() > 0.3) continue;
            if (toolType === 'paint' && currentElement.id === 0) continue;

            // Check replace mode
            if (isReplaceMode || currentElement.id === 0) {
              engineRef.current.setElementAt(targetX, targetY, selectedElement);
            }
          }
        }
      }
    }
  };

  const clearGrid = () => {
    if (engineRef.current) {
      engineRef.current.grid.fill(0);
      engineRef.current.tempGrid.fill(20);
      particleManager.clear();
    }
  };

  const handleSave = () => {
    if (!engineRef.current) return;
    const state = engineRef.current.saveState();
    localStorage.setItem('sandengine_save', state);
    alert('World saved to local storage!');
  };

  const handleLoad = () => {
    if (!engineRef.current) return;
    const state = localStorage.getItem('sandengine_save');
    if (state) {
      engineRef.current.loadState(state);
    } else {
      alert('No save found!');
    }
  };

  const categories = ['Land', 'Liquids', 'Life', 'Powders', 'Solids', 'Energy', 'Gases', 'Machine', 'Special', 'Destructive'];
  
  const filteredElements = Object.values(ELEMENTS).filter(el => {
    if (el.id === 0) return false;
    
    // Apply search filter first
    if (searchTerm && !el.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
    }

    if (category === 'Land') return [2, 4, 18, 37, 38, 39, 76, 77, 78, 79, 80, 93, 94, 98, 99, 111, 112, 113, 114, 115, 116, 254].includes(el.id);
    if (category === 'Liquids') return el.type === 'liquid';
    if (category === 'Powders') return el.type === 'powder' && ![2, 37, 38, 39, 76, 77, 78, 79, 80, 111, 112, 113, 114, 115, 116].includes(el.id);
    if (category === 'Solids') return el.type === 'solid' && ![4, 93, 94, 221, 222, 223, 224, 225].includes(el.id);
    if (category === 'Gases') return el.type === 'gas' || [147, 148, 159, 160].includes(el.id);
    if (category === 'Energy') return el.type === 'fire' || [28, 154, 155, 156].includes(el.id);
    if (category === 'Life') return [20, 21, 101, 102, 103, 104, 105, 106, 141, 142, 144, 146, 149, 150, 256, 257, 258, 259, 260, 267, 268, 269, 270, 276].includes(el.id);
    if (category === 'Machine') return [221, 222, 223, 224, 225, 272, 273, 274, 275].includes(el.id);
    if (category === 'Special') return el.type === 'special' && ![20, 21, 101, 102, 103, 104, 105, 106, 141, 142, 144, 146, 149, 150, 151, 152, 157, 158, 256, 257, 258, 259, 260, 261, 263].includes(el.id);
    if (category === 'Destructive') return [238, 239, 240, 241, 261, 262, 266].includes(el.id);
    return true;
  });

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden font-sans select-none cursor-none">
      {/* Custom Pixel Cursor */}
      <div 
        className="fixed pointer-events-none z-[9999] w-8 h-8"
        style={{ 
          left: screenMousePos.x, 
          top: screenMousePos.y,
          transform: 'translate(-2px, -2px)'
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0V18L5 13L8 19L11 17L8 11H14L0 0Z" fill="black" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Simulation Area */}
      <main className="flex-1 relative cursor-none touch-none overflow-hidden bg-black">
        <canvas 
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          className="w-full h-full block"
        />
        
        {/* Custom Pixel Cursor */}
        <div 
          className="pointer-events-none absolute border-2 border-white/80 rounded-full flex flex-col items-center justify-center transition-[width,height] duration-75"
          style={{
            left: (mousePos.x + 0.5) * (engineRef.current?.cellSize || 8),
            top: (mousePos.y + 0.5) * (engineRef.current?.cellSize || 8),
            width: (brushSize * 2 + 1) * (engineRef.current?.cellSize || 8),
            height: (brushSize * 2 + 1) * (engineRef.current?.cellSize || 8),
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 15px rgba(255,255,255,0.2), inset 0 0 5px rgba(255,255,255,0.2)',
            backgroundColor: selectedElement < 0 ? 'transparent' : ELEMENTS[selectedElement].color + '33',
            borderColor: selectedElement === 0 ? '#ff4444' : selectedElement === -1 ? '#ff8800' : selectedElement === -2 ? '#0088ff' : '#ffffff'
          }}
        >
          {/* Center Dot */}
          <div className="w-1 h-1 bg-white rounded-full opacity-50" />
          
          {/* Hover Temp Label */}
          <div className="absolute -top-6 bg-black/80 px-1 py-0.5 rounded text-[8px] border border-white/20 whitespace-nowrap">
            {hoverTemp}°C
          </div>
        </div>
      </main>

      {/* Retro UI Panel */}
      <div className="pixel-panel flex flex-col p-2 gap-2">
        {/* Top Info Bar */}
        <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono text-gray-400 border-b border-[#222] mb-1">
          <div className="flex gap-4">
            <span>x{mousePos.x}, y{mousePos.y}</span>
            <span>{fps}fps</span>
            <span className="text-orange-400">{hoverTemp}°C</span>
          </div>
          <div className="flex gap-4">
            <span className="text-orange-500 uppercase">Sandengine v1.0</span>
          </div>
        </div>

        {/* Main Controls Row */}
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => setIsPaused(!isPaused)} className={`pixel-btn ${isPaused ? 'bg-yellow-900 text-yellow-400' : 'bg-green-900 text-green-400'}`}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={clearGrid} className="pixel-btn bg-red-900 text-red-400">
            Reset
          </button>
          <button onClick={handleSave} className="pixel-btn bg-blue-900 text-blue-400">
            Save
          </button>
          <button onClick={handleLoad} className="pixel-btn bg-green-900 text-green-400">
            Load
          </button>
          <div className="flex items-center gap-2 bg-[#222] px-2 py-1 border-2 border-[#444]">
            <span className="text-[10px] text-gray-500">Brush:</span>
            <button onClick={() => setBrushSize(Math.max(1, brushSize - 1))} className="pixel-btn p-1 h-6 w-6">-</button>
            <span className="text-[12px] w-6 text-center">{brushSize}</span>
            <button onClick={() => setBrushSize(Math.min(15, brushSize + 1))} className="pixel-btn p-1 h-6 w-6">+</button>
          </div>
          <button onClick={() => setSelectedElement(0)} className={`pixel-btn ${selectedElement === 0 ? 'active' : 'bg-purple-900 text-purple-400'}`}>
            Erase
          </button>
          <button onClick={() => setSelectedElement(-1)} className={`pixel-btn ${selectedElement === -1 ? 'active' : 'bg-orange-900 text-orange-400'}`}>
            Heat
          </button>
          <button onClick={() => setSelectedElement(-2)} className={`pixel-btn ${selectedElement === -2 ? 'active' : 'bg-blue-900 text-blue-400'}`}>
            Cool
          </button>

          <div className="flex items-center gap-1 bg-[#222] px-2 py-1 border-2 border-[#444]">
            <span className="text-[10px] text-gray-500 uppercase">Mode:</span>
            <button 
              onClick={() => setIsReplaceMode(!isReplaceMode)} 
              className={`pixel-btn text-[10px] px-2 py-1 ${isReplaceMode ? 'bg-orange-900 text-orange-400' : 'bg-gray-800 text-gray-400'}`}
            >
              {isReplaceMode ? 'Replace: ON' : 'Replace: OFF'}
            </button>
          </div>

          <div className="flex items-center gap-1 bg-[#222] px-2 py-1 border-2 border-[#444]">
            <span className="text-[10px] text-gray-500 uppercase">Tool:</span>
            <button 
              onClick={() => setToolType('brush')} 
              className={`pixel-btn text-[10px] px-2 py-1 ${toolType === 'brush' ? 'active' : ''}`}
            >
              Brush
            </button>
            <button 
              onClick={() => setToolType('mix')} 
              className={`pixel-btn text-[10px] px-2 py-1 ${toolType === 'mix' ? 'active' : ''}`}
            >
              Mix
            </button>
            <button 
              onClick={() => setToolType('paint')} 
              className={`pixel-btn text-[10px] px-2 py-1 ${toolType === 'paint' ? 'active' : ''}`}
            >
              Paint
            </button>
            <button 
              onClick={() => setToolType('drag')} 
              className={`pixel-btn text-[10px] px-2 py-1 ${toolType === 'drag' ? 'active' : ''}`}
            >
              Drag
            </button>
          </div>
          
          {/* Search Bar */}
          <div className="flex items-center gap-2 bg-[#111] px-2 py-1 border-2 border-[#333] flex-1 max-w-xs">
            <Search size={12} className="text-gray-500" />
            <input 
              type="text" 
              placeholder="SEARCH..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-transparent border-none outline-none text-[10px] w-full placeholder:text-gray-700 uppercase"
            />
          </div>
        </div>

        {/* Category Row */}
        <div className="flex flex-wrap gap-1 mt-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`pixel-btn px-2 py-1 text-[10px] ${category === cat ? 'active' : 'bg-[#222] text-gray-400'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {category === 'Machine' && (
          <div className="mt-1 p-1 bg-[#1a1a1a] border border-[#333] text-[10px] text-gray-400 font-mono animate-pulse">
            <span className="text-yellow-500">GUIDE:</span> Connect <span className="text-green-500">BATTERY</span> to <span className="text-yellow-400">WIRE</span> to power machines. <span className="text-purple-500">CLONE WALL</span> duplicates elements on top of it when powered!
          </div>
        )}

        {/* Elements Grid Row */}
        <div className="flex-1 overflow-x-auto custom-scrollbar pb-2 mt-1">
          <div className="flex gap-2 min-w-max">
            {filteredElements.length > 0 ? (
              filteredElements.map(el => (
                <button
                  key={el.id}
                  onClick={() => setSelectedElement(el.id)}
                  className={`pixel-btn min-w-[80px] h-10 flex flex-col gap-1 ${selectedElement === el.id ? 'active' : ''}`}
                  style={{ 
                    backgroundColor: selectedElement === el.id ? '#fff' : el.color + '33',
                    borderColor: el.color,
                    color: selectedElement === el.id ? '#000' : el.color
                  }}
                >
                  <div className="w-full h-1" style={{ backgroundColor: el.color }} />
                  <span className="truncate w-full text-center">{el.name}</span>
                </button>
              ))
            ) : (
              <div className="text-[10px] text-gray-600 italic py-4 px-2">NO ELEMENTS FOUND...</div>
            )}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .pixel-btn {
          font-family: 'Press Start 2P', cursive;
        }
      `}} />
    </div>
  );
}
