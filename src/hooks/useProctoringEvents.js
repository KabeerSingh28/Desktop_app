/**
 * Custom Hook: useProctoringEvents
 *
 * Captures renderer-observable proctoring events during an active exam session:
 * 1. Document visibility changes (visibility:hidden, visibility:visible)
 * 2. Camera stream transitions (camera:terminated, camera:recovered)
 * 3. Network / backend connectivity transitions (backend:disconnected, backend:reconnected)
 *
 * Bridges events into Electron main process via window.athena.recordProctorEvent
 * or falls back to direct HTTP API if running in a standalone browser.
 * Also subscribes to real-time events broadcast from main process and maintains
 * a local chronological event log for the session event timeline.
 *
 * ETHICAL NOTICE:
 * Recorded events represent observable system state telemetry for post-exam review.
 * They do not constitute proof of cheating and never trigger automated sanctions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../config.js';

export function useProctoringEvents({
  sessionId,
  active = false,
  cameraStatus = null,
  cameraError = null,
  backendConnected = true,
} = {}) {
  const [, setEventsTick] = useState(0);
  const triggerRender = useCallback(() => setEventsTick((t) => t + 1), []);
  const eventsRef = useRef([]);
  const prevCameraStatus = useRef(cameraStatus);
  const prevBackendConnected = useRef(backendConnected);

  // Safely append an event without duplicates
  const addEvent = useCallback((event) => {
    if (!event || !event.eventId) return;
    if (eventsRef.current.some((e) => e.eventId === event.eventId)) {
      return;
    }
    eventsRef.current = [...eventsRef.current, event];
    triggerRender();
  }, [triggerRender]);

  /**
   * Records a structured proctoring event.
   */
  const recordEvent = useCallback(
    async ({ eventType, severity = 'info', source = 'renderer', metadata = {} }) => {
      if (!sessionId || !active) return null;

      const payload = {
        sessionId,
        eventType,
        severity,
        source,
        metadata: {
          ...metadata,
          url: typeof window !== 'undefined' ? window.location.pathname : '',
        },
      };

      // 1. Electron IPC Bridge
      if (typeof window !== 'undefined' && window.athena?.recordProctorEvent) {
        try {
          const res = await window.athena.recordProctorEvent(payload);
          if (res?.ok && res?.data) {
            addEvent(res.data);
            return res.data;
          }
        } catch (err) {
          console.warn('[proctoring-hook] IPC record event error:', err);
        }
      }

      // 2. Direct HTTP Fallback (standalone browser mode)
      try {
        const response = await fetch(`${API_BASE_URL}/exam/session/${sessionId}/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (response.ok) {
          const data = await response.json();
          if (data?.event) {
            addEvent(data.event);
            return data.event;
          }
        }
      } catch (err) {
        console.warn('[proctoring-hook] HTTP record event error:', err);
      }

      return null;
    },
    [sessionId, active, addEvent]
  );

  // Subscribe to real-time broadcasts from Electron main process
  useEffect(() => {
    if (typeof window === 'undefined' || !window.athena?.onProctorEvent) return;

    const cleanup = window.athena.onProctorEvent((event) => {
      if (event && (!sessionId || event.sessionId === sessionId)) {
        addEvent(event);
      }
    });

    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [sessionId, addEvent]);

  // Load existing events when session becomes active
  useEffect(() => {
    if (!sessionId || !active) return;
    let isMounted = true;

    async function fetchExistingEvents() {
      if (typeof window !== 'undefined' && window.athena?.getProctorEvents) {
        try {
          const res = await window.athena.getProctorEvents(sessionId);
          if (isMounted && res?.ok && Array.isArray(res?.data)) {
            eventsRef.current = res.data;
            triggerRender();
            return;
          }
        } catch {
          // fallback to HTTP
        }
      }

      try {
        const response = await fetch(`${API_BASE_URL}/exam/session/${sessionId}/events`);
        if (response.ok) {
          const data = await response.json();
          if (isMounted && Array.isArray(data?.events)) {
            eventsRef.current = data.events;
            triggerRender();
          }
        }
      } catch (err) {
        console.warn('[proctoring-hook] Error fetching initial events:', err);
      }
    }

    fetchExistingEvents();

    return () => {
      isMounted = false;
    };
  }, [sessionId, active, triggerRender]);

  // Monitor DOM visibility changes (window minimized, tab switched)
  useEffect(() => {
    if (!active || !sessionId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        recordEvent({
          eventType: 'visibility:hidden',
          severity: 'warning',
          source: 'renderer',
          metadata: { note: 'Assessment viewport became hidden or minimized' },
        });
      } else if (document.visibilityState === 'visible') {
        recordEvent({
          eventType: 'visibility:visible',
          severity: 'info',
          source: 'renderer',
          metadata: { note: 'Assessment viewport returned to visible state' },
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [active, sessionId, recordEvent]);

  // Monitor camera lifecycle changes during active session
  useEffect(() => {
    if (!active || !sessionId) {
      prevCameraStatus.current = cameraStatus;
      return;
    }

    if (prevCameraStatus.current !== cameraStatus) {
      const prev = prevCameraStatus.current;
      prevCameraStatus.current = cameraStatus;

      if (cameraStatus === 'error' || cameraStatus === 'stopped') {
        queueMicrotask(() => {
          recordEvent({
            eventType: 'camera:terminated',
            severity: 'critical',
            source: 'renderer',
            metadata: { reason: cameraError || 'Webcam feed disconnected or ended' },
          });
        });
      } else if (cameraStatus === 'active' && prev && prev !== 'idle') {
        queueMicrotask(() => {
          recordEvent({
            eventType: 'camera:recovered',
            severity: 'info',
            source: 'renderer',
            metadata: { note: 'Webcam feed successfully resumed' },
          });
        });
      }
    }
  }, [cameraStatus, cameraError, active, sessionId, recordEvent]);

  // Monitor backend connectivity transitions
  useEffect(() => {
    if (!active || !sessionId) {
      prevBackendConnected.current = backendConnected;
      return;
    }

    if (prevBackendConnected.current !== backendConnected) {
      prevBackendConnected.current = backendConnected;

      if (!backendConnected) {
        queueMicrotask(() => {
          recordEvent({
            eventType: 'backend:disconnected',
            severity: 'warning',
            source: 'renderer',
            metadata: { note: 'Candidate device lost connection to assessment backend' },
          });
        });
      } else {
        queueMicrotask(() => {
          recordEvent({
            eventType: 'backend:reconnected',
            severity: 'info',
            source: 'renderer',
            metadata: { note: 'Candidate device re-established connection to backend' },
          });
        });
      }
    }
  }, [backendConnected, active, sessionId, recordEvent]);

  const clearEvents = useCallback(() => {
    eventsRef.current = [];
    triggerRender();
  }, [triggerRender]);

  return {
    get events() {
      return eventsRef.current;
    },
    recordEvent,
    clearEvents,
  };
}
