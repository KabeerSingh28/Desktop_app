import { useState, useRef, useEffect } from 'react';
import { ReadinessScreen } from './components/ReadinessScreen.jsx';
import { SessionEventTimeline } from './components/SessionEventTimeline.jsx';
import { EvidenceStatusBadge } from './components/EvidenceStatusBadge.jsx';
import { useProctoringEvents } from './hooks/useProctoringEvents.js';
import { useEvidenceCapture } from './hooks/useEvidenceCapture.js';
import { useWebcam } from './hooks/useWebcam.js';

function App() {
  const [examState, setExamState] = useState('readiness'); // 'readiness' | 'active'
  const [activeSession, setActiveSession] = useState(null);

  // Active exam webcam lifecycle manager
  const examCamera = useWebcam();
  const videoPreviewRef = useRef(null);

  // Connect active camera stream to video preview element
  useEffect(() => {
    const videoEl = videoPreviewRef.current;
    if (!videoEl) return;

    if (examCamera.stream) {
      videoEl.srcObject = examCamera.stream;
      videoEl.play().catch((err) => {
        console.warn('[app] Exam video.play() notice:', err?.message || err);
      });
    } else {
      videoEl.srcObject = null;
    }

    return () => {
      if (videoEl) videoEl.srcObject = null;
    };
  }, [examCamera.stream]);

  // Structured proctoring events hook
  const { events, recordEvent } = useProctoringEvents({
    sessionId: activeSession?.session?.sessionId,
    active: examState === 'active',
    cameraStatus: examCamera.status,
    cameraError: examCamera.error,
  });

  // Evidence capture module (periodic & event snapshots, optional video)
  const evidence = useEvidenceCapture({
    sessionId: activeSession?.session?.sessionId,
    stream: examCamera.stream,
    videoRef: videoPreviewRef,
    active: examState === 'active',
    consentAccepted: true,
    enablePeriodicSnapshots: true,
    snapshotIntervalMs: 60000,
    enableVideoRecording: false,
    onProctorEvent: recordEvent,
  });

  async function handleStartExam({ candidateName, candidateId, session }) {
    setActiveSession({
      candidateName,
      candidateId,
      session,
      startedAt: new Date().toISOString(),
    });
    setExamState('active');

    // Initialize proctoring camera stream for the active exam period
    try {
      await examCamera.startCamera();
    } catch (err) {
      console.warn('[app] Could not initialize exam webcam:', err);
    }

    // Ensure desktop window enters fullscreen for the active examination session
    if (window.athena?.enterFullscreen) {
      try {
        const res = await window.athena.enterFullscreen({ kiosk: false });
        if (!res?.ok) {
          console.warn('[app] Could not enter fullscreen on exam start:', res?.error);
        }
      } catch (err) {
        console.warn('[app] Error invoking enterFullscreen on exam start:', err);
      }
    }
  }

  async function handleExitExam() {
    // Attempt final submission snapshot before teardown
    try {
      await evidence.captureSnapshot('session:submit');
    } catch {
      // Non-fatal
    }

    // Shut down camera tracks completely
    examCamera.stopCamera();

    // Release locks and restore normal window presentation state
    if (window.athena?.cancelExamSession) {
      try {
        await window.athena.cancelExamSession();
      } catch (err) {
        console.warn('[app] Error cancelling exam session:', err);
      }
    } else if (window.athena?.restoreNormalState) {
      try {
        await window.athena.restoreNormalState();
      } catch (err) {
        console.warn('[app] Error restoring normal window state:', err);
      }
    }
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

        {/* Exam main workspace */}
        <main className="flex-1 max-w-4xl w-full mx-auto p-8 flex flex-col items-center space-y-6">
          {/* Visible Evidence Capture Status Banner */}
          <div className="w-full max-w-2xl">
            <EvidenceStatusBadge
              captureStatus={evidence.captureStatus}
              snapshotCount={evidence.snapshotCount}
              lastSnapshotTime={evidence.lastSnapshotTime}
              recordingDuration={evidence.recordingDuration}
              isVideoRecording={evidence.isVideoRecording}
              error={evidence.error}
              onManualCapture={() => evidence.captureSnapshot('manual')}
            />
          </div>

          <div className="p-8 bg-slate-800/80 border border-slate-700 rounded-2xl w-full max-w-2xl space-y-4 text-center">
            {/* Live Camera Preview Thumbnail */}
            <div className="flex justify-center mb-2">
              <div className="relative w-48 h-36 bg-slate-950 rounded-xl overflow-hidden border border-slate-700 shadow-inner flex items-center justify-center">
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {examCamera.status !== 'active' && (
                  <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center text-[11px] text-slate-400 p-2 text-center">
                    {examCamera.status === 'initializing' ? 'Connecting camera...' : 'Camera stream unavailable'}
                  </div>
                )}
                <div className="absolute bottom-1 right-2 text-[10px] font-mono bg-black/60 px-1.5 py-0.5 rounded text-slate-300">
                  Live Preview
                </div>
              </div>
            </div>

            <div className="text-3xl">📝</div>
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
          </div>

          {/* Observable Proctoring Events Timeline */}
          <div className="w-full max-w-2xl">
            <SessionEventTimeline events={events} isExpandedDefault={true} />
          </div>
        </main>
      </div>
    );
  }

  return <ReadinessScreen onStartExam={handleStartExam} />;
}

export default App;
