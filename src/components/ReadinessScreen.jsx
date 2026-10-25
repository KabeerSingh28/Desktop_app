/**
 * Pre-Exam Readiness Screen Component
 *
 * Implements:
 * - Candidate identification inputs (Name, Student ID / URN)
 * - Mandatory preflight checks (Camera, Backend Connectivity, Fullscreen Mode)
 * - Explicit proctoring policy and consent acknowledgement
 * - Clear error states with platform-specific remedies
 * - Safe camera preview with track cleanup
 */

import { useState, useRef, useEffect } from 'react';
import { usePreflightChecks } from '../hooks/usePreflightChecks.js';
import { canStartExam, PLATFORM_INSTRUCTIONS } from '../utils/preflightHelpers.js';

export function ReadinessScreen({ onStartExam }) {
  // Candidate identity
  const [candidateName, setCandidateName] = useState('');
  const [candidateId, setCandidateId] = useState('');

  // Explicit consent state (must be actively checked by student)
  const [hasConsented, setHasConsented] = useState(false);

  // Error / launch feedback
  const [launchError, setLaunchError] = useState(null);
  const [isLaunching, setIsLaunching] = useState(false);

  // Platform troubleshooting accordion state
  const [activeAccordion, setActiveAccordion] = useState(null);

  // Preflight hook
  const { camera, backend, fullscreen } = usePreflightChecks();

  // Video element ref for live camera preview
  const videoRef = useRef(null);

  // Bind camera stream to video preview element when stream changes
  useEffect(() => {
    if (videoRef.current && camera.stream) {
      videoRef.current.srcObject = camera.stream;
    }
  }, [camera.stream]);

  // Evaluate readiness to start
  const readiness = canStartExam({
    name: candidateName,
    userId: candidateId,
    cameraStatus: camera.status,
    backendStatus: backend.status,
    isFullscreen: fullscreen.isActive,
    hasConsented,
  });

  /**
   * Handles the launch sequence:
   * 1. Confirms rules dialog via IPC.
   * 2. Starts session on backend via IPC bridge.
   * 3. Hands off control to examination view.
   */
  async function handleStartAssessment() {
    if (!readiness.ready) return;

    setLaunchError(null);
    setIsLaunching(true);

    try {
      // 1. Show native rules confirmation dialog if available
      if (window.athena?.showExamRules) {
        const accepted = await window.athena.showExamRules();
        if (!accepted) {
          setIsLaunching(false);
          setLaunchError('You must accept the exam rules dialog to begin the assessment.');
          return;
        }
      }

      // 2. Start exam session on backend
      let sessionData = null;
      if (window.athena?.startExamSession) {
        const res = await window.athena.startExamSession({
          name: candidateName,
          userId: candidateId,
        });

        if (!res.ok) {
          throw new Error(res.error || 'Failed to start exam session on backend');
        }
        sessionData = res.data;
      }

      // 3. Stop preview camera stream so exam proctoring pipeline can acquire it
      camera.stopCamera();

      // 4. Notify parent app
      if (typeof onStartExam === 'function') {
        onStartExam({
          candidateName,
          candidateId,
          session: sessionData,
        });
      }
    } catch (err) {
      console.error('[readiness] Launch failed:', err);
      setLaunchError(err.message || 'An error occurred while launching the exam.');
      setIsLaunching(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* ================================================================= */}
        {/* Header Section                                                    */}
        {/* ================================================================= */}
        <header className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs font-semibold text-blue-700">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
            Athena Secure Assessment Platform
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Pre-Exam Readiness & Preflight Verification
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl mx-auto">
            Please verify your device hardware, system connectivity, and acknowledge the monitoring
            policies below before commencing your examination.
          </p>
        </header>

        {/* ================================================================= */}
        {/* Candidate Details Form                                            */}
        {/* ================================================================= */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-black">
              1
            </span>
            Candidate Identification
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="candidate-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="candidate-name"
                type="text"
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="e.g. Jane Doe"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="candidate-id" className="block text-xs font-semibold text-slate-700 mb-1">
                Student ID / URN <span className="text-red-500">*</span>
              </label>
              <input
                id="candidate-id"
                type="text"
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
                placeholder="e.g. URN-2026-1049"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </section>

        {/* ================================================================= */}
        {/* System Preflight Checklist                                        */}
        {/* ================================================================= */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-black">
              2
            </span>
            System Hardware & Connection Checks
          </h2>

          <div className="space-y-6 divide-y divide-slate-100">

            {/* Check 1: Camera Access & Preview */}
            <div className="pt-4 first:pt-0 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">Webcam Camera Access</h3>
                    <CameraStatusBadge status={camera.status} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Required for identity verification and continuous automated snapshot proctoring.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {camera.status === 'granted' ? (
                    <button
                      type="button"
                      onClick={camera.stopCamera}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                    >
                      Turn Off Preview
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={camera.requestCamera}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                    >
                      {camera.status === 'checking' ? 'Connecting...' : 'Enable Camera'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={camera.requestCamera}
                    title="Retest camera hardware"
                    className="p-1.5 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                  >
                    ↻
                  </button>
                </div>
              </div>

              {/* Live Preview / Placeholder */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="relative w-full aspect-video bg-slate-900 rounded-lg overflow-hidden border border-slate-300 flex items-center justify-center">
                  {camera.status === 'granted' && camera.stream ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                  ) : (
                    <div className="text-center p-6 space-y-2 text-slate-400">
                      <div className="text-2xl">📷</div>
                      <p className="text-xs">
                        {camera.status === 'denied'
                          ? 'Camera access denied'
                          : camera.status === 'unavailable'
                          ? 'No webcam detected'
                          : 'Camera preview is currently inactive'}
                      </p>
                    </div>
                  )}

                  {camera.status === 'granted' && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 backdrop-blur-xs text-emerald-400 text-[10px] font-mono rounded-md">
                      ● LIVE FEED
                    </span>
                  )}
                </div>

                <div className="space-y-3 text-xs">
                  {camera.status === 'granted' && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 space-y-1">
                      <p className="font-semibold text-emerald-800">✓ Video stream active</p>
                      <p className="text-emerald-700">
                        Device: <span className="font-mono">{camera.deviceLabel}</span>
                      </p>
                      <p className="text-[11px] text-emerald-600">
                        Ensure your face is well-lit and centered within the frame.
                      </p>
                    </div>
                  )}

                  {camera.error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 space-y-1.5">
                      <p className="font-semibold text-red-800">Camera Check Notice:</p>
                      <p className="text-red-700">{camera.error}</p>
                      {camera.remedy && (
                        <p className="text-slate-600 bg-white/70 p-2 rounded text-[11px]">
                          <strong>Remedy:</strong> {camera.remedy}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 space-y-1 text-[11px]">
                    <p className="font-semibold text-slate-700">Setup Guidelines:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-500">
                      <li>Position yourself in a well-illuminated room.</li>
                      <li>Avoid bright backlighting directly behind you.</li>
                      <li>Close all external camera programs (Zoom, Teams, FaceTime).</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Check 2: Backend Connectivity */}
            <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Backend Examination Service</h3>
                  <BackendStatusBadge status={backend.status} latency={backend.latencyMs} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Host: <span className="font-mono text-slate-700">{backend.url}</span>
                </p>
                {backend.error && (
                  <p className="text-xs text-red-600 mt-1">
                    Failed: {backend.error}. Make sure the backend server is running (<code className="bg-slate-100 px-1 py-0.5 rounded">npm run backend</code>).
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={backend.checkBackend}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition shrink-0 self-start sm:self-auto"
              >
                {backend.status === 'checking' ? 'Testing...' : 'Check Connection'}
              </button>
            </div>

            {/* Check 3: Fullscreen Display */}
            <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Fullscreen Examination Mode</h3>
                  <FullscreenStatusBadge isActive={fullscreen.isActive} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mandatory during active examination to minimize distraction and prevent multitasking.
                </p>
              </div>
              <button
                type="button"
                onClick={fullscreen.toggle}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition shrink-0 self-start sm:self-auto ${
                  fullscreen.isActive
                    ? 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                    : 'text-white bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {fullscreen.isActive ? 'Exit Fullscreen' : 'Enable Fullscreen'}
              </button>
            </div>

            {/* Clarification 4: Audio Monitoring Explicit Exclusion */}
            <div className="pt-4 flex items-start gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="text-lg">🔇</span>
              <div className="text-xs text-slate-600 space-y-0.5">
                <p className="font-semibold text-slate-800">
                  Audio & Microphone Policy: Explicitly Excluded
                </p>
                <p>
                  Institutional policy does not permit audio monitoring for this exam. Athena will
                  <strong> NOT</strong> request microphone access, listen to, or record any audio.
                </p>
              </div>
            </div>

          </div>
        </section>

        {/* ================================================================= */}
        {/* Monitoring & Privacy Consent Disclosure Card                      */}
        {/* ================================================================= */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-black">
              3
            </span>
            Proctoring & Monitoring Privacy Consent
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <p className="font-semibold text-slate-900">What is Collected</p>
              <p>
                Periodic webcam still snapshot photos captured at automated intervals (every ~20 seconds)
                to verify candidate presence and identity. Window focus and blur events are also logged.
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <p className="font-semibold text-slate-900">When Capture Begins</p>
              <p>
                Monitoring commences <strong>strictly after</strong> clicking &quot;Start Assessment&quot; and entering
                the test room. <strong>No monitoring or recording takes place on this preflight screen.</strong>
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <p className="font-semibold text-slate-900">Evidence Storage</p>
              <p>
                Snapshots are securely persisted into isolated local application storage on your device
                (<code className="bg-slate-200 px-1 py-0.5 rounded text-[11px]">app.getPath(&apos;userData&apos;)/snapshots/</code>)
                for official proctor audit verification.
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <p className="font-semibold text-slate-900">Retention & Purging</p>
              <p>
                Evidence is retained strictly for the duration of the institutional grade-audit window
                (30 days), after which records are permanently deleted according to institutional policy.
              </p>
            </div>
          </div>

          {/* Explicit Consent Checkbox */}
          <div className="pt-2">
            <label className="flex items-start gap-3 p-3 bg-blue-50/50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-50 transition">
              <input
                type="checkbox"
                checked={hasConsented}
                onChange={(e) => setHasConsented(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                <strong>I have reviewed the assessment requirements and monitoring disclosures above.</strong>{' '}
                I grant explicit consent for periodic webcam snapshot capture and window focus logging
                solely for academic integrity verification during this assessment.
              </span>
            </label>
          </div>
        </section>

        {/* ================================================================= */}
        {/* Platform-Specific Permission Troubleshooting Accordion           */}
        {/* ================================================================= */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">
              Need help adjusting operating system camera permissions?
            </p>
            <div className="flex gap-2">
              {['macos', 'windows', 'linux'].map((osKey) => (
                <button
                  key={osKey}
                  type="button"
                  onClick={() => setActiveAccordion(activeAccordion === osKey ? null : osKey)}
                  className={`text-xs px-2.5 py-1 rounded border transition ${
                    activeAccordion === osKey
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {osKey === 'macos' ? 'macOS Guide' : osKey === 'windows' ? 'Windows Guide' : 'Linux Guide'}
                </button>
              ))}
            </div>
          </div>

          {activeAccordion && PLATFORM_INSTRUCTIONS[activeAccordion] && (
            <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
              <p className="font-bold text-slate-900">
                {PLATFORM_INSTRUCTIONS[activeAccordion].title}
              </p>
              <ol className="list-decimal list-inside space-y-1 text-slate-600">
                {PLATFORM_INSTRUCTIONS[activeAccordion].steps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </section>

        {/* ================================================================= */}
        {/* Launch Control & Action Footer                                    */}
        {/* ================================================================= */}
        <footer className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Preflight Verification Summary
              </p>
              {readiness.ready ? (
                <p className="text-sm font-bold text-emerald-600 flex items-center gap-1.5 mt-0.5">
                  <span>✓</span> All mandatory checks and consent requirements satisfied
                </p>
              ) : (
                <p className="text-xs text-amber-700 font-medium mt-0.5">
                  {readiness.missingRequirements.length} requirement(s) remaining before assessment can begin
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={!readiness.ready || isLaunching}
              onClick={handleStartAssessment}
              className={`w-full sm:w-auto px-6 py-3 rounded-lg text-sm font-bold shadow-xs transition flex items-center justify-center gap-2 ${
                readiness.ready && !isLaunching
                  ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-98'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isLaunching ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Initializing Assessment...
                </>
              ) : (
                'Start Assessment'
              )}
            </button>
          </div>

          {!readiness.ready && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
              <p className="font-semibold text-amber-800">Please complete the following items:</p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-700">
                {readiness.missingRequirements.map((req, idx) => (
                  <li key={idx}>{req}</li>
                ))}
              </ul>
            </div>
          )}

          {launchError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900">
              <strong>Error:</strong> {launchError}
            </div>
          )}
        </footer>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge Sub-components
// ---------------------------------------------------------------------------

function CameraStatusBadge({ status }) {
  switch (status) {
    case 'granted':
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 rounded-md">✓ Ready</span>;
    case 'denied':
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-800 rounded-md">✕ Denied</span>;
    case 'unavailable':
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 rounded-md">! No Device</span>;
    case 'unsupported':
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-slate-200 text-slate-700 rounded-md">Unsupported</span>;
    case 'checking':
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-blue-100 text-blue-800 rounded-md animate-pulse">Checking...</span>;
    default:
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-md">Inactive</span>;
  }
}

function BackendStatusBadge({ status, latency }) {
  switch (status) {
    case 'connected':
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 rounded-md">
          ✓ Connected {latency !== null && `(${latency}ms)`}
        </span>
      );
    case 'checking':
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-blue-100 text-blue-800 rounded-md animate-pulse">Pinging...</span>;
    default:
      return <span className="px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-800 rounded-md">✕ Disconnected</span>;
  }
}

function FullscreenStatusBadge({ isActive }) {
  if (isActive) {
    return <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 rounded-md">✓ Active</span>;
  }
  return <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 rounded-md">! Windowed</span>;
}
