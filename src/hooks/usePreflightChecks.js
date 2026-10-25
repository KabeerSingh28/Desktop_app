/**
 * Custom Hook: usePreflightChecks
 *
 * Coordinates system-wide preflight checks by composing:
 * 1. Dedicated webcam lifecycle management via useWebcam.
 * 2. Authoritative backend service health and latency probing.
 * 3. Fullscreen mode tracking across Electron IPC and standard DOM APIs.
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config.js';
import { checkBackendHealth } from '../utils/preflightHelpers.js';
import { useWebcam } from './useWebcam.js';

export function usePreflightChecks() {
  // Delegate all camera stream ownership, detection, and cleanup to useWebcam
  const camera = useWebcam();

  // Backend service connectivity state
  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking' | 'connected' | 'disconnected'
  const [backendLatency, setBackendLatency] = useState(null);
  const [backendError, setBackendError] = useState(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  /**
   * Pings the backend health endpoint.
   */
  const checkBackend = useCallback(async () => {
    setBackendStatus('checking');
    setBackendError(null);

    const result = await checkBackendHealth(API_BASE_URL);
    if (result.ok) {
      setBackendStatus('connected');
      setBackendLatency(result.latencyMs);
      setBackendError(null);
    } else {
      setBackendStatus('disconnected');
      setBackendLatency(null);
      setBackendError(result.error);
    }
  }, []);

  /**
   * Toggles fullscreen through Electron IPC bridge or DOM fallback.
   */
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        if (window.athena?.exitFullscreen) {
          const res = await window.athena.exitFullscreen();
          if (!res.ok) {
            console.warn('[preflight] IPC exitFullscreen refused:', res.error);
          }
        } else if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } else {
        if (window.athena?.enterFullscreen) {
          await window.athena.enterFullscreen();
        } else if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      }
    } catch (err) {
      console.warn('[preflight] Fullscreen toggle error:', err);
    }
  }, []);

  // 1. Probe backend connectivity upon mount
  useEffect(() => {
    let isMounted = true;

    checkBackendHealth(API_BASE_URL).then((result) => {
      if (!isMounted) return;
      if (result.ok) {
        setBackendStatus('connected');
        setBackendLatency(result.latencyMs);
        setBackendError(null);
      } else {
        setBackendStatus('disconnected');
        setBackendLatency(null);
        setBackendError(result.error);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Track fullscreen state changes in real time
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  return {
    camera,
    backend: {
      status: backendStatus,
      latencyMs: backendLatency,
      error: backendError,
      checkBackend,
      url: API_BASE_URL,
    },
    fullscreen: {
      isActive: isFullscreen,
      toggle: toggleFullscreen,
    },
  };
}
