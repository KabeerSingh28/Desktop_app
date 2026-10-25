/**
 * SessionEventTimeline Component
 *
 * Renders an observable proctoring event log for the active or completed examination.
 *
 * ETHICAL & LEGAL GUARDRAILS:
 * - Transparent to candidates: students can see what events are registered.
 * - Non-punitive framing: clearly states that observations are technical telemetry,
 *   NOT definitive proof of academic misconduct or cheating.
 * - Human-in-the-loop review policy: automated sanctions are never applied solely
 *   based on telemetry.
 */

import { useState, useMemo } from 'react';

const EVENT_TYPE_LABELS = {
  'fullscreen:exit': { label: 'Fullscreen Exited', icon: '↗️', desc: 'Application exited full-screen presentation mode' },
  'fullscreen:enter': { label: 'Fullscreen Entered', icon: '🖥️', desc: 'Application entered full-screen presentation mode' },
  'window:blur': { label: 'Window Focus Lost', icon: '🪟', desc: 'Application window lost active desktop focus' },
  'window:focus': { label: 'Window Focus Regained', icon: '👁️', desc: 'Application window regained desktop focus' },
  'visibility:hidden': { label: 'Viewport Hidden', icon: '🙈', desc: 'Assessment viewport minimized or switched away' },
  'visibility:visible': { label: 'Viewport Visible', icon: '📖', desc: 'Assessment viewport returned to visible' },
  'navigation:blocked': { label: 'External Navigation Blocked', icon: '🛑', desc: 'Attempt to navigate outside examination boundary was intercepted' },
  'window-open:blocked': { label: 'Popup / New Window Blocked', icon: '🚫', desc: 'Attempt to open external window or popup was intercepted' },
  'camera:interrupted': { label: 'Camera Stream Interrupted', icon: '⚠️', desc: 'Camera video track was temporarily disrupted or muted' },
  'camera:terminated': { label: 'Camera Stream Disconnected', icon: '📷❌', desc: 'Camera stream disconnected or video track ended' },
  'camera:recovered': { label: 'Camera Stream Restored', icon: '📷✅', desc: 'Camera stream successfully re-established' },
  'backend:disconnected': { label: 'Backend Offline', icon: '⚡❌', desc: 'Network communication with examination server was interrupted' },
  'backend:reconnected': { label: 'Backend Reconnected', icon: '⚡✅', desc: 'Network connection to examination server resumed' },
  'monitoring:error': { label: 'Monitoring Exception', icon: '⚠️', desc: 'Telemetry capture encountered an unexpected internal error' },
};

function formatTimestamp(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

export function SessionEventTimeline({ events = [], isExpandedDefault = false }) {
  const [isExpanded, setIsExpanded] = useState(isExpandedDefault);
  const [filterSeverity, setFilterSeverity] = useState('all'); // 'all' | 'warning' | 'critical'

  const filteredEvents = useMemo(() => {
    if (filterSeverity === 'all') return events;
    return events.filter((e) => e.severity === filterSeverity || (filterSeverity === 'warning' && e.severity === 'critical'));
  }, [events, filterSeverity]);

  const severityCounts = useMemo(() => {
    const counts = { info: 0, warning: 0, critical: 0 };
    for (const e of events) {
      if (counts[e.severity] !== undefined) {
        counts[e.severity]++;
      }
    }
    return counts;
  }, [events]);

  return (
    <div className="w-full bg-slate-800/90 border border-slate-700 rounded-xl overflow-hidden shadow-lg text-slate-200">
      {/* Header bar / toggle */}
      <div
        className="px-4 py-3 bg-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-750 transition"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-base">📊</span>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Proctoring Telemetry Timeline
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">
                {events.length} {events.length === 1 ? 'event' : 'events'}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Observable system events recorded during this session
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {severityCounts.critical > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
              {severityCounts.critical} critical
            </span>
          )}
          {severityCounts.warning > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {severityCounts.warning} warning
            </span>
          )}
          <span className="text-slate-400 text-xs">{isExpanded ? '▲ Hide' : '▼ View'}</span>
        </div>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="p-4 border-t border-slate-700/80 space-y-4">
          {/* Ethical Disclaimer Banner */}
          <div className="p-3 bg-blue-950/40 border border-blue-800/50 rounded-lg text-xs text-blue-200 leading-relaxed flex items-start gap-2.5">
            <span className="text-base shrink-0">ℹ️</span>
            <div>
              <p className="font-semibold text-blue-100 mb-0.5">Observation vs. Violation Policy</p>
              <p>
                Recorded events are objective technical observations (e.g. OS notifications, focus shifts, or network jitter).
                They provide contextual telemetry for post-assessment human review and{' '}
                <strong className="text-blue-100 underline decoration-blue-400">do not constitute proof of cheating or trigger automated punishment</strong>.
              </p>
            </div>
          </div>

          {/* Filter tabs */}
          {events.length > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Filter events:</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setFilterSeverity('all')}
                  className={`px-2.5 py-1 rounded transition ${
                    filterSeverity === 'all'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  All ({events.length})
                </button>
                <button
                  onClick={() => setFilterSeverity('warning')}
                  className={`px-2.5 py-1 rounded transition ${
                    filterSeverity === 'warning'
                      ? 'bg-amber-600 text-white font-medium'
                      : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Warnings & Critical ({severityCounts.warning + severityCounts.critical})
                </button>
              </div>
            </div>
          )}

          {/* Timeline Event List */}
          {filteredEvents.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-700/60 rounded-lg">
              {events.length === 0 ? 'No proctoring events recorded yet. Session is in regular standing.' : 'No events match the selected filter.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {filteredEvents.map((evt) => {
                const descriptor = EVENT_TYPE_LABELS[evt.eventType] || {
                  label: evt.eventType,
                  icon: '📌',
                  desc: 'System event',
                };

                const severityStyle =
                  evt.severity === 'critical'
                    ? 'border-rose-800/60 bg-rose-950/20 text-rose-200'
                    : evt.severity === 'warning'
                    ? 'border-amber-800/60 bg-amber-950/20 text-amber-200'
                    : 'border-slate-700/60 bg-slate-800/50 text-slate-300';

                const badgeStyle =
                  evt.severity === 'critical'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : evt.severity === 'warning'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-700 text-slate-300 border-slate-600';

                return (
                  <div
                    key={evt.eventId || `${evt.eventType}-${evt.timestamp}`}
                    className={`p-2.5 rounded-lg border text-xs flex items-start gap-3 transition ${severityStyle}`}
                  >
                    <span className="text-base shrink-0 select-none">{descriptor.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-100 truncate">{descriptor.label}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-mono border ${badgeStyle}`}>
                            {evt.severity}
                          </span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            {formatTimestamp(evt.timestamp)}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        {evt.metadata?.note || evt.metadata?.reason || descriptor.desc}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 font-mono">
                        <span>source: {evt.source}</span>
                        {evt.metadata?.url && <span>• path: {evt.metadata.url}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
