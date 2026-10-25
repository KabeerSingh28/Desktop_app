import { useState } from 'react';
import { ReadinessScreen } from './components/ReadinessScreen.jsx';

function App() {
  const [examState, setExamState] = useState('readiness'); // 'readiness' | 'active'
  const [activeSession, setActiveSession] = useState(null);

  function handleStartExam({ candidateName, candidateId, session }) {
    setActiveSession({
      candidateName,
      candidateId,
      session,
      startedAt: new Date().toISOString(),
    });
    setExamState('active');
  }

  function handleExitExam() {
    setActiveSession(null);
    setExamState('readiness');
  }

  if (examState === 'active' && activeSession) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col">
        {/* Exam active header */}
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
            <div>
              <h1 className="text-base font-bold text-slate-100">Athena Examination in Progress</h1>
              <p className="text-xs text-slate-400">
                Candidate: <span className="text-slate-200 font-semibold">{activeSession.candidateName}</span> ({activeSession.candidateId})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono bg-slate-700 px-3 py-1.5 rounded text-slate-300">
              Session: {activeSession.session?.sessionId || 'DEMO-LOCAL'}
            </span>
            <button
              onClick={handleExitExam}
              className="text-xs px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white font-semibold rounded transition"
            >
              Exit Session
            </button>
          </div>
        </header>

        {/* Placeholder for question navigation & proctoring pipeline in next phase */}
        <main className="flex-1 max-w-4xl w-full mx-auto p-8 flex flex-col justify-center items-center text-center space-y-6">
          <div className="p-8 bg-slate-800/80 border border-slate-700 rounded-2xl max-w-lg space-y-4">
            <div className="text-4xl">📝</div>
            <h2 className="text-xl font-bold text-white">Active Examination Session Initialized</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Preflight checks and proctoring consent were successfully verified.
              The exam session is officially registered with the authoritative backend.
            </p>
            <div className="bg-slate-900/60 p-4 rounded-xl text-left text-xs font-mono space-y-1.5 text-slate-300">
              <p>Session ID: <span className="text-emerald-400">{activeSession.session?.sessionId || 'N/A'}</span></p>
              <p>Total Questions: <span className="text-blue-400">{activeSession.session?.totalQuestions || '2'}</span></p>
              <p>Deadline: <span className="text-amber-400">{activeSession.session?.deadlineEpoch ? new Date(activeSession.session.deadlineEpoch).toLocaleTimeString() : 'Calculated by Backend'}</span></p>
            </div>
            <p className="text-xs text-slate-400">
              Next phase: Automated Snapshot Proctoring & Question Navigation Interface.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return <ReadinessScreen onStartExam={handleStartExam} />;
}

export default App;
