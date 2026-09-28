import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWebSocket, Candidate, RoomState } from '../hooks/useWebSocket';

const tailwindScript = '<script src="https://cdn.tailwindcss.com"></script>';

function buildIframeSrcDoc(candidate: Candidate): string {
  const html = candidate.html.trim();
  const hasTailwind = /cdn\.tailwindcss\.com/i.test(html);
  const headAssets = `${candidate.css.trim() ? `<style>${candidate.css}</style>` : ''}${hasTailwind ? '' : tailwindScript}`;
  if (/<html[\s>]/i.test(html)) {
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${headAssets}`);
    }
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${headAssets}</head>`);
  }
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${headAssets}
      </head>
      <body style="margin:0;padding:0">${html}</body>
    </html>
  `;
}

export function StudentPage({ roomCode }: { roomCode: string }) {
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [showVotePanel, setShowVotePanel] = useState(true);
  const [scores, setScores] = useState({ coherence: 3, effort: 3, originality: 3 });
  const [hasVoted, setHasVoted] = useState(false);
  const [timer, setTimer] = useState(0);

  const { isConnected, state, send } = useWebSocket({
    roomCode,
    role: 'student',
    studentId: studentId || undefined,
    onStateChange: (newState) => {
      if (newState.phase === 'voting') {
        setHasVoted(newState.students.find(s => s.id === studentId)?.hasVoted || false);
      } else if (newState.phase === 'tiebreak') {
        setHasVoted(false);
      }
    },
  });

  useEffect(() => {
    if (isConnected && pendingName && studentId) {
      send({ type: 'join', payload: { name: pendingName } });
      setHasJoined(true);
      setPendingName(null);
    }
  }, [isConnected, pendingName, studentId, send]);

  const handleJoin = () => {
    if (!studentName.trim()) return;
    const id = Math.random().toString(36).substring(2, 10);
    setStudentId(id);
    setPendingName(studentName);
  };

  const generateIframeSrcDoc = (candidate: Candidate | undefined): string => {
    if (!candidate) return '<html><body style="background:#000;margin:0;padding:0"></body></html>';
    return buildIframeSrcDoc(candidate);
  };

  const iframeSrc = useMemo(() => {
    const candidate = state?.candidates[state?.currentIndex || 0];
    if (!candidate) return undefined;
    if (candidate.css.trim() === '' && /^<iframe\b/i.test(candidate.html.trim())) {
      const match = candidate.html.match(/src=["']([^"']+)["']/);
      if (match) return match[1];
    }
    return undefined;
  }, [state?.candidates, state?.currentIndex]);

  const iframeSrcDoc = useMemo(() => generateIframeSrcDoc(state?.candidates[state?.currentIndex || 0]), [state?.candidates, state?.currentIndex]);

  const handleVote = () => {
    if (!studentId || !state?.candidates[state?.currentIndex || 0]) return;
    const candidate = state.candidates[state.currentIndex || 0];
    send({ type: 'vote', payload: { studentId, candidateId: candidate.id, scores } });
    setHasVoted(true);
  };

  const handleRank = (order: string[]) => {
    if (!studentId) return;
    send({ type: 'rank', payload: { studentId, order } });
  };

  useEffect(() => {
    if (!state?.timerEnd) return;
    const timerEnd = state.timerEnd;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
      setTimer(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [state?.timerEnd]);

  if (!hasJoined || !isConnected) {
    return (
      <div className="login-page min-h-screen flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-6">Unirse al Concurso</h1>
          {!pendingName ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tu nombre / apodo</label>
                <input
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                  placeholder="Escribe tu nombre"
                  autoFocus
                />
              </div>
              <button
                onClick={handleJoin}
                disabled={!studentName.trim()}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-lg"
              >
                Unirse
              </button>
            </div>
          ) : (
            <div className="text-center py-8">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="text-4xl mb-4">🔌</motion.div>
              <p className="text-gray-700 font-medium">Conectando al servidor...</p>
              <p className="text-gray-500 text-sm mt-2">Espera un momento</p>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  const currentCandidate = state?.candidates[state?.currentIndex || 0];
  const isVotingPhase = state?.phase === 'voting';
  const isTiebreakPhase = state?.phase === 'tiebreak';
  const isPodiumPhase = state?.phase === 'podium';

  if (isPodiumPhase) {
    return <PodiumView state={state!} />;
  }

  if (isTiebreakPhase) {
    return (
      <TiebreakView
        state={state!}
        onRank={handleRank}
        timer={timer}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      <div className="absolute inset-0 w-full h-full">
        <iframe
          key={iframeSrc ? `url-${iframeSrc}` : `srcdoc-${iframeSrcDoc.slice(0, 50)}`}
          src={iframeSrc}
          srcDoc={iframeSrc ? undefined : iframeSrcDoc}
          title="Página del participante"
          sandbox={iframeSrc ? "allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups" : "allow-scripts allow-same-origin allow-forms allow-pointer-lock"}
          className="absolute inset-0 w-full h-full border-0"
          style={{ width: '100vw', height: '100vh' }}
        />
      </div>

      {!isVotingPhase && !isTiebreakPhase && !isPodiumPhase && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex items-center justify-center bg-black/80 z-50">
          <div className="text-center text-white p-8">
            <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="text-6xl mb-4">⏳</motion.div>
            <h2 className="text-2xl font-semibold mb-2">Esperando al profesor...</h2>
            <p className="text-gray-300">La votación comenzará pronto</p>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {isVotingPhase && currentCandidate && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-black/90 via-black/70 to-transparent"
          >
            <div className="max-w-4xl mx-auto p-4">
              <div className="flex items-center justify-between mb-4 text-white">
                <div>
                  <p className="text-lg font-semibold">{currentCandidate.name}</p>
                  <p className="text-sm text-gray-300">Participante {state!.currentIndex + 1} de {state!.candidates.length}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="bg-black/50 px-4 py-2 rounded-lg font-mono text-xl">
                    {timer}s
                  </div>
                  <button
                    onClick={() => setShowVotePanel(!showVotePanel)}
                    className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                    aria-label={showVotePanel ? 'Ocultar votación' : 'Mostrar votación'}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showVotePanel ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                    </svg>
                  </button>
                </div>
              </div>

              {!hasVoted && showVotePanel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 mb-4">
                  <h3 className="text-white font-semibold mb-4">Votación (1-5 estrellas)</h3>
                  <div className="grid grid-cols-3 gap-6">
                    {[
                      { key: 'coherence', label: 'Coherencia', icon: '🎯' },
                      { key: 'effort', label: 'Esfuerzo', icon: '💪' },
                      { key: 'originality', label: 'Originalidad', icon: '✨' },
                    ].map(({ key, label, icon }) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-300">{icon} {label}</span>
                          <span className="text-white font-bold">{scores[key as keyof typeof scores]}</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          value={scores[key as keyof typeof scores]}
                          onChange={(e) => setScores(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                          className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleVote}
                    className="mt-6 w-full py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors text-lg"
                  >
                    Enviar voto
                  </button>
                </motion.div>
              )}

              {hasVoted && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-green-500/20 backdrop-blur-sm rounded-xl p-4 text-center mb-4">
                  <div className="flex items-center justify-center gap-3 text-white">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-lg font-medium">¡Voto enviado! Esperando al siguiente participante...</span>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TiebreakView({ state, onRank, timer }: { state: RoomState; onRank: (order: string[]) => void; timer: number }) {
  const [order] = useState<string[]>(state.candidates.map(c => c.id));
  const [hasRanked, setHasRanked] = useState(false);

  const submitRanking = () => {
    onRank(order);
    setHasRanked(true);
  };

  const candidateMap = new Map(state.candidates.map(c => [c.id, c]));

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      <div className="p-4 bg-black/80 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-white text-xl font-semibold">Ronda de Desempate</h2>
          <p className="text-gray-300">Ordena de mejor a peor</p>
        </div>
        <div className="bg-black/50 px-4 py-2 rounded-lg font-mono text-xl text-white">{timer}s</div>
      </div>

      <div className="flex-1 overflow-x-auto p-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-4 min-w-max" style={{ minWidth: `${state.candidates.length * 320}px` }}>
          {order.map((candidateId, index) => {
            const candidate = candidateMap.get(candidateId);
            if (!candidate) return null;
            return (
              <motion.div
                key={candidateId}
                layout
                className="relative w-80 flex-shrink-0 bg-white rounded-xl shadow-lg overflow-hidden"
                style={{ height: 'calc(100vh - 120px)' }}
              >
                <div className="absolute top-3 left-3 right-3 flex justify-between z-10">
                  <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-medium">
                    #{index + 1}
                  </span>
                  <span className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                    {candidate.name}
                  </span>
                </div>
                 <iframe
                   key={`tiebreak-${candidate.id}`}
                   src={candidate.css.trim() === '' && /^<iframe\b/i.test(candidate.html.trim()) ? (candidate.html.match(/src=["']([^"']+)["']/)?.[1]) : undefined}
                   srcDoc={candidate.css.trim() === '' && /^<iframe\b/i.test(candidate.html.trim()) ? undefined : buildIframeSrcDoc(candidate)}
                   className="w-full h-full border-0"
                   sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
                 />
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="p-4 bg-black/80 border-t border-gray-700">
        <button
          onClick={submitRanking}
          disabled={hasRanked}
          className={`w-full py-3 rounded-lg font-semibold text-lg transition-colors ${
            hasRanked ? 'bg-gray-600 text-gray-300 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {hasRanked ? 'Orden enviado ✓' : 'Enviar ordenación'}
        </button>
      </div>
    </div>
  );
}

