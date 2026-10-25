/**
 * Custom Hook: useEvidenceCapture
 *
 * Coordinates transparent, consented evidence capture during active assessment sessions:
 * 1. Configurable periodic & event-driven snapshots (session:start, interval, session:submit)
 * 2. Optional continuous video recording via MediaRecorder (separate opt-in feature)
 * 3. Lifecycle boundary enforcement (stops on submit, cancel, stream loss, unmount)
 * 4. In-flight capture serialization (mutex guard against overlapping requests)
 *
 * STORAGE & PRIVACY DECISION:
 * - Evidence capture is strictly gated on candidate consent and active session status.
 * - Files are written to Electron's dedicated, sandboxed userData folder (app.getPath('userData'))
 *   or sent to the authoritative backend upload endpoint.
 * - No biometric or facial recognition algorithms are used; captures serve solely
 *   as chronological evidence logs for human review under strict retention policies.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  captureFrame,
  isStreamLive,
  isMediaRecorderSupported,
  getSupportedVideoMimeType,
} from '../utils/cameraUtils.js';
import { API_BASE_URL } from '../config.js';

export function useEvidenceCapture({
  sessionId,
  stream,
  videoRef = null,
  videoElement = null,
  active = false,
  consentAccepted = false,
  enablePeriodicSnapshots = true,
  snapshotIntervalMs = 60000, // 60 seconds default
  enableVideoRecording = false, // Optional separate continuous video recording
  videoTimesliceMs = 10000,     // 10s timeslices for chunked recording
  onProctorEvent = null,        // Optional callback to record proctoring events
} = {}) {
  const [captureStatus, setCaptureStatus] = useState('idle'); // 'idle' | 'capturing' | 'recording' | 'error' | 'stopped'
  const [isCapturing, setIsCapturing] = useState(false);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [lastSnapshotTime, setLastSnapshotTime] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [error, setError] = useState(null);

  // References to prevent duplicate timers and concurrent capture requests
  const inFlightRef = useRef(false);
  const intervalTimerRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const initialSnapshotTakenRef = useRef(false);

  // Helper to safely extract live video track
  const getLiveVideoTrack = useCallback(() => {
    if (!stream || !stream.active) return null;
    const tracks = stream.getVideoTracks();
    return tracks.find((t) => t.readyState === 'live') || null;
  }, [stream]);

  /**
   * Captures a single image frame and persists it through the secure bridge.
   * Gated strictly by candidate consent, active exam session, and live camera stream.
   */
  const captureSnapshot = useCallback(
    async (trigger = 'interval') => {
      // Guard 1: Never capture without active exam session and verified candidate consent
      if (!active || !consentAccepted || !sessionId) {
        return null;
      }

      // Guard 2: Mutex lock to prevent overlapping capture requests
      if (inFlightRef.current) {
        return null;
      }

      const actualVideoEl = videoElement || (videoRef ? videoRef.current : null);

      // Guard 3: Verify video track is alive and ready
      const videoTrack = getLiveVideoTrack();
      if (!videoTrack && (!actualVideoEl || actualVideoEl.readyState < 2)) {
        console.warn('[evidence] Cannot capture snapshot: camera track is not live');
        return null;
      }

      inFlightRef.current = true;
      setIsCapturing(true);
      setError(null);

      try {
        const frameResult = await captureFrame({
          videoTrack,
          videoElement: actualVideoEl,
          width: 640,
          height: 480,
          quality: 0.6,
          format: 'image/jpeg',
        });

        const timestamp = new Date().toISOString();
        const payload = {
          sessionId,
          dataUrl: frameResult.dataUrl,
          trigger,
          timestamp,
        };

        // 1. Electron IPC Bridge
        let savedSuccessfully = false;
        if (typeof window !== 'undefined' && window.athena?.saveSnapshot) {
          try {
            const res = await window.athena.saveSnapshot(payload);
            if (res?.ok) {
              savedSuccessfully = true;
            } else if (res?.error) {
              console.warn('[evidence] IPC saveSnapshot warning:', res.error);
            }
          } catch (ipcErr) {
            console.warn('[evidence] IPC saveSnapshot error:', ipcErr.message);
          }
        }

        // 2. HTTP Backend Upload Fallback (standalone browser or sync)
        if (!savedSuccessfully) {
          try {
            const response = await fetch(`${API_BASE_URL}/exam/session/${sessionId}/snapshot`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (response.ok) {
              savedSuccessfully = true;
            }
          } catch (httpErr) {
            console.warn('[evidence] HTTP snapshot upload error:', httpErr.message);
          }
        }

        if (savedSuccessfully) {
          setSnapshotCount((prev) => prev + 1);
          setLastSnapshotTime(timestamp);
          return { ok: true, trigger, timestamp };
        } else {
          throw new Error('Storage destination was unavailable for evidence snapshot');
        }
      } catch (err) {
        console.error('[evidence] Snapshot capture failure:', err.message);
        setError(err.message);
        if (typeof onProctorEvent === 'function') {
          onProctorEvent({
            eventType: 'monitoring:error',
            severity: 'warning',
            source: 'renderer',
            metadata: { context: 'snapshot-capture-failed', reason: err.message },
          });
        }
        return null;
      } finally {
        inFlightRef.current = false;
        setIsCapturing(false);
      }
    },
    [active, consentAccepted, sessionId, getLiveVideoTrack, videoRef, videoElement, onProctorEvent]
  );

  // -------------------------------------------------------------------------
  // Periodic Snapshot Scheduling Lifecycle
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Clean up any existing periodic timer first
    if (intervalTimerRef.current) {
      clearInterval(intervalTimerRef.current);
      intervalTimerRef.current = null;
    }

    if (!active || !consentAccepted || !sessionId || !isStreamLive(stream)) {
      return;
    }

    // Trigger initial session:start snapshot once upon active session start
    if (!initialSnapshotTakenRef.current) {
      initialSnapshotTakenRef.current = true;
      // Defer to microtask to ensure rendering pipeline is initialized
      queueMicrotask(() => {
        captureSnapshot('session:start');
      });
    }

    // Schedule periodic interval captures if enabled
    if (enablePeriodicSnapshots && snapshotIntervalMs > 0) {
      intervalTimerRef.current = setInterval(() => {
        captureSnapshot('interval');
      }, snapshotIntervalMs);
    }

    return () => {
      if (intervalTimerRef.current) {
        clearInterval(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }
    };
  }, [
    active,
    consentAccepted,
    sessionId,
    stream,
    enablePeriodicSnapshots,
    snapshotIntervalMs,
    captureSnapshot,
  ]);

  // -------------------------------------------------------------------------
  // Optional Continuous Video Recording Lifecycle (MediaRecorder)
  // -------------------------------------------------------------------------
  useEffect(() => {
    // If video recording is disabled or prerequisites are not met, clean up
    if (
      !enableVideoRecording ||
      !active ||
      !consentAccepted ||
      !sessionId ||
      !isStreamLive(stream) ||
      !isMediaRecorderSupported()
    ) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore already-stopped errors
        }
        mediaRecorderRef.current = null;
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      return;
    }

    const mimeType = getSupportedVideoMimeType();
    if (!mimeType) {
      console.warn('[evidence] No supported video MIME type found for MediaRecorder');
      queueMicrotask(() => {
        setError('Unsupported recording format in current environment');
      });
      return;
    }

    let recorder;
    try {
      recorder = new window.MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0 && window.athena?.saveVideoChunk) {
          try {
            // Read blob chunk as ArrayBuffer
            const buffer = await e.data.arrayBuffer();
            await window.athena.saveVideoChunk({
              sessionId,
              chunk: new Uint8Array(buffer),
              mimeType,
            });
          } catch (chunkErr) {
            console.warn('[evidence] Error saving video chunk:', chunkErr.message);
          }
        }
      };

      recorder.onerror = (evt) => {
        const errorMsg = evt?.error?.message || 'MediaRecorder runtime exception';
        console.error('[evidence] MediaRecorder error:', errorMsg);
        queueMicrotask(() => {
          setError(errorMsg);
        });
        if (typeof onProctorEvent === 'function') {
          onProctorEvent({
            eventType: 'monitoring:error',
            severity: 'warning',
            source: 'renderer',
            metadata: { context: 'mediarecorder-error', reason: errorMsg },
          });
        }
      };

      recorder.onstop = () => {
        queueMicrotask(() => {
          setCaptureStatus('stopped');
        });
      };

      recorder.start(videoTimesliceMs);
      queueMicrotask(() => {
        setCaptureStatus('recording');
        setRecordingDuration(0);
      });

      // Track recording duration
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('[evidence] Failed to initialize MediaRecorder:', err.message);
      queueMicrotask(() => {
        setError(`Video recording failed: ${err.message}`);
      });
    }

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      mediaRecorderRef.current = null;
    };
  }, [
    enableVideoRecording,
    active,
    consentAccepted,
    sessionId,
    stream,
    videoTimesliceMs,
    onProctorEvent,
  ]);

  // -------------------------------------------------------------------------
  // Lifecycle Termination & Stream Loss Guard
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!active) {
      // Reset state when session ends
      initialSnapshotTakenRef.current = false;
      queueMicrotask(() => {
        setCaptureStatus('idle');
      });
      return;
    }

    // Attach stream track termination listeners to gracefully stop capturing if camera drops
    if (stream) {
      const videoTracks = stream.getVideoTracks();
      const handleTrackEnded = () => {
        console.warn('[evidence] Camera video track terminated; stopping active capture jobs');
        queueMicrotask(() => {
          setCaptureStatus('error');
          setError('Camera stream terminated unexpectedly');
        });

        if (intervalTimerRef.current) {
          clearInterval(intervalTimerRef.current);
          intervalTimerRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          try {
            mediaRecorderRef.current.stop();
          } catch {
            // ignore
          }
        }
      };

      videoTracks.forEach((t) => t.addEventListener('ended', handleTrackEnded));
      return () => {
        videoTracks.forEach((t) => t.removeEventListener('ended', handleTrackEnded));
      };
    }
  }, [active, stream]);

  // Compute composite capture status
  const effectiveStatus = error
    ? 'error'
    : enableVideoRecording && captureStatus === 'recording'
    ? 'recording'
    : isCapturing
    ? 'capturing'
    : active && consentAccepted
    ? 'active'
    : 'idle';

  return {
    captureStatus: effectiveStatus,
    snapshotCount,
    lastSnapshotTime,
    recordingDuration,
    isVideoRecording: enableVideoRecording && captureStatus === 'recording',
    isCapturing,
    error,
    captureSnapshot,
  };
}
