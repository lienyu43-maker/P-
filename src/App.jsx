import React, { useState, useRef, useEffect, useMemo } from 'react';

// --- 原生 IndexedDB 本地数据库封装 ---
const DB_NAME = 'PTypeRescueDB';
const STORE_NAME = 'timelines_v2'; 
const DB_VERSION = 3;

let dbInstance = null;

const initDB = () => {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => { console.error("IndexedDB error:", event.target.error); reject(event.target.error); };
    request.onsuccess = (event) => { 
      dbInstance = event.target.result;
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance); 
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      }
      if (oldVersion < 3) {
        const store = event.target.transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains('order')) {
          store.createIndex('order', 'order', { unique: false });
        }
      }
    };
  });
};

const dbHelper = {
  async put(data) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(data);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async get(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async getAll() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async getAllByOrder() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('order');
      const results = [];
      const request = index.openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async delete(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
};

// --- 常量配置 ---
const PIXELS_PER_MINUTE = 0.85; 
const MINS_PER_HOUR = 60;
const HOUR_WIDTH = MINS_PER_HOUR * PIXELS_PER_MINUTE; 
const SNAP_MINS = 5; 
const BASE_Y = 160; 

const getSegmentColor = (index, total) => {
  const progress = index / Math.max(1, total - 1);
  const hue = 50 + progress * (230 - 50); 
  const sat = 90 - progress * 30;         
  const light = 85 - progress * 50;       
  return `hsl(${hue}, ${sat}%, ${light}%)`;
};

const pinCursorStyle = { cursor: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='%23ef4444' stroke='%23ef4444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='5'></circle><line x1='12' y1='13' x2='12' y2='22'></line></svg>") 12 22, crosshair` };

const formatMinsToTime = (mins) => {
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
};

// --- 主应用组件 ---
export default function App() {
  // --- 自动注入样式库 & 原生级横屏锁定方案 ---
  useEffect(() => {
    if (!document.getElementById('tailwind-cdn')) {
      const script = document.createElement('script');
      script.id = 'tailwind-cdn';
      script.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(script);
    }
    
    let metaViewport = document.querySelector('meta[name=viewport]');
    if (!metaViewport) {
      metaViewport = document.createElement('meta');
      metaViewport.name = 'viewport';
      document.head.appendChild(metaViewport);
    }
    metaViewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

    if (!document.getElementById('vite-reset')) {
      const style = document.createElement('style');
      style.id = 'vite-reset';
      style.innerHTML = `
        /* 基础重置 */
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; background-color: #fafaf9; overflow: hidden; overscroll-behavior: none; }
        
        /* 【原生级横屏锁定魔法】
           当设备处于竖屏 (portrait) 模式时：
           1. 我们强制将 #root 的宽高颠倒（宽变成屏幕高，高变成屏幕宽）。
           2. 以中心点为轴，强制旋转 90 度。
           3. 这样，UI 本身始终是横向布局的，用户看到侧躺的画面就会本能地把手机横过来。
        */
        #root { 
          position: absolute; 
          top: 0; left: 0; 
          width: 100vw; height: 100vh; 
          overflow: hidden; 
        }

        @media screen and (orientation: portrait) {
          #root {
            width: 100vh !important; 
            height: 100vw !important;
            transform-origin: top left;
            transform: rotate(90deg) translateY(-100%);
          }
        }

        @media (hover: none) and (pointer: coarse) {
          .mobile-no-cursor { cursor: default !important; }
        }

        /* 隐藏浏览器原生 TextArea 拉伸块，用我们的高亮 SVG 代替 */
        textarea::-webkit-resizer { display: none; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const [hoursCount, setHoursCount] = useState(16); 
  const [pins, setPins] = useState([]); 
  const [ranges, setRanges] = useState([]); 
  
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState('draft'); 
  const [activeRecordName, setActiveRecordName] = useState('当前草稿'); 
  const [historyList, setHistoryList] = useState([]); 
  
  const [showHistory, setShowHistory] = useState(false); 
  const [showGallery, setShowGallery] = useState(false); 

  const [ambientMessage, setAmbientMessage] = useState("点击扎下标记，按住并拖动可以直接画出一段时光。");
  const [activeZId, setActiveZId] = useState(null);

  const saveTimerRef = useRef(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const manifest = {
      name: "P人拯救计划",
      short_name: "P人计划",
      description: "只记录，不控制的时间线",
      start_url: ".",
      display: "standalone",
      orientation: "landscape", // 安装后系统级别强制横屏
      theme_color: "#fafaf9",
      background_color: "#fafaf9",
      icons: [
        { src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='192' height='192' viewBox='0 0 24 24' fill='%23ef4444' stroke='%23ef4444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='5'></circle><line x1='12' y1='13' x2='12' y2='22'></line></svg>", sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
        { src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 24 24' fill='%23ef4444' stroke='%23ef4444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='5'></circle><line x1='12' y1='13' x2='12' y2='22'></line></svg>", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }
      ]
    };
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link); }
    link.href = manifestUrl;

    const swCode = `
      self.addEventListener('install', e => { self.skipWaiting(); });
      self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
      self.addEventListener('fetch', e => {
        e.respondWith(fetch(e.request).catch(() => new Response('离线模式安全运行中', { headers: { 'Content-Type': 'text/plain;charset=utf-8' } })));
      });
    `;
    const swUrl = URL.createObjectURL(new Blob([swCode], { type: 'application/javascript' }));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(swUrl).catch(()=>{});

    const handleBeforeInstallPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return; deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { setDeferredPrompt(null); setAmbientMessage("正在安装到桌面..."); }
  };

  useEffect(() => {
    const initData = async () => {
      try {
        const draft = await dbHelper.get('draft');
        if (draft) { setPins(draft.pins || []); setRanges(draft.ranges || []); setHoursCount(draft.hoursCount || 16); }
        await loadHistoryList();
      } catch (e) { } finally { setIsLoaded(true); }
    };
    initData();
  }, []);

  const loadHistoryList = async () => { try { const all = await dbHelper.getAllByOrder(); setHistoryList(all.filter(a => a.id !== 'draft')); } catch (e) {} };

  useEffect(() => {
    if (!isLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        let currentOrder = Date.now(); 
        if (activeRecordId !== 'draft') {
           const existing = historyList.find(h => h.id === activeRecordId);
           if (existing && existing.order) currentOrder = existing.order;
        }
        await dbHelper.put({ id: activeRecordId, name: activeRecordId === 'draft' ? '当前草稿' : activeRecordName, pins, ranges, hoursCount, order: activeRecordId === 'draft' ? 0 : currentOrder });
      } catch (e) {}
    }, 1500); 
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [pins, ranges, hoursCount, activeRecordId, activeRecordName, isLoaded, historyList]);

  const trackRef = useRef(null); const containerRef = useRef(null); 
  const [isResizing, setIsResizing] = useState(false); const [connectingPin, setConnectingPin] = useState(null);
  const [trackDragState, setTrackDragState] = useState(null); const [dragCurrentPos, setDragCurrentPos] = useState({ x: 0, y: 0 });
  const [draggingLabel, setDraggingLabel] = useState(null); const [isNamingRecord, setIsNamingRecord] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); 

  const handleArchiveRecord = async (recordName) => {
    setAmbientMessage("正在归档...");
    try {
      const newId = Date.now().toString(); const maxOrder = historyList.length > 0 ? Math.max(...historyList.map(h => h.order || 0)) : 0;
      await dbHelper.put({ id: newId, name: recordName, pins, ranges, hoursCount, order: maxOrder + 1 });
      setAmbientMessage(`已封存为：「${recordName}」`); await loadHistoryList(); setIsNamingRecord(false);
      setTimeout(async () => { setPins([]); setRanges([]); setHoursCount(16); setActiveRecordId('draft'); setActiveRecordName('当前草稿'); await dbHelper.put({ id: 'draft', name: '当前草稿', pins: [], ranges: [], hoursCount: 16, order: 0 }); }, 1500);
    } catch (error) { setIsNamingRecord(false); }
  };

  const handleLoadHistory = async (id, name) => {
    try { const record = await dbHelper.get(id); if (record) { setPins(record.pins || []); setRanges(record.ranges || []); setHoursCount(record.hoursCount || 16); setActiveRecordId(id); setActiveRecordName(name); setShowHistory(false); setShowGallery(false); setAmbientMessage(`正在翻阅：「${name}」`); } } catch (e) { }
  };

  const handleBackToDraft = async () => {
    try { const draft = await dbHelper.get('draft'); setPins(draft?.pins || []); setRanges(draft?.ranges || []); setHoursCount(draft?.hoursCount || 16); setActiveRecordId('draft'); setActiveRecordName('当前草稿'); setShowHistory(false); setShowGallery(false); setConfirmDeleteId(null); setAmbientMessage("回到了草稿。"); } catch (e) { }
  };

  const handleDeleteHistory = async (id, e) => {
    e.stopPropagation(); e.preventDefault(); 
    try { await dbHelper.delete(id); setConfirmDeleteId(null); if (activeRecordId === id) await handleBackToDraft(); else await loadHistoryList(); } catch (err) { }
  };

  const getRelativePos = (clientX, clientY) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    
    // 【旋转坐标系修复】: 因为 CSS 做了 90 度旋转，点击坐标需要反向映射
    const isPortrait = window.innerHeight > window.innerWidth;
    if (isPortrait) {
      // 竖屏旋转后：屏幕的 Y 对应内容的 X，屏幕的 X 对应内容的 Y
      const actualX = clientY - rect.top;
      const actualY = (window.innerWidth - clientX) - rect.left;
      return { x: actualX, y: actualY };
    }
    
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const getMinsFromPointerX = (clientX, clientY) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const isPortrait = window.innerHeight > window.innerWidth;
    const x = isPortrait ? (clientY - rect.top) : (clientX - rect.left);
    return Math.round((x / PIXELS_PER_MINUTE) / SNAP_MINS) * SNAP_MINS; 
  };

  const handleTrackPointerDown = (e) => {
    if (e.target.closest('.interactive-element')) return;
    e.target.setPointerCapture(e.pointerId);
    const mins = getMinsFromPointerX(e.clientX, e.clientY);
    const constrainedMins = Math.max(0, Math.min(hoursCount * 60, mins));
    setTrackDragState({ startMins: constrainedMins, currentMins: constrainedMins });
    setActiveZId(null); 
  };

  const handlePinPointerDown = (pin, e) => {
    e.stopPropagation(); e.target.setPointerCapture(e.pointerId);
    setConnectingPin(pin); setDragCurrentPos(getRelativePos(e.clientX, e.clientY));
  };

  const handleLabelPointerDown = (item, type, e) => {
    e.stopPropagation(); e.preventDefault(); e.target.setPointerCapture(e.pointerId);
    const pos = getRelativePos(e.clientX, e.clientY);
    setDraggingLabel({ id: item.id, type: type, startX: pos.x, startY: pos.y, startOffsetX: item.offset?.x || 0, startOffsetY: item.offset?.y || (type === 'pin' ? -50 : -45) });
  };

  const handlePointerMove = (e) => {
    const pos = getRelativePos(e.clientX, e.clientY);
    const mins = getMinsFromPointerX(e.clientX, e.clientY);

    if (trackDragState) {
      setTrackDragState(prev => ({ ...prev, currentMins: Math.max(0, Math.min(hoursCount * 60, mins)) })); return;
    }
    if (draggingLabel) {
      const dx = pos.x - draggingLabel.startX; const dy = pos.y - draggingLabel.startY;
      if (draggingLabel.type === 'pin') setPins(pins.map(p => p.id === draggingLabel.id ? { ...p, offset: { x: draggingLabel.startOffsetX + dx, y: draggingLabel.startOffsetY + dy } } : p));
      else if (draggingLabel.type === 'range') setRanges(ranges.map(r => r.id === draggingLabel.id ? { ...r, offset: { x: draggingLabel.startOffsetX + dx, y: draggingLabel.startOffsetY + dy } } : r));
      return;
    }
    if (isResizing) { setHoursCount(Math.max(4, Math.min(24, Math.round(mins / 15) * 0.25))); return; }
    if (connectingPin) setDragCurrentPos(pos);
  };

  const handlePointerUp = (e) => {
    try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}
    
    if (trackDragState) {
      const { startMins, currentMins } = trackDragState;
      if (Math.abs(currentMins - startMins) < 10) {
        const newId = Date.now().toString(); setPins([...pins, { id: newId, time: startMins, text: '', timeLabel: '', offset: { x: 0, y: -50 } }]); setActiveZId(newId);
      } else {
        const newId = Date.now().toString(); setRanges([...ranges, { id: newId, startTime: Math.min(startMins, currentMins), endTime: Math.max(startMins, currentMins), text: '', timeLabel: '', offset: { x: 0, y: -45 } }]); setActiveZId(newId);
      }
      setTrackDragState(null); return;
    }
    if (draggingLabel) { setDraggingLabel(null); return; }
    if (isResizing) { setIsResizing(false); }
    if (connectingPin) {
      const dropMins = getMinsFromPointerX(e.clientX, e.clientY);
      const targetPin = pins.find(p => p.id !== connectingPin.id && Math.abs(p.time - dropMins) <= 15);
      if (targetPin) {
        const newId = Date.now().toString(); setRanges([...ranges, { id: newId, startTime: Math.min(connectingPin.time, targetPin.time), endTime: Math.max(connectingPin.time, targetPin.time), text: connectingPin.text || targetPin.text || '', timeLabel: '', offset: { x: 0, y: -45 } }]); setPins(pins.filter(p => p.id !== connectingPin.id && p.id !== targetPin.id)); setActiveZId(newId);
      } else { setAmbientMessage("需要拖拽到另一个标记的针头上，才能连起来。"); }
      setConnectingPin(null);
    }
  };

  const updatePinText = (id, text) => setPins(pins.map(p => p.id === id ? { ...p, text } : p));
  const updatePinTimeLabel = (id, timeLabel) => setPins(pins.map(p => p.id === id ? { ...p, timeLabel } : p));
  const updateRangeText = (id, text) => setRanges(ranges.map(r => r.id === id ? { ...r, text } : r));
  const updateRangeTimeLabel = (id, timeLabel) => setRanges(ranges.map(r => r.id === id ? { ...r, timeLabel } : r));
  const deletePin = (id) => { setPins(pins.filter(p => p.id !== id)); };
  const deleteRange = (id) => { setRanges(ranges.filter(r => r.id !== id)); };

  const leveledRanges = useMemo(() => {
    const sorted = [...ranges].sort((a, b) => a.startTime - b.startTime); const tracks = [];
    return sorted.map(range => { let l = 0; while (tracks[l] !== undefined && tracks[l] > range.startTime - 15) l++; tracks[l] = range.endTime; return { ...range, level: l }; });
  }, [ranges]);

  const timeLabelLevels = useMemo(() => {
    const items = [ ...pins.map(p => ({ id: p.id, type: 'pin', center: p.time })), ...ranges.map(r => ({ id: r.id, type: 'range', center: (r.startTime + r.endTime) / 2 })) ].sort((a, b) => a.center - b.center);
    const tracks = []; const levelsMap = {}; items.forEach(item => { let l = 0; while (tracks[l] !== undefined && tracks[l] > item.center - 45) l++; tracks[l] = item.center; levelsMap[item.id] = l; }); return levelsMap;
  }, [pins, ranges]);

  const totalWidth = hoursCount * HOUR_WIDTH; const renderHours = Math.ceil(hoursCount); 
  const galleryRecords = useMemo(() => [{ id: 'draft', name: '当前草稿', pins, ranges, hoursCount }, ...historyList], [pins, ranges, hoursCount, historyList]);

  return (
    <div 
      className="flex flex-col w-full h-full bg-stone-50 text-stone-800 font-sans selection:bg-stone-200 select-none overflow-hidden relative"
      onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onPointerCancel={handlePointerUp}
    >
      <header className="px-6 py-4 flex justify-between items-center opacity-70 shrink-0 z-40">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHistory(true)} className="p-2 -ml-2 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition-colors interactive-element" title="文字列表">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          </button>
          <button onClick={() => setShowGallery(true)} className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition-colors interactive-element" title="视觉画廊">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </button>
          {deferredPrompt && (
            <button onClick={handleInstallPWA} className="ml-2 px-3 py-1 bg-stone-800 text-stone-100 text-xs rounded-full hover:bg-stone-700 transition-colors shadow-sm interactive-element flex items-center gap-1 animate-in fade-in" title="将应用安装到桌面">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> 安装为 App
            </button>
          )}
          <h1 className="text-sm font-medium tracking-wide text-stone-500 uppercase flex items-center gap-2 ml-2">
            P人计划 {activeRecordId !== 'draft' && <span className="bg-stone-200 text-stone-600 px-2 py-0.5 rounded-full text-[10px] ml-2 tracking-normal normal-case truncate max-w-[100px]">{activeRecordName}</span>}
          </h1>
        </div>
      </header>

      {showGallery && <VisualGallery records={galleryRecords} activeId={activeRecordId} onSelect={(id, name) => id === 'draft' ? handleBackToDraft() : handleLoadHistory(id, name)} onClose={() => setShowGallery(false)} />}
      {showHistory && (
        <div className="absolute inset-0 z-50 flex">
          <div className="w-64 bg-stone-100 shadow-2xl h-full flex flex-col animate-in slide-in-from-left duration-300 interactive-element">
             <div className="p-6 pb-2 border-b border-stone-200 flex justify-between items-center">
              <h2 className="text-sm font-medium text-stone-500 tracking-widest uppercase">记忆库</h2>
              <button onClick={() => setShowHistory(false)} className="text-stone-400 hover:text-stone-600 interactive-element"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              <button onClick={handleBackToDraft} className={`text-left px-3 py-2 rounded-md text-sm transition-colors interactive-element ${activeRecordId === 'draft' ? 'bg-stone-300 text-stone-800 font-medium' : 'text-stone-600 hover:bg-stone-200'}`}>📝 当前草稿</button>
              <div className="mt-2 space-y-1">
                {historyList.map(item => (
                  <div key={item.id} className={`flex justify-between items-center group/item px-2 py-1.5 rounded-md text-sm transition-colors interactive-element bg-transparent hover:bg-stone-200 ${activeRecordId === item.id ? 'bg-stone-200/80 font-medium' : ''}`}>
                    <button onClick={() => handleLoadHistory(item.id, item.name)} className={`flex-1 text-left truncate px-1 ${activeRecordId === item.id ? 'text-stone-800' : 'text-stone-500'}`}>{item.name}</button>
                    {confirmDeleteId === item.id ? (
                      <div className="flex items-center gap-1 animate-in fade-in duration-200">
                        <button onPointerDown={(e) => handleDeleteHistory(item.id, e)} className="text-red-500 text-[10px] hover:bg-red-100 px-1.5 py-0.5 rounded transition-colors interactive-element">确认</button>
                        <button onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmDeleteId(null); }} className="text-stone-400 text-[10px] hover:bg-stone-200 px-1.5 py-0.5 rounded transition-colors interactive-element">取消</button>
                      </div>
                    ) : (
                      <button onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmDeleteId(item.id); }} className="text-stone-400 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-opacity ml-1 p-1 interactive-element"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex-1 bg-stone-900/10 backdrop-blur-[1px] animate-in fade-in duration-300 interactive-element" onClick={() => setShowHistory(false)} />
        </div>
      )}

      <main className={`flex-1 relative w-full overflow-hidden flex flex-col ${showGallery ? 'invisible' : 'visible'}`}>
        <div className="w-full h-full overflow-x-auto overflow-y-hidden custom-scrollbar outline-none" ref={trackRef}>
          <div className="relative h-[320px] mx-12 min-w-[800px]" ref={containerRef} style={{ width: `${totalWidth + 120}px` }}>
            
            <div className="absolute left-0 w-full z-0 mobile-no-cursor touch-none" style={{ top: `${BASE_Y}px`, height: '40px', transform: 'translateY(-50%)', ...pinCursorStyle }} onPointerDown={handleTrackPointerDown} />

            {trackDragState && (
              <div className="absolute z-50 pointer-events-none flex flex-col items-center transition-none" style={{ left: `${trackDragState.currentMins * PIXELS_PER_MINUTE}px`, top: `${BASE_Y - 80}px`, bottom: '0', width: '2px' }}>
                <div className="w-[2px] h-full bg-red-400 opacity-60" />
                <div className="absolute top-[10px] bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded shadow-md font-mono whitespace-nowrap">{formatMinsToTime(trackDragState.currentMins)}</div>
              </div>
            )}

            {trackDragState && Math.abs(trackDragState.currentMins - trackDragState.startMins) >= 10 && (
              (() => {
                const start = Math.min(trackDragState.startMins, trackDragState.currentMins); const end = Math.max(trackDragState.startMins, trackDragState.currentMins); const leftPos = start * PIXELS_PER_MINUTE; const width = (end - start) * PIXELS_PER_MINUTE;
                return (
                  <div className="absolute -translate-y-1/2 z-20 pointer-events-none opacity-40 transition-none" style={{ left: `${leftPos}px`, width: `${width}px`, top: `${BASE_Y - 16}px` }}>
                    <div className="absolute top-0 -translate-y-1/2 w-full flex items-center"><div className="w-[2px] h-[14px] bg-stone-700 rounded-sm" /><div className="flex-1 h-[2px] bg-stone-700" /><div className="w-[2px] h-[14px] bg-stone-700 rounded-sm" /></div>
                  </div>
                );
              })()
            )}

            <svg className="absolute inset-0 w-full h-full pointer-events-none z-50 overflow-visible">{connectingPin && (<line x1={connectingPin.time * PIXELS_PER_MINUTE} y1={BASE_Y - 16} x2={dragCurrentPos.x} y2={dragCurrentPos.y} stroke="#a8a29e" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" />)}</svg>

            <div className="absolute -translate-y-1/2 flex h-1 rounded-full overflow-hidden shadow-inner pointer-events-none" style={{ top: `${BASE_Y}px`, width: `${totalWidth}px` }}>
              {Array.from({ length: renderHours }).map((_, i) => { const segmentWidth = Math.min(1, hoursCount - i) * HOUR_WIDTH; return <div key={`ribbon-${i}`} className="h-full" style={{ width: `${segmentWidth}px`, backgroundColor: getSegmentColor(i, Math.max(16, renderHours)) }} />; })}
            </div>

            <svg className="absolute -translate-y-1/2 pointer-events-none overflow-visible z-10" style={{ top: `${BASE_Y}px`, width: `${totalWidth}px`, height: '20px', left: 0 }}>
              {Array.from({ length: renderHours + 1 }).map((_, i) => {
                const hourX = Math.round(i * HOUR_WIDTH); if (i > hoursCount) return null;
                const sub1X = Math.round(hourX + 15 * PIXELS_PER_MINUTE); const sub2X = Math.round(hourX + 30 * PIXELS_PER_MINUTE); const sub3X = Math.round(hourX + 45 * PIXELS_PER_MINUTE);
                return (
                  <g key={`tick-${i}`}>
                    <line x1={hourX} y1="4" x2={hourX} y2="16" stroke="#a8a29e" strokeWidth="2" strokeLinecap="round" />
                    {i + 0.25 <= hoursCount && <line x1={sub1X} y1="10" x2={sub1X} y2="10.01" stroke="#d6d3d1" strokeWidth="2" strokeLinecap="round" />}
                    {i + 0.50 <= hoursCount && <line x1={sub2X} y1="10" x2={sub2X} y2="10.01" stroke="#d6d3d1" strokeWidth="2" strokeLinecap="round" />}
                    {i + 0.75 <= hoursCount && <line x1={sub3X} y1="10" x2={sub3X} y2="10.01" stroke="#d6d3d1" strokeWidth="2" strokeLinecap="round" />}
                  </g>
                );
              })}
            </svg>

            <div className="absolute -translate-y-1/2 flex items-center justify-center cursor-ew-resize group z-30 interactive-element" style={{ top: `${BASE_Y}px`, left: `${Math.round(totalWidth)}px` }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setIsResizing(true); }}>
              {isResizing && <div className="absolute -top-8 bg-stone-800 text-stone-100 text-xs px-2 py-1 rounded shadow-md whitespace-nowrap animate-in fade-in zoom-in duration-150 pointer-events-none">{hoursCount} 段</div>}
              <div className={`w-3 h-6 border rounded-sm transition-colors flex items-center justify-center ${isResizing ? 'bg-stone-200 border-stone-500 scale-110' : 'bg-stone-100 border-stone-300 group-hover:border-stone-500 group-hover:bg-stone-200'}`}><div className="w-[2px] h-2 bg-stone-400 rounded-full" /></div>
            </div>

            <div className="absolute -translate-y-1/2 flex items-center z-40 interactive-element" style={{ top: `${BASE_Y}px`, left: `${totalWidth + 32}px` }}>
              {!isNamingRecord ? (
                <button onClick={(e) => { e.stopPropagation(); setIsNamingRecord(true); }} className="w-8 h-8 flex items-center justify-center text-stone-400 hover:text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-full transition-all duration-300 shadow-sm interactive-element" title="归档保存"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg></button>
              ) : (
                <div className="flex flex-col items-start gap-1 animate-in slide-in-from-left-2 duration-200 bg-stone-50/80 backdrop-blur p-2 rounded-md shadow-sm -ml-2"><ArchiveDateInput onSave={(val) => handleArchiveRecord(val)} onCancel={() => setIsNamingRecord(false)} /></div>
              )}
            </div>

            {leveledRanges.map(range => {
              const leftPos = range.startTime * PIXELS_PER_MINUTE; const width = (range.endTime - range.startTime) * PIXELS_PER_MINUTE; const topPos = BASE_Y - 16 - range.level * 45; const offset = range.offset || { x: 0, y: -45 }; const tLevel = timeLabelLevels[range.id] || 0; const relativeTimeTop = BASE_Y + 12 + (tLevel * 24) - topPos;
              return (
                <div key={range.id} onPointerDownCapture={() => setActiveZId(range.id)} className={`absolute -translate-y-1/2 group transition-all duration-300 interactive-element ${activeZId === range.id ? 'z-50' : 'z-30'}`} style={{ left: `${leftPos}px`, width: `${width}px`, top: `${topPos}px` }}>
                  <div className="absolute top-0 -translate-y-1/2 w-full flex items-center group-hover:opacity-80 transition-opacity z-20"><div className="w-[2px] h-[14px] bg-stone-700 rounded-sm touch-none" /><div className="flex-1 h-[2px] bg-stone-700 touch-none" /><div className="w-[2px] h-[14px] bg-stone-700 rounded-sm touch-none" /></div>
                  <div className="absolute left-1/2 top-0" style={{ width: 0, height: 0 }}>
                    <svg className="absolute overflow-visible pointer-events-none" style={{ left: 0, top: 0, zIndex: -1 }}><line x1={0} y1={0} x2={offset.x} y2={offset.y} stroke="#a8a29e" strokeDasharray="4 3" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    <div className="absolute flex flex-col items-center group/label z-10 touch-none" style={{ left: `${offset.x}px`, top: `${offset.y}px`, transform: 'translate(-50%, -50%)' }}>
                      <div className="flex flex-col items-center">
                        <div className="w-12 h-3 bg-stone-200/90 border border-stone-300/60 border-b-0 rounded-t-md cursor-move flex justify-center items-center touch-none backdrop-blur-sm shadow-sm" onPointerDown={(e) => handleLabelPointerDown(range, 'range', e)}><div className="w-4 h-0.5 bg-stone-400 rounded-full" /></div>
                        <div className="relative flex justify-center items-center">
                          <EventInput text={range.text} onChange={(t) => updateRangeText(range.id, t)} placeholder="记录时光" />
                          <button onPointerDown={(e) => { e.stopPropagation(); deleteRange(range.id); }} className="absolute -right-7 top-1/2 -translate-y-1/2 text-stone-300 hover:text-red-400 opacity-0 group-hover/label:opacity-100 transition-opacity p-1 interactive-element"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute flex flex-col items-center group/time z-10 transition-all duration-300" style={{ left: '50%', top: relativeTimeTop, transform: 'translateX(-50%)' }}><TimeInput text={range.timeLabel} onChange={(t) => updateRangeTimeLabel(range.id, t)} placeholder="时间" /></div>
                </div>
              );
            })}

            {pins.map(pin => {
              const leftPos = pin.time * PIXELS_PER_MINUTE; const isConnecting = connectingPin?.id === pin.id; const offset = pin.offset || { x: 0, y: -50 }; const tLevel = timeLabelLevels[pin.id] || 0;
              return (
                <div key={pin.id} onPointerDownCapture={() => setActiveZId(pin.id)} className={`absolute interactive-element transition-all duration-300 ${activeZId === pin.id ? 'z-50' : 'z-40'}`} style={{ top: `${BASE_Y}px`, left: `${leftPos}px` }}>
                  <svg className="absolute overflow-visible pointer-events-none" style={{ left: 0, top: 0, zIndex: -1 }}><line x1={0} y1={-16} x2={offset.x} y2={offset.y} stroke="#a8a29e" strokeDasharray="4 3" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <div className="absolute flex flex-col items-center group/label z-10 touch-none" style={{ left: `${offset.x}px`, top: `${offset.y}px`, transform: 'translate(-50%, -50%)' }}>
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-3 bg-stone-200/90 border border-stone-300/60 border-b-0 rounded-t-md cursor-move flex justify-center items-center touch-none backdrop-blur-sm shadow-sm" onPointerDown={(e) => handleLabelPointerDown(pin, 'pin', e)}><div className="w-4 h-0.5 bg-stone-400 rounded-full" /></div>
                      <div className="relative flex justify-center items-center">
                        <EventInput text={pin.text} onChange={(t) => updatePinText(pin.id, t)} placeholder="写点什么" />
                        <button onPointerDown={(e) => { e.stopPropagation(); deletePin(pin.id); }} className="absolute -right-7 top-1/2 -translate-y-1/2 text-stone-300 hover:text-red-500 opacity-0 group-hover/label:opacity-100 transition-opacity p-1 interactive-element"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                      </div>
                    </div>
                  </div>
                  <div className={`absolute w-6 h-6 rounded-full border-2 border-stone-50 cursor-grab active:cursor-grabbing hover:scale-125 transition-transform z-30 ${isConnecting ? 'bg-stone-800' : 'bg-red-500'} shadow-sm interactive-element touch-none`} style={{ left: 0, top: -16, transform: 'translate(-50%, -50%)' }} onPointerDown={(e) => handlePinPointerDown(pin, e)}><div className="absolute inset-0 rounded-full bg-red-500 opacity-0 hover:opacity-20 scale-150 pointer-events-none" /></div>
                  <div className="absolute w-[2px] h-4 bg-stone-300 transition-colors z-0" style={{ left: 0, top: 0, transform: 'translate(-50%, -100%)' }} />
                  <div className="absolute flex flex-col items-center group/time z-10 transition-all duration-300" style={{ left: 0, top: 12 + (tLevel * 24), transform: 'translateX(-50%)' }}><TimeInput text={pin.timeLabel} onChange={(t) => updatePinTimeLabel(pin.id, t)} placeholder="时间" /></div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <footer className="px-8 pb-4 pt-2 flex justify-center items-center pointer-events-none shrink-0 z-40 bg-gradient-to-t from-stone-50 to-transparent">
        <p className="text-stone-400 italic text-xs transition-all duration-700 ease-in-out">{ambientMessage}</p>
      </footer>

      <style dangerouslySetInnerHTML={{__html: ` .custom-scrollbar::-webkit-scrollbar { height: 0px; background: transparent; } .interactive-element { cursor: default; } `}} />
    </div>
  );
}

// ============================
// 子组件区域
// ============================

function VisualGallery({ records, activeId, onSelect, onClose }) {
  const containerRef = useRef(null); const itemsRef = useRef([]); const [isDragging, setIsDragging] = useState(false); const [startY, setStartY] = useState(0); const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return; const containerCenter = containerRef.current.scrollTop + containerRef.current.clientHeight / 2;
      itemsRef.current.forEach((el) => {
        if (!el) return; const itemCenter = el.offsetTop + el.clientHeight / 2; const distance = Math.abs(containerCenter - itemCenter); const maxDist = containerRef.current.clientHeight / 1.5; const ratio = Math.max(0, 1 - distance / maxDist);
        el.style.transform = `scale(${0.85 + 0.15 * ratio})`; el.style.opacity = 0.3 + 0.7 * ratio; 
      });
    };
    const container = containerRef.current;
    if (container) { container.addEventListener('scroll', handleScroll); handleScroll(); setTimeout(() => { const activeIndex = records.findIndex(r => r.id === activeId); if (activeIndex >= 0 && itemsRef.current[activeIndex]) { itemsRef.current[activeIndex].scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 50); }
    return () => { if (container) container.removeEventListener('scroll', handleScroll); };
  }, [records, activeId]);

  return (
    <div className="absolute inset-0 z-50 bg-stone-50 flex flex-col animate-in fade-in zoom-in-95 duration-300">
      <header className="p-6 flex justify-between items-center bg-stone-50/80 backdrop-blur z-10 shrink-0"><h2 className="text-sm font-medium tracking-widest text-stone-500 uppercase">视觉画廊</h2><button onClick={onClose} className="p-2 text-stone-400 hover:text-stone-700 bg-stone-200/50 hover:bg-stone-200 rounded-full transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></header>
      <div ref={containerRef} className={`flex-1 overflow-y-auto no-scrollbar touch-pan-y ${isDragging ? '' : 'snap-y snap-mandatory'}`} onPointerDown={(e) => { setIsDragging(true); setStartY(e.clientY); setScrollTop(containerRef.current.scrollTop); }} onPointerMove={(e) => { if (isDragging) containerRef.current.scrollTop = scrollTop - (e.clientY - startY); }} onPointerUp={() => setIsDragging(false)} onPointerLeave={() => setIsDragging(false)}>
        <div className="h-[30vh]" />
        {records.map((record, index) => (
          <div key={record.id} ref={el => itemsRef.current[index] = el} className="snap-center shrink-0 w-full flex items-center justify-center py-8 transition-transform duration-100 origin-center" style={{ transform: 'scale(0.85)', opacity: 0.3 }}>
            <div onClick={() => onSelect(record.id, record.name)} className={`w-full max-w-5xl p-6 cursor-pointer group transition-all duration-300 rounded-3xl ${activeId === record.id ? 'bg-stone-200/40' : 'hover:bg-stone-200/30'}`}>
              <div className="flex justify-between items-end mb-4 px-6 opacity-40 group-hover:opacity-100 transition-opacity"><h3 className="text-xl font-medium tracking-wider text-stone-600">{record.name}</h3><span className="text-xs text-stone-400 font-mono">{record.pins?.length || 0} Pins · {record.ranges?.length || 0} Ranges</span></div>
              <MiniTimeline record={record} />
            </div>
          </div>
        ))}
        <div className="h-[40vh]" />
      </div>
    </div>
  );
}

function MiniTimeline({ record }) {
  const { pins = [], ranges = [], hoursCount = 16 } = record; const totalMins = Math.max(1, hoursCount * 60);
  const leveledRanges = useMemo(() => { const sorted = [...ranges].sort((a, b) => a.startTime - b.startTime); const tracks = []; return sorted.map(range => { let l = 0; while (tracks[l] !== undefined && tracks[l] > range.startTime - 15) l++; tracks[l] = range.endTime; return { ...range, level: l }; }); }, [ranges]);
  const timeLabelLevels = useMemo(() => { const items = [ ...pins.map(p => ({ id: p.id, type: 'pin', center: p.time })), ...ranges.map(r => ({ id: r.id, type: 'range', center: (r.startTime + r.endTime) / 2 })) ].sort((a, b) => a.center - b.center); const tracks = []; const levelsMap = {}; items.forEach(item => { let l = 0; while (tracks[l] !== undefined && tracks[l] > item.center - 45) l++; tracks[l] = item.center; levelsMap[item.id] = l; }); return levelsMap; }, [pins, ranges]);
  const BASE_Y = 160; 

  return (
    <div className="relative w-full h-[320px] pointer-events-none">
      <div className="absolute top-[160px] -translate-y-1/2 w-full flex h-1 rounded-full overflow-hidden opacity-50">{Array.from({ length: Math.ceil(hoursCount) }).map((_, i) => (<div key={i} className="flex-1 h-full" style={{ backgroundColor: getSegmentColor(i, Math.max(16, Math.ceil(hoursCount))) }} />))}</div>
      {leveledRanges.map(range => {
        const leftPct = (range.startTime / totalMins) * 100; const widthPct = ((range.endTime - range.startTime) / totalMins) * 100; const topPos = BASE_Y - 16 - range.level * 40; const offset = range.offset || { x: 0, y: -45 }; const tLevel = timeLabelLevels[range.id] || 0; const relativeTimeTop = BASE_Y + 12 + (tLevel * 24) - topPos;
        return (
          <div key={range.id} className="absolute -translate-y-1/2" style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: `${topPos}px` }}>
            <div className="absolute top-0 -translate-y-1/2 w-full flex items-center opacity-80"><div className="w-[2px] h-[10px] bg-stone-600 rounded-sm" /><div className="flex-1 h-[1.5px] bg-stone-600" /><div className="w-[2px] h-[10px] bg-stone-600 rounded-sm" /></div>
            <div className="absolute left-1/2 top-0" style={{ width: 0, height: 0 }}>
              <svg className="absolute overflow-visible" style={{ left: 0, top: 0, zIndex: -1 }}><line x1={0} y1={0} x2={offset.x} y2={offset.y} stroke="#a8a29e" strokeDasharray="3 3" strokeWidth="1" strokeLinecap="round" /></svg>
              {range.text && (<div className="absolute flex flex-col items-center z-10" style={{ left: `${offset.x}px`, top: `${offset.y}px`, transform: 'translate(-50%, -50%)' }}><div className="text-[11px] text-stone-700 bg-stone-100/90 backdrop-blur-sm px-2 py-1 rounded shadow-sm border border-stone-200/60 whitespace-nowrap max-w-[160px] truncate">{range.text}</div></div>)}
            </div>
            {range.timeLabel && (<div className="absolute flex flex-col items-center z-10" style={{ left: '50%', top: relativeTimeTop, transform: 'translateX(-50%)' }}><div className="text-[10px] text-stone-500 font-mono bg-stone-50 px-1.5 py-0.5 rounded shadow-sm border border-stone-200/50">{range.timeLabel}</div></div>)}
          </div>
        );
      })}
      {pins.map(pin => {
        const leftPct = (pin.time / totalMins) * 100; const offset = pin.offset || { x: 0, y: -50 }; const tLevel = timeLabelLevels[pin.id] || 0;
        return (
          <div key={pin.id} className="absolute top-[160px]" style={{ left: `${leftPct}%` }}>
            <svg className="absolute overflow-visible" style={{ left: 0, top: 0, zIndex: -1 }}><line x1={0} y1={-12} x2={offset.x} y2={offset.y} stroke="#a8a29e" strokeDasharray="3 3" strokeWidth="1" strokeLinecap="round" /></svg>
            {pin.text && (<div className="absolute flex flex-col items-center z-10" style={{ left: `${offset.x}px`, top: `${offset.y}px`, transform: 'translate(-50%, -50%)' }}><div className="text-[11px] text-stone-700 bg-stone-100/90 backdrop-blur-sm px-2 py-1 rounded shadow-sm border border-stone-200/60 whitespace-nowrap max-w-[160px] truncate">{pin.text}</div></div>)}
            <div className="absolute w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm" style={{ left: 0, top: -12, transform: 'translate(-50%, -50%)' }} /><div className="absolute w-[1.5px] h-3 bg-stone-300" style={{ left: 0, top: 0, transform: 'translate(-50%, -100%)' }} />
            {pin.timeLabel && (<div className="absolute flex flex-col items-center z-10" style={{ left: 0, top: 12 + (tLevel * 24), transform: 'translateX(-50%)' }}><div className="text-[10px] text-stone-500 font-mono bg-stone-50 px-1.5 py-0.5 rounded shadow-sm border border-stone-200/50">{pin.timeLabel}</div></div>)}
          </div>
        );
      })}
    </div>
  );
}

// 【UI 优化 5】: 带有明显缩放指示器的 EventInput
function EventInput({ text, onChange, placeholder }) {
  const [val, setVal] = useState(text);
  const handleBlur = () => { onChange(val); };
  return (
    <div className="relative inline-block group/input rounded-b-md shadow-sm border border-stone-200/60 overflow-hidden bg-stone-100/90 backdrop-blur-md">
      <textarea
        className="resize min-w-[80px] min-h-[40px] max-w-[300px] max-h-[200px] bg-transparent outline-none text-sm text-stone-700 placeholder-stone-400 text-center p-2 pb-3 leading-tight block interactive-element"
        placeholder={placeholder}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleBlur}
        onPointerDown={(e) => e.stopPropagation()} 
      />
      {/* 强化的拉伸指示器图标 */}
      <div className="absolute bottom-0 right-0 w-4 h-4 pointer-events-none flex justify-end items-end p-0.5 opacity-40 group-focus-within/input:opacity-80 transition-opacity">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M11 5 L11 11 L5 11" />
          <path d="M11 1 L11 11 L1 11" strokeOpacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

function TimeInput({ text, onChange, placeholder }) {
  const [isEditing, setIsEditing] = useState(false); const [val, setVal] = useState(text || ''); const inputRef = useRef(null);
  useEffect(() => { if (isEditing && inputRef.current) inputRef.current.focus(); }, [isEditing]);
  if (isEditing) { return (<input ref={inputRef} type="text" className="bg-stone-50 outline-none text-xs text-stone-600 text-center w-14 px-1 py-0.5 rounded border border-stone-200 shadow-sm font-mono interactive-element" placeholder={placeholder} value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => { setIsEditing(false); onChange(val); }} onKeyDown={(e) => { if (e.key === 'Enter') { setIsEditing(false); onChange(val); } }} onPointerDown={(e) => e.stopPropagation()} />); }
  return (<div className="text-[10px] cursor-text min-h-[20px] min-w-[32px] text-stone-500 whitespace-nowrap text-center px-1 py-0.5 rounded bg-stone-50 hover:bg-stone-100 border border-stone-200/50 shadow-sm transition-colors flex items-center justify-center font-mono interactive-element group/timebox" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}>{val || <span className="text-stone-400 opacity-50 group-hover/timebox:opacity-100 transition-opacity border-b border-stone-300 border-dashed">{placeholder}</span>}</div>);
}

function ArchiveDateInput({ onSave, onCancel }) {
  const today = new Date(); const defaultDateStr = `${today.getMonth() + 1}.${today.getDate()}`; const [val, setVal] = useState(defaultDateStr); const inputRef = useRef(null);
  useEffect(() => { if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, []);
  return (
    <div className="flex items-center gap-1">
      <input ref={inputRef} type="text" className="bg-transparent outline-none text-sm text-stone-600 text-center w-24 px-1 py-0.5 border-b-2 border-stone-400 border-dashed font-mono interactive-element placeholder-stone-300 focus:border-stone-600 transition-colors" placeholder={`日期 (如 ${defaultDateStr})`} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { if (val.trim()) onSave(val.trim()); else onCancel(); } if (e.key === 'Escape') onCancel(); }} onPointerDown={(e) => e.stopPropagation()} />
      <button onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); if (val.trim()) onSave(val.trim()); else onCancel(); }} className="p-1 rounded text-stone-400 hover:bg-stone-200 hover:text-emerald-600 transition-colors interactive-element" title="确认保存"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></button>
      <button onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onCancel(); }} className="p-1 rounded text-stone-400 hover:bg-stone-200 hover:text-red-500 transition-colors interactive-element" title="取消"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
    </div>
  );
}