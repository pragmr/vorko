import React, { useState, useRef, useEffect } from 'react';
import { officeLayout, officeObjects, OFFICE_BACKGROUND_IMAGE } from '../data/officeData';

// Throttle pan updates to once per frame to avoid flooding React on mobile
function useThrottledPan(initialPan) {
  const [pan, setPan] = useState(initialPan);
  const panRef = useRef(initialPan);
  const rafIdRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const setPanThrottled = (next) => {
    if (typeof next === 'function') {
      pendingRef.current = next;
    } else {
      pendingRef.current = () => next;
    }
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const fn = pendingRef.current;
      pendingRef.current = null;
      if (fn) setPan(fn(panRef.current));
    });
  };

  return [pan, setPanThrottled];
}

const OfficeGrid = ({ currentRoom, children, onDoubleClickTile }) => {
  const currentLayout = officeLayout[currentRoom] || officeLayout['main-office'];
  const currentObjects = officeObjects[currentRoom] || officeObjects['main-office'];
  const useImageBackground = Boolean(OFFICE_BACKGROUND_IMAGE);
  
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useThrottledPan({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  
  const gridRef = useRef(null);
  const touchDraggingRef = useRef(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const gridMinWidth = isMobile ? 320 : 960;
  const gridMinHeight = isMobile ? 400 : 800;

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.5, Math.min(3, zoom * delta));
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomRatio = newZoom / zoom;
    const newPanX = mouseX - (mouseX - panRef.current.x) * zoomRatio;
    const newPanY = mouseY - (mouseY - panRef.current.y) * zoomRatio;
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const handleMouseDown = (e) => {
    if (e.button === 0) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      touchDraggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = { x: e.touches[0].clientX - panRef.current.x, y: e.touches[0].clientY - panRef.current.y };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 1 && touchDraggingRef.current) {
      e.preventDefault();
      setPan({
        x: e.touches[0].clientX - dragStartRef.current.x,
        y: e.touches[0].clientY - dragStartRef.current.y
      });
    }
  };

  const handleTouchEnd = () => {
    touchDraggingRef.current = false;
    setIsDragging(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const renderOfficeObject = (obj) => {
    const baseStyle = {
      position: 'absolute',
      left: `${obj.x * 3.33}%`,
      top: `${obj.y * 4}%`,
      width: '3.33%',
      height: '4%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      zIndex: 10
    };

    switch (obj.type) {
      case 'desk-wood':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object desk-wood">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', position: 'relative' }}>
              <div style={{ fontSize: '14px', marginBottom: '1px' }}>🖥️</div>
              {obj.hasComputer && <div style={{ fontSize: '10px' }}>💻</div>}
              {obj.hasMonitor && <div style={{ fontSize: '12px', position: 'absolute', top: '1px', left: '50%', transform: 'translateX(-50%)' }}>🖥️</div>}
              {obj.hasKeyboard && <div style={{ fontSize: '8px', position: 'absolute', bottom: '1px', left: '1px' }}>⌨️</div>}
              {obj.hasMouse && <div style={{ fontSize: '8px', position: 'absolute', bottom: '1px', right: '1px' }}>🖱️</div>}
              {obj.hasPlant && <div style={{ fontSize: '8px', position: 'absolute', top: '1px', right: '1px' }}>🌱</div>}
              {obj.hasLamp && <div style={{ fontSize: '8px', position: 'absolute', top: '1px', left: '1px' }}>💡</div>}
              {obj.hasCoffee && <div style={{ fontSize: '8px', position: 'absolute', bottom: '1px', left: '1px' }}>☕</div>}
              {obj.hasNotebook && <div style={{ fontSize: '8px', position: 'absolute', bottom: '1px', right: '1px' }}>📓</div>}
              {obj.hasPhone && <div style={{ fontSize: '8px', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>📱</div>}
              {obj.hasBooks && <div style={{ fontSize: '8px', position: 'absolute', bottom: '1px', right: '1px' }}>📚</div>}
            </div>
          </div>
        );
      
      case 'office-chair':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object office-chair">
            🪑
          </div>
        );
      
      case 'kitchen-counter':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object kitchen-counter">
            🍽️
          </div>
        );
      
      case 'sink':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object sink">
            🚰
          </div>
        );
      
      case 'refrigerator':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object refrigerator">
            🧊
          </div>
        );
      
      case 'coffee-machine':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object coffee-machine">
            ☕
          </div>
        );
      
      case 'microwave':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object microwave">
            🔥
          </div>
        );
      
      case 'lounge-sofa':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object lounge-sofa">
            🛋️
          </div>
        );
      
      case 'coffee-table':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object coffee-table">
            🫖
          </div>
        );
      
      case 'lounge-chair':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object lounge-chair">
            🪑
          </div>
        );
      
      case 'plant-large':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object plant-large">
            🌳
          </div>
        );
      
      case 'window':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object window">
            🪟
          </div>
        );
      
      case 'conference-table':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object conference-table">
            🗣️
          </div>
        );
      
      case 'conference-chair':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object conference-chair">
            🪑
          </div>
        );
      
      case 'filing-cabinet':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object filing-cabinet">
            📁
          </div>
        );
      
      case 'printer':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object printer">
            🖨️
          </div>
        );
      
      case 'water-cooler':
        return (
          <div key={`${obj.type}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object water-cooler">
            💧
          </div>
        );
      
      default:
        return (
          <div key={`${obj.type || 'obj'}-${obj.x}-${obj.y}`} style={baseStyle} className="office-object">
            📦
          </div>
        );
    }
  };

  return (
    <div className="office-grid-container">
      {/* Zoom Controls - docked to top center, compact with tooltip titles */}
      <div className="zoom-controls">
        <button title="Zoom in" onClick={() => setZoom(Math.min(3, zoom + 0.2))} className="zoom-btn">+</button>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        <button title="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom - 0.2))} className="zoom-btn">−</button>
        <button title="Reset view" onClick={resetView} className="reset-btn">⌂</button>
      </div>

      {/* Office Grid with Characters */}
      <div 
        ref={gridRef}
        className={`office-grid ${useImageBackground ? 'office-grid--image-bg' : ''}`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${currentLayout.grid[0].length}, 1fr)`,
          gridTemplateRows: `repeat(${currentLayout.grid.length}, 1fr)`,
          width: '100%',
          maxHeight: '100%',
          aspectRatio: `${currentLayout.grid[0].length} / ${currentLayout.grid.length}`,
          minWidth: gridMinWidth,
          minHeight: gridMinHeight,
          position: 'relative',
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          transformOrigin: '0 0',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none'
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={(e) => {
          if (!gridRef.current) return;
          const rect = gridRef.current.getBoundingClientRect();
          const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
          const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
          const xPx = (clientX - rect.left - pan.x) / zoom;
          const yPx = (clientY - rect.top - pan.y) / zoom;
          const cols = currentLayout.grid[0].length;
          const rows = currentLayout.grid.length;
          const tileW = rect.width / cols;
          const tileH = rect.height / rows;
          const tx = Math.max(0, Math.min(cols - 1, Math.floor(xPx / tileW)));
          const ty = Math.max(0, Math.min(rows - 1, Math.floor(yPx / tileH)));
          onDoubleClickTile?.({ x: tx, y: ty });
        }}
      >
        {/* Office image only in floor area so wall stays visible around it */}
        {useImageBackground && (
          <div
            className="office-floor-bg"
            style={{
              position: 'absolute',
              /* Floor area = room interior; inset by one tile (wall) on each side */
              left: `${(1 / currentLayout.grid[0].length) * 100}%`,
              top: `${(1 / currentLayout.grid.length) * 100}%`,
              right: `${(1 / currentLayout.grid[0].length) * 100}%`,
              bottom: `${(1 / currentLayout.grid.length) * 100}%`,
              backgroundImage: `url(${OFFICE_BACKGROUND_IMAGE})`,
              /* Size image to match room (floor) size exactly */
              backgroundSize: '100% 100%',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              pointerEvents: 'none',
              zIndex: 0
            }}
          />
        )}
        {currentLayout.grid.map((row, y) =>
          row.map((tile, x) => (
            <div
              key={`${x}-${y}`}
              className={`office-tile ${tile === 'W' ? 'wall' : 'floor'} ${useImageBackground && tile !== 'W' ? 'office-tile--transparent' : ''}`}
            />
          ))
        )}
        
        {!useImageBackground && (
          <div className="office-objects">
            {currentObjects.map(obj => renderOfficeObject(obj))}
          </div>
        )}

        {/* Characters Container - Now part of the zoomable area */}
        <div className="characters-container">
          {children}
        </div>
      </div>
    </div>
  );
};

export default OfficeGrid;
