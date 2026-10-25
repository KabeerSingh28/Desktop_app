/**
 * EvidenceStatusBadge Component
 *
 * Displays transparent, visible telemetry status for active evidence capture:
 * - Active snapshot proctoring indicator (interval, total captured, last capture timestamp)
 * - Continuous video recording indicator (pulsing red record indicator & elapsed duration)
 * - Transparent explanation of privacy policy & non-AI evaluation guardrails.
 */

function formatTime(isoString) {
  if (!isoString) return '--:--:--';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function EvidenceStatusBadge({
  captureStatus = 'idle',
  snapshotCount = 0,
  lastSnapshotTime = null,
  recordingDuration = 0,
  isVideoRecording = false,
  error = null,
  onManualCapture = null,
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-800/90 border border-slate-700 rounded-xl text-xs text-slate-200 shadow-sm">
      <div className="flex items-center gap-3">
        {/* Status indicator pill */}
        {error ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            <span className="font-medium">Capture Error</span>
          </div>
        ) : isVideoRecording ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-600/30 text-rose-200 border border-rose-500/40 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
            <span className="font-semibold tracking-wider uppercase text-[10px]">REC {formatDuration(recordingDuration)}</span>
          </div>
        ) : captureStatus === 'active' || captureStatus === 'capturing' ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <span className={`w-2 h-2 rounded-full bg-emerald-500 ${captureStatus === 'capturing' ? 'animate-ping' : ''}`}></span>
            <span className="font-medium">
              {captureStatus === 'capturing' ? 'Capturing Frame...' : 'Proctoring Active'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-700 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-slate-500"></span>
            <span className="font-medium">Standby</span>
          </div>
        )}

        {/* Snapshot Telemetry Details */}
        <div className="flex items-center gap-2 text-slate-300">
          <span>📷 Snapshots:</span>
          <span className="font-mono font-semibold text-slate-100 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700">
            {snapshotCount}
          </span>
          {lastSnapshotTime && (
            <span className="text-slate-400 text-[11px]">
              (last: <span className="font-mono text-slate-200">{formatTime(lastSnapshotTime)}</span>)
            </span>
          )}
        </div>
      </div>

      {/* Manual verification button & Privacy notice */}
      <div className="flex items-center gap-3">
        {onManualCapture && captureStatus !== 'idle' && (
          <button
            onClick={onManualCapture}
            className="px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition active:scale-95"
            title="Trigger an instantaneous verification snapshot"
          >
            Take Snapshot Now
          </button>
        )}
        <span
          className="text-slate-400 text-[11px] hover:text-slate-200 cursor-help"
          title="Evidence captures are stored under strict data retention limits and automatically purged according to exam policy. Athena does not perform facial recognition or automated AI cheat scoring."
        >
          🔒 Retention-Capped Local Evidence
        </span>
      </div>
    </div>
  );
}
