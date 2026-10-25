/**
 * Custom Hook: usePreflightChecks
 *
 * Encapsulates the complete preflight verification lifecycle:
 * 1. Camera availability, Permissions API status query, and getUserMedia acquisition.
 * 2. Backend health monitoring and latency ping.
 * 3. Window fullscreen tracking via DOM events and Electron IPC bridge.
 * 4. Safe cleanup of media stream tracks upon unmount.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../config.js';
import {
  evaluateCameraError,
  checkBackendHealth,
} from '../utils/preflightHelpers.js';

export function usePreflightChecks() {
  // Camera state
  const [cameraStatus, setCameraStatus] = useState('checking'); // 'checking' | 'idle' | 'granted' | 'denied' | 'unavailable' | 'unsupported'
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraDeviceLabel, setCameraDeviceLabel] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraRemedy, setCameraRemedy] = useState(null);

  // Backend state
  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking' | 'connected' | 'disconnected'
  const [backendLatency, setBackendLatency] = useState(null);
  const [backendError, setBackendError] = useState(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keep ref to stream for cleanup without triggering re-renders
  const streamRef = useRef(null);

  /**
   * Safely stops all active media tracks.
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('[preflight] Error stopping track:', e);
        }
      });
      streamRef.current = null;
    }
    setCameraStream(null);
    setCameraDeviceLabel(null);
  }, []);

  /**
   * Requests camera access using the standard getUserMedia API.
   * Catches and classifies any DOMExceptions.
   */
  const requestCamera = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraStatus('unsupported');
      setCameraError('Your current environment does not support MediaDevices.getUserMedia.');
      setCameraRemedy('Please ensure you are running the Athena desktop application or a modern Chromium browser.');
      return;
    }

    setCameraStatus('checking');
    setCameraError(null);
    setCameraRemedy(null);

    // Stop existing stream if any before acquiring a new one
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false, // Microphone is explicitly NOT requested
      });

      streamRef.current = stream;
      setCameraStream(stream);

      const track = stream.getVideoTracks()[0];
      setCameraDeviceLabel(track?.label || 'Default Camera Device');
      setCameraStatus('granted');
      setCameraError(null);
      setCameraRemedy(null);
    } catch (err) {
      const evaluation = evaluateCameraError(err);
      setCameraStatus(evaluation.status);
      setCameraError(evaluation.message);
      setCameraRemedy(evaluation.remedy);
      stopCamera();
    }
  }, [stopCamera]);

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

  // 1. Check initial permissions & probe backend on mount
  useEffect(() => {
    let isMounted = true;

    async function initialProbe() {
      // Preliminary check via Permissions API where supported
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        try {
          const status = await navigator.permissions.query({ name: 'camera' });
          if (isMounted) {
            if (status.state === 'granted') {
              // Automatically activate stream if permission was previously granted
              requestCamera();
            } else if (status.state === 'denied') {
              setCameraStatus('denied');
              setCameraError('Camera access was previously denied in system/browser privacy settings.');
              setCameraRemedy('Please grant camera access in OS Privacy Settings and click "Retry Access".');
            } else {
              setCameraStatus('idle');
            }

            status.onchange = () => {
              if (!isMounted) return;
              if (status.state === 'granted') {
                requestCamera();
              } else if (status.state === 'denied') {
                setCameraStatus('denied');
                setCameraError('Camera access was denied.');
                stopCamera();
              }
            };
          }
        } catch {
          // Permissions API query for camera is not supported in this runtime
          if (isMounted) setCameraStatus('idle');
        }
      } else {
        if (isMounted) setCameraStatus('idle');
      }

      // Check backend
      if (isMounted) {
        checkBackend();
      }
    }

    initialProbe();

    return () => {
      isMounted = false;
    };
  }, [requestCamera, checkBackend, stopCamera]);

  // 2. Track fullscreen state changes
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    // Initial sync
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 3. Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    camera: {
      status: cameraStatus,
      stream: cameraStream,
      deviceLabel: cameraDeviceLabel,
      error: cameraError,
      remedy: cameraRemedy,
      requestCamera,
      stopCamera,
    },
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
