import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode.react';
import { useWebSocket, Candidate } from '../hooks/useWebSocket';

interface CandidateFormData {
  name: string;
  mode: 'url' | 'code' | 'files';
  url: string;
  html: string;
  css: string;
  htmlFile: File | null;
  cssFile: File | null;
}

export function AdminPage({ roomCode, onBack }: { roomCode: string; onBack: () => void }) {
  const navigate = useNavigate();
  const STORAGE_KEY = 'webpagevs_candidates';
  
  const [candidates, setCandidates] = useState<Candidate[]>(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(candidates));
  }, [candidates]);

  const [currentCandidate, setCurrentCandidate] = useState<CandidateFormData>({
    name: '',
    mode: 'url',
    url: '',
    html: '',
    css: '',
    htmlFile: null,
    cssFile: null,
  });
  const [roundDuration, setRoundDuration] = useState(5);
  const [showQR, setShowQR] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [adminId] = useState(() => Math.random().toString(36).substring(2, 10));
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());

  const { isConnected, state, send } = useWebSocket({
    roomCode: roomCode || undefined,
    role: 'admin',
    adminId,
    onStateChange: (newState) => {
      if (newState.phase === 'waiting') setShowQR(true);
      if (roomCode && newState.candidates.length > 0) setCandidates(newState.candidates);
    },
    onMessage: (message) => {
      if (message.type === 'room_closed') {
        sessionStorage.removeItem('roomUrl');
        navigate('/');
      }
    },
  });

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleModeChange = (mode: CandidateFormData['mode']) => {
    setCurrentCandidate(prev => ({ ...prev, mode }));
  };

  const handleFileChange = (type: 'html' | 'css', file: File) => {
    setCurrentCandidate(prev => ({ ...prev, [`${type}File`]: file }));
    const reader = new FileReader();
    reader.onload = (e) => {
      setCurrentCandidate(prev => ({ ...prev, [type]: e.target?.result as string }));
    };
    reader.readAsText(file);
  };

  const resetCandidateForm = () => {
    setEditingCandidateId(null);
    setCurrentCandidate({
      name: '', mode: 'url', url: '', html: '', css: '', htmlFile: null, cssFile: null,
    });
  };

  const getCandidateContent = () => {
    let html = currentCandidate.html;
    let css = currentCandidate.css;
    
    if (currentCandidate.mode === 'url' && currentCandidate.url) {
      html = `<iframe src="${currentCandidate.url}" style="width:100%;height:100%;border:none;"></iframe>`;
      css = '';
    }

    return { html, css };
  };

  const addCandidate = useCallback(() => {
    if (!currentCandidate.name.trim() || (roomCode && state?.phase !== 'waiting')) return;
    const { html, css } = getCandidateContent();

    if (editingCandidateId) {
      setCandidates(prev => prev.map(candidate => candidate.id === editingCandidateId
        ? { ...candidate, name: currentCandidate.name.trim(), html, css }
        : candidate));
      if (roomCode && isConnected) {
        send({ type: 'update_candidate', payload: {
          candidateId: editingCandidateId, name: currentCandidate.name.trim(), html, css,
        }});
      }
      resetCandidateForm();
      return;
    }

    const newCandidate: Candidate = {
      id: Math.random().toString(36).substring(2, 10),
      name: currentCandidate.name.trim(),
      html,
      css,
    };
    setCandidates(prev => [...prev, newCandidate]);

    if (roomCode && isConnected) {
      send({ type: 'add_candidate', payload: { name: newCandidate.name, html, css } });
    }

    resetCandidateForm();
  }, [currentCandidate, editingCandidateId, roomCode, state?.phase, isConnected, send]);

  const editCandidate = (candidate: Candidate) => {
    if (roomCode && state?.phase !== 'waiting') return;
    const iframeUrl = candidate.html.match(/^<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
    setEditingCandidateId(candidate.id);
    setCurrentCandidate({
      name: candidate.name,
      mode: iframeUrl && !candidate.css ? 'url' : 'code',
      url: iframeUrl || '',
      html: iframeUrl && !candidate.css ? '' : candidate.html,
      css: candidate.css,
      htmlFile: null,
      cssFile: null,
    });
  };

  const removeCandidate = (id: string) => {
    if (roomCode && state?.phase !== 'waiting') return;
    setCandidates(prev => prev.filter(c => c.id !== id));
    if (roomCode && isConnected) {
      send({ type: 'remove_candidate', payload: { candidateId: id } });
    }
  };

  const generateRoom = useCallback(async () => {
    if (candidates.length === 0) return;
    
    setIsLoading(true);
    try {
      const res = await fetch('/api/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundDuration,
          candidates: candidates.map(({ name, html, css }) => ({ name, html, css })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const newRoomCode = data.roomCode;
        const newRoomUrl = data.roomUrl;
        // Store roomUrl in sessionStorage for the new page to use.
        sessionStorage.setItem('roomUrl', newRoomUrl);
        navigate(`/admin/${newRoomCode}`);
      }
    } catch (e) {
      console.error('Error creating room:', e);
    } finally {
      setIsLoading(false);
    }
  }, [candidates.length, roundDuration, navigate]);

  const copyLink = () => {
    const url = sessionStorage.getItem('roomUrl') || `${window.location.origin}/student/${roomCode}`;
    navigator.clipboard.writeText(url);
  };

  const handleAdminAction = (action: string) => {
    send({ type: action, payload: {} });
  };

  const closeRoom = () => {
    if (!roomCode || !window.confirm('Se cerrará la sala y los alumnos serán desconectados. La cola quedará disponible para crear otra sala. ¿Continuar?')) return;
    handleAdminAction('close_room');
  };

  const exportResults = () => {
    if (!state) return;
    const scores = state.finalScores || {};
    const sorted = [...state.candidates].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
    const csv = ['Participante,Puntuación', ...sorted.map(c => `${c.name},${scores[c.id] || 0}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resultados-${roomCode}.csv`;
    a.click();
  };

  const saveQueue = () => {
    const data = JSON.stringify(candidates.map(c => ({ name: c.name, html: c.html, css: c.css })), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cola-${roomCode || 'local'}.json`;
    a.click();
  };

  const loadQueue = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const loaded = JSON.parse(event.target?.result as string);
        const newCandidates: Candidate[] = loaded.map((c: any) => ({
          id: Math.random().toString(36).substring(2, 10),
          name: c.name,
          html: c.html,
          css: c.css,
        }));
        setCandidates(newCandidates);
        if (roomCode && isConnected) {
          newCandidates.forEach((c: Candidate) => {
            send({ type: 'add_candidate', payload: { name: c.name, html: c.html, css: c.css } });
          });
        }
      } catch (err) {
        console.error('Error loading queue:', err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="admin-page min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
          <div>
            <p className="premium-kicker mb-1">WebPageVS / Control docente</p>
            <h1 className="text-3xl font-bold text-gray-900">Panel del Profesor</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className={isConnected ? 'text-green-600' : 'text-red-600'}>
              <span className="status-dot" />{isConnected ? 'Conectado' : 'Desconectado'}
            </span>
            {roomCode && <button onClick={closeRoom} className="px-4 py-2 text-rose-700 hover:bg-rose-50 rounded-lg font-medium">Cerrar sala</button>}
            <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900 rounded-lg">Salir</button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">{editingCandidateId ? 'Editar participante' : 'Añadir participante'}</h2>
                      <p className="text-sm text-gray-500 mt-1">{roomCode && state?.phase !== 'waiting' ? 'La cola está bloqueada durante el concurso' : 'Prepara la siguiente página de la cola'}</p>
                    </div>
                    {editingCandidateId && <button onClick={resetCandidateForm} className="text-sm text-gray-500 hover:text-gray-900">Cancelar</button>}
                  </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del participante</label>
                  <input
                    type="text"
                    value={currentCandidate.name}
                    onChange={(e) => setCurrentCandidate(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Ej: Juan Pérez"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Modo de carga</label>
                  <div className="flex gap-4">
                    {['url', 'code', 'files'].map(mode => (
                      <label key={mode} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="mode"
                          value={mode}
                          checked={currentCandidate.mode === mode}
                          onChange={() => handleModeChange(mode as any)}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        <span className="capitalize">{mode === 'url' ? 'URL' : mode === 'code' ? 'Código HTML/CSS' : 'Archivos .html/.css'}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {currentCandidate.mode === 'url' && (
                    <motion.div key="url" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">URL de la página</label>
                      <input
                        type="url"
                        value={currentCandidate.url}
                        onChange={(e) => setCurrentCandidate(prev => ({ ...prev, url: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="https://ejemplo.com"
                      />
                    </motion.div>
                  )}
                  {currentCandidate.mode === 'code' && (
                    <motion.div key="code" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">HTML</label>
                        <textarea
                          value={currentCandidate.html}
                          onChange={(e) => setCurrentCandidate(prev => ({ ...prev, html: e.target.value }))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                          rows={10}
                          placeholder="<html>...</html>"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CSS</label>
                        <textarea
                          value={currentCandidate.css}
                          onChange={(e) => setCurrentCandidate(prev => ({ ...prev, css: e.target.value }))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                          rows={6}
                          placeholder="body { ... }"
                        />
                      </div>
                    </motion.div>
                  )}
                  {currentCandidate.mode === 'files' && (
                    <motion.div key="files" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Archivo HTML</label>
                        <input
                          type="file"
                          accept=".html,.htm"
                          onChange={(e) => e.target.files?.[0] && handleFileChange('html', e.target.files[0])}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Archivo CSS</label>
                        <input
                          type="file"
                          accept=".css"
                          onChange={(e) => e.target.files?.[0] && handleFileChange('css', e.target.files[0])}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  onClick={addCandidate}
                  disabled={!currentCandidate.name.trim() || (Boolean(roomCode) && state?.phase !== 'waiting')}
                  className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {editingCandidateId ? 'Guardar cambios' : 'Añadir participante'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Participantes ({candidates.length})</h2>
              {candidates.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No hay participantes aún</p>
              ) : (
                <ul className="space-y-3">
                  {candidates.map((candidate, index) => (
                    <motion.li
                      key={candidate.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center gap-4">
                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold">
                          {index + 1}
                        </span>
                        <div>
                          <span className="font-medium text-gray-900">{candidate.name}</span>
                          <span className="block text-xs text-gray-500">Página {index + 1}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                      <button onClick={() => editCandidate(candidate)} disabled={Boolean(roomCode) && state?.phase !== 'waiting'} className="px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-40" aria-label={`Editar ${candidate.name}`}>Editar</button>
                      <button onClick={() => removeCandidate(candidate.id)} disabled={Boolean(roomCode) && state?.phase !== 'waiting'} className="text-red-600 hover:text-red-800 p-2 disabled:opacity-40" aria-label={`Eliminar ${candidate.name}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Configuración</h2>
                <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tiempo por ronda (minutos)</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={roundDuration}
                    onChange={(e) => setRoundDuration(parseInt(e.target.value) || 1)}
                    className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={generateRoom}
                  disabled={candidates.length === 0 || isLoading}
                  className="px-6 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? 'Generando...' : 'Generar Sala'}
                </button>
                <button onClick={saveQueue} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                  Guardar cola
                </button>
                <label className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
                  Cargar cola
                  <input type="file" accept=".json" onChange={loadQueue} className="hidden" />
                </label>
              </div>
            </div>

            {roomCode && state && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Control del Concurso</h2>
                    <p className="text-sm text-gray-500 mt-1">{state.phase === 'waiting' ? 'La sala está lista para comenzar.' : state.phase === 'voting' ? 'Gestiona la ronda activa.' : 'La votación ha terminado.'}</p>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">{state.phase === 'waiting' ? 'En espera' : state.phase === 'voting' ? 'Votando' : 'Finalizado'}</span>
                </div>
                <div className="flex flex-wrap gap-4">
                  {state.phase === 'waiting' && <button onClick={() => handleAdminAction('start_voting')} disabled={state.candidates.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Iniciar votación</button>}
                  {state.phase === 'voting' && <>
                    <button onClick={() => handleAdminAction(state.timerEnd ? 'pause_timer' : 'resume_timer')} className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">{state.timerEnd ? 'Pausar reloj' : 'Continuar reloj'}</button>
                    <button onClick={() => handleAdminAction('next_candidate')} disabled={state.currentIndex >= state.candidates.length - 1} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">Siguiente</button>
                    <button onClick={() => handleAdminAction('skip_candidate')} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700">Saltar</button>
                    <button onClick={() => handleAdminAction('end_voting')} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Finalizar votación</button>
                  </>}
                  {state.phase === 'podium' && <button onClick={exportResults} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">Exportar resultados</button>}
                </div>
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">Fase</p>
                    <p className="font-semibold capitalize">{state.phase}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">Participante actual</p>
                    <p className="font-semibold">{state.candidates[state.currentIndex]?.name || '-'}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">Votantes</p>
                    <p className="font-semibold">{state.students.filter(s => s.hasVoted).length} / {state.students.length}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">Tiempo restante</p>
                    <p className="font-semibold">
                      {state.timerEnd ? `${Math.max(0, Math.ceil((state.timerEnd - clock) / 1000))} s` : state.phase === 'voting' ? 'Pausado' : '-'}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
            {showQR && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 text-center">Unirse a la Sala</h2>
                <div className="space-y-4">
                  <div className="flex flex-col items-center">
                    <QRCode value={sessionStorage.getItem('roomUrl') || `${window.location.origin}/student/${roomCode}`} size={200} bgColor="#ffffff" fgColor="#000000" />
                    <p className="text-sm text-gray-500 mt-2">Escanea el código QR</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 break-all">
                    {sessionStorage.getItem('roomUrl') || `${window.location.origin}/student/${roomCode}`}
                  </div>
                  <button onClick={copyLink} className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    Copiar enlace
                  </button>
                </div>
              </div>
            )}
            {!roomCode && !showQR && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                <p className="text-gray-500 mb-4">Añade participantes y genera la sala para obtener el enlace y código QR</p>
                <div className="text-sm text-gray-400">
                  Los participantes se guardan localmente hasta generar la sala
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}