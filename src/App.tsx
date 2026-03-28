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
  Search,
  Sparkles,
  Loader2,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SandEngine | null>(null);
  const [selectedElement, setSelectedElement] = useState<number>(2); // Default to Sand
  const [brushSize, setBrushSize] = useState<number>(2);
  const [isReplaceMode, setIsReplaceMode] = useState<boolean>(true);
  const [toolType, setToolType] = useState<'brush' | 'mix' | 'paint'>('brush');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMouseDown, setIsMouseDown] = useState<boolean>(false);
  const [category, setCategory] = useState<string>('Land');
  const [fps, setFps] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hoverTemp, setHoverTemp] = useState(20);
  
  // Search and AI states
  const [searchTerm, setSearchTerm] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [customElementIds, setCustomElementIds] = useState<number[]>([]);

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
      
      if (selectedElement >= 0) {
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

      if (isMouseDown && selectedElement >= 0) {
        applyTool(x, y);
      }
    }
  };

  const handleMouseUp = () => {
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

  const generateAIElement = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Create a new falling sand element based on this prompt: "${aiPrompt}". 
        Return a JSON object with: 
        - name: string
        - type: "solid", "powder", "liquid", "gas", "fire", or "special"
        - color: hex string
        - density: number (1-1000)
        - viscosity: number (0-1, optional for liquids)
        - friction: number (0-1, optional for powders)
        - flammability: number (0-1, optional)
        - longevity: number (optional for fire/gas)
        - dissolvable: boolean (optional)
        - conductive: boolean (optional)
        - temperature: number (optional)`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              type: { type: Type.STRING, enum: ["solid", "powder", "liquid", "gas", "fire", "special"] },
              color: { type: Type.STRING },
              density: { type: Type.NUMBER },
              viscosity: { type: Type.NUMBER },
              friction: { type: Type.NUMBER },
              flammability: { type: Type.NUMBER },
              longevity: { type: Type.NUMBER },
              dissolvable: { type: Type.BOOLEAN },
              conductive: { type: Type.BOOLEAN },
              temperature: { type: Type.NUMBER },
            },
            required: ["name", "type", "color", "density"]
          }
        }
      });

      const data = JSON.parse(response.text);
      const newId = Math.max(...Object.keys(ELEMENTS).map(Number)) + 1;
      
      const newElement: Element = {
        id: newId,
        ...data
      };

      ELEMENTS[newId] = newElement;
      setCustomElementIds(prev => [...prev, newId]);
      setSelectedElement(newId);
      setAiPrompt('');
      setCategory('AI');
    } catch (error) {
      console.error("AI Generation failed:", error);
    } finally {
      setIsGenerating(false);
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

  const categories = ['Land', 'Liquids', 'Life', 'Powders', 'Solids', 'Energy', 'Gases', 'Special', 'AI'];
  
  const filteredElements = Object.values(ELEMENTS).filter(el => {
    if (el.id === 0) return false;
    
    // Apply search filter first
    if (searchTerm && !el.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
    }

    if (category === 'AI') return customElementIds.includes(el.id);
    if (category === 'Land') return [2, 4, 37, 38, 39, 93, 94].includes(el.id);
    if (category === 'Liquids') return el.type === 'liquid';
    if (category === 'Powders') return el.type === 'powder' && ![2, 37, 38, 39].includes(el.id);
    if (category === 'Solids') return el.type === 'solid' && ![4, 93, 94].includes(el.id);
    if (category === 'Gases') return el.type === 'gas';
    if (category === 'Energy') return el.type === 'fire' || el.id === 28;
    if (category === 'Life') return [20, 21, 101, 102, 103, 104, 105, 106].includes(el.id);
    if (category === 'Special') return el.type === 'special' && ![20, 21, 101, 102, 103, 104, 105, 106].includes(el.id);
    return true;
  });

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden font-sans select-none">
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
          <div className="absolute -top-6 bg-black/80 px-1 py-0.5 rounded text-[6px] border border-white/20 whitespace-nowrap">
            {hoverTemp}°C
          </div>
        </div>
      </main>

      {/* Retro UI Panel */}
      <div className="pixel-panel flex flex-col p-2 gap-2">
        {/* Top Info Bar */}
        <div className="flex items-center justify-between px-2 py-1 text-[8px] font-mono text-gray-400 border-b border-[#222] mb-1">
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
            <span className="text-[8px] text-gray-500">Brush:</span>
            <button onClick={() => setBrushSize(Math.max(1, brushSize - 1))} className="pixel-btn p-1 h-6 w-6">-</button>
            <span className="text-[10px] w-6 text-center">{brushSize}</span>
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
            <span className="text-[8px] text-gray-500 uppercase">Mode:</span>
            <button 
              onClick={() => setIsReplaceMode(!isReplaceMode)} 
              className={`pixel-btn text-[8px] px-2 py-1 ${isReplaceMode ? 'bg-orange-900 text-orange-400' : 'bg-gray-800 text-gray-400'}`}
            >
              {isReplaceMode ? 'Replace: ON' : 'Replace: OFF'}
            </button>
          </div>

          <div className="flex items-center gap-1 bg-[#222] px-2 py-1 border-2 border-[#444]">
            <span className="text-[8px] text-gray-500 uppercase">Tool:</span>
            <button 
              onClick={() => setToolType('brush')} 
              className={`pixel-btn text-[8px] px-2 py-1 ${toolType === 'brush' ? 'active' : ''}`}
            >
              Brush
            </button>
            <button 
              onClick={() => setToolType('mix')} 
              className={`pixel-btn text-[8px] px-2 py-1 ${toolType === 'mix' ? 'active' : ''}`}
            >
              Mix
            </button>
            <button 
              onClick={() => setToolType('paint')} 
              className={`pixel-btn text-[8px] px-2 py-1 ${toolType === 'paint' ? 'active' : ''}`}
            >
              Paint
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
              className="bg-transparent border-none outline-none text-[8px] w-full placeholder:text-gray-700 uppercase"
            />
          </div>
        </div>

        {/* Category Row */}
        <div className="flex flex-wrap gap-1 mt-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`pixel-btn px-2 py-1 text-[7px] ${category === cat ? 'active' : 'bg-[#222] text-gray-400'}`}
            >
              {cat === 'AI' ? <Sparkles size={8} className="mr-1" /> : null}
              {cat}
            </button>
          ))}
        </div>

        {/* AI Generation Row */}
        {category === 'AI' && (
          <div className="flex gap-2 mt-1 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 bg-[#111] px-3 py-1 border-2 border-orange-900 flex-1">
              <Sparkles size={12} className="text-orange-500" />
              <input 
                type="text" 
                placeholder="DESCRIBE A NEW ELEMENT (E.G. 'GLOWING JELLY')..." 
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && generateAIElement()}
                className="bg-transparent border-none outline-none text-[8px] w-full placeholder:text-gray-700 uppercase"
              />
            </div>
            <button 
              onClick={generateAIElement}
              disabled={isGenerating || !aiPrompt.trim()}
              className="pixel-btn bg-orange-900 text-orange-400 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              <span className="ml-1">CREATE</span>
            </button>
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
              <div className="text-[8px] text-gray-600 italic py-4 px-2">NO ELEMENTS FOUND...</div>
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
