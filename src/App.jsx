import { useState, useRef, useEffect } from 'react';
import { ReadinessScreen } from './components/ReadinessScreen.jsx';
import { SessionEventTimeline } from './components/SessionEventTimeline.jsx';
import { EvidenceStatusBadge } from './components/EvidenceStatusBadge.jsx';
import { useProctoringEvents } from './hooks/useProctoringEvents.js';
import { useEvidenceCapture } from './hooks/useEvidenceCapture.js';
import { useWebcam } from './hooks/useWebcam.js';
import { API_BASE_URL } from './config.js';

function App() {
  const [examState, setExamState] = useState('readiness'); // 'readiness' | 'active' | 'completed'
  const [activeSession, setActiveSession] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submittedResult, setSubmittedResult] = useState(null);

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
    setSubmitError(null);
    setSubmittedResult(null);
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

  async function handleFinalSubmit() {
    const sessionId = activeSession?.session?.sessionId;
    if (!sessionId || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    // 1. Capture final submission evidence snapshot
    try {
      await evidence.captureSnapshot('session:submit');
    } catch (snapErr) {
      console.warn('[app] Non-fatal submission snapshot error:', snapErr);
    }

    // 2. Submit session via Electron IPC bridge or HTTP API
    try {
      let finalResult = null;

      if (window.athena?.submitExamSession) {
        const res = await window.athena.submitExamSession({ sessionId });
        if (!res?.ok) {
          throw new Error(res?.error || 'Failed to submit exam via desktop IPC');
        }
        finalResult = res.data;
      } else {
        const res = await fetch(`${API_BASE_URL}/exam/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Server responded with HTTP ${res.status}`);
        }
        const body = await res.json();
        finalResult = body.result;
      }

      // Stop camera hardware and LED
      examCamera.stopCamera();

      setSubmittedResult(finalResult);
      setExamState('completed');
    } catch (err) {
      console.error('[app] Final submission failed:', err);
      setSubmitError(err.message || 'Submission failed. Please verify your connection and try again.');
    } finally {
      setIsSubmitting(false);
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
    setSubmitError(null);
    setSubmittedResult(null);
    setExamState('readiness');
  }

  // -------------------------------------------------------------------------
  // Completed Examination View
  // -------------------------------------------------------------------------
  if (examState === 'completed') {
    const totalQ = submittedResult?.totalQuestions || activeSession?.session?.totalQuestions || 5;
    const correctQ = submittedResult?.correct ?? 0;
    const attemptedQ = submittedResult?.attempted ?? 0;
    const percentage = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;

    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
        <div className="bg-slate-800 border border-slate-700 rounded-3xl p-8 max-w-lg w-full text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center text-3xl mx-auto border border-emerald-500/30">
            ✓
          </div>

          <div>
            <h1 className="text-2xl font-bold text-white">Assessment Submitted Successfully</h1>
            <p className="text-sm text-slate-400 mt-1">
              Your answers and evidence have been recorded on the secure server.
            </p>
          </div>

          <div className="bg-slate-900/70 p-4 rounded-xl text-left font-mono text-xs space-y-1.5 text-slate-300 border border-slate-800">
            <p>Candidate: <span className="text-slate-100 font-semibold">{activeSession?.candidateName}</span> ({activeSession?.candidateId})</p>
            <p>Session ID: <span className="text-emerald-400">{submittedResult?.sessionId || activeSession?.session?.sessionId}</span></p>
            <p>Status: <span className="text-emerald-400 font-semibold">SUBMITTED & SEALED</span></p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-700/40 p-3 rounded-xl">
              <span className="text-xs text-slate-400 block">Attempted</span>
              <span className="text-xl font-bold text-slate-100">{attemptedQ} / {totalQ}</span>
            </div>
            <div className="bg-slate-700/40 p-3 rounded-xl">
              <span className="text-xs text-slate-400 block">Correct</span>
              <span className="text-xl font-bold text-emerald-400">{correctQ}</span>
            </div>
            <div className="bg-slate-700/40 p-3 rounded-xl">
              <span className="text-xs text-slate-400 block">Score</span>
              <span className="text-xl font-bold text-blue-400">{percentage}%</span>
            </div>
          </div>

          <button
            onClick={handleExitExam}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 font-semibold rounded-xl text-white transition text-sm shadow-md"
          >
            Finish & Return to Main Screen
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Active Examination View
  // -------------------------------------------------------------------------
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
              disabled={isSubmitting}
              className="text-xs px-3 py-1.5 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded transition"
            >
              Cancel / Abort
            </button>
          </div>
        </header>

        {/* Exam main workspace */}
        <main className="flex-1 max-w-4xl w-full mx-auto p-8 flex flex-col items-center space-y-6">
          {/* Submission Failure Alert with Retry */}
          {submitError && (
            <div className="w-full max-w-2xl bg-red-950/70 border border-red-700 text-red-200 p-4 rounded-xl flex items-start justify-between gap-4 animate-shake">
              <div>
                <p className="font-bold text-sm">Submission Encountered an Error</p>
                <p className="text-xs mt-1 text-red-300">{submitError}</p>
                <p className="text-[11px] text-red-400 mt-2">
                  Your session data remains safe. Click Retry to re-attempt final submission.
                </p>
              </div>
              <button
                onClick={handleFinalSubmit}
                disabled={isSubmitting}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded text-xs shrink-0 transition"
              >
                {isSubmitting ? 'Retrying...' : 'Retry Submission'}
              </button>
            </div>
          )}

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

          <div className="p-8 bg-slate-800/80 border border-slate-700 rounded-2xl w-full max-w-2xl space-y-6 text-center">
            {/* Live Camera Preview Thumbnail & Recovery Controls */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative w-48 h-36 bg-slate-950 rounded-xl overflow-hidden border border-slate-700 shadow-inner flex items-center justify-center">
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {!examCamera.isLive && (
                  <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-[11px] text-slate-300 p-2 text-center gap-1.5">
                    <span>{examCamera.status === 'checking' ? 'Initializing camera...' : 'Camera feed paused'}</span>
                    <button
                      onClick={() => examCamera.restartCamera()}
                      className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-medium"
                    >
                      Reconnect
                    </button>
                  </div>
                )}
                <div className="absolute bottom-1 right-2 text-[10px] font-mono bg-black/60 px-1.5 py-0.5 rounded text-slate-300">
                  Live Preview
                </div>
              </div>
              {examCamera.error && (
                <p className="text-[11px] text-amber-400">{examCamera.error}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-3xl">📝</div>
              <h2 className="text-xl font-bold text-white">Active Examination Session Initialized</h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Preflight checks and proctoring consent were successfully verified.
                The exam session is officially registered with the authoritative backend.
              </p>
            </div>

            <div className="bg-slate-900/60 p-4 rounded-xl text-left text-xs font-mono space-y-1.5 text-slate-300">
              <p>Session ID: <span className="text-emerald-400">{activeSession.session?.sessionId || 'N/A'}</span></p>
              <p>Total Questions: <span className="text-blue-400">{activeSession.session?.totalQuestions || '5'}</span></p>
              <p>Deadline: <span className="text-amber-400">{activeSession.session?.deadlineEpoch ? new Date(activeSession.session.deadlineEpoch).toLocaleTimeString() : 'Calculated by Backend'}</span></p>
            </div>

            {/* Actionable Submission Button */}
            <div className="pt-2">
              <button
                onClick={handleFinalSubmit}
                disabled={isSubmitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 text-sm"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Submitting Assessment & Evidence...</span>
                  </>
                ) : (
                  <span>Submit & Complete Assessment</span>
                )}
              </button>
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