function PodiumView({ state }: { state: RoomState }) {
  const scores = state.finalScores || {};
  const sorted = [...state.candidates].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));

  return (
    <div className="podium-page fixed inset-0 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <motion.h1 initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-4xl md:text-6xl font-bold text-white mb-8 text-center">
        🏆 Podio Final 🏆
      </motion.h1>

      <div className="flex items-end gap-4 md:gap-8 mb-12">
        {sorted.slice(0, 3).map((candidate, index) => (
          <motion.div
            key={candidate.id}
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.2 }}
            className="flex flex-col items-center"
          >
            <div className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center font-bold text-4xl md:text-5xl text-white ${[
              'bg-yellow-400 shadow-[0_0_30px_rgba(255,215,0,0.5)]',
              'bg-gray-300 shadow-[0_0_30px_rgba(150,150,150,0.5)]',
              'bg-amber-700 shadow-[0_0_30px_rgba(205,127,50,0.5)]',
            ][index]}`}>
              {index + 1}
            </div>
            <div className={`mt-4 w-40 h-40 md:w-48 md:h-48 rounded-xl overflow-hidden bg-white/10 border-2 ${[
              'border-yellow-400',
              'border-gray-400',
              'border-amber-700',
            ][index]}`}>
               <iframe
                 key={`podium-3-${candidate.id}`}
                 src={candidate.css.trim() === '' && /^<iframe\b/i.test(candidate.html.trim()) ? (candidate.html.match(/src=["']([^"']+)["']/)?.[1]) : undefined}
                 srcDoc={candidate.css.trim() === '' && /^<iframe\b/i.test(candidate.html.trim()) ? undefined : buildIframeSrcDoc(candidate)}
                 className="w-full h-full border-0"
                 sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
               />
            </div>
            <p className="mt-3 text-white font-semibold text-lg text-center">{candidate.name}</p>
            <p className="text-yellow-300 font-medium">Puntuación: {(scores[candidate.id] || 0).toFixed(1)}</p>
          </motion.div>
        ))}
      </div>

      {sorted.length > 3 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-3xl">
          <h2 className="text-2xl font-bold text-white mb-4 text-center">Clasificación General</h2>
          <ul className="space-y-3">
            {sorted.slice(3).map((candidate, index) => (
              <motion.li
                key={candidate.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + index * 0.1 }}
                className="flex items-center gap-4 p-4 bg-white/10 rounded-xl border border-white/20"
              >
                <span className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-white">
                  {index + 4}
                </span>
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                  <iframe
                    key={`podium-rest-${candidate.id}`}
                    src={candidate.css.trim() === '' && /^<iframe\b/i.test(candidate.html.trim()) ? (candidate.html.match(/src=["']([^"']+)["']/)?.[1]) : undefined}
                    srcDoc={candidate.css.trim() === '' && /^<iframe\b/i.test(candidate.html.trim()) ? undefined : buildIframeSrcDoc(candidate)}
                    className="w-full h-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{candidate.name}</p>
                  <p className="text-gray-300 text-sm">Puntuación: {(scores[candidate.id] || 0).toFixed(1)}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </motion.div>
      )}
    </div>
  );
}
