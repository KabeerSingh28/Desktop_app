/**
 * Custom Hook: useWebcam
 *
 * Dedicated hook separating webcam hardware lifecycle management from presentation components.
 *
 * Stream Ownership & Lifecycle Guarantees:
 * 1. Single Authoritative Owner:
 *    - This hook is the sole owner and manager of the underlying MediaStream instance.
 *    - Presentation components (e.g., ReadinessScreen, ActiveExam) receive the stream
 *      reference solely to bind to video.srcObject. They should never stop tracks manually.
 *
 * 2. Explicit User-Triggered Acquisition:
 *    - Camera access is NEVER initiated automatically on component mount.
 *    - The user must perform an explicit action (e.g., clicking "Enable Camera") to call requestCamera().
 *
 * 3. Idempotent Stream Reuse:
 *    - If an active stream with live tracks already exists, requestCamera() reuses it
 *      instead of querying getUserMedia repeatedly across component re-renders.
 *
 * 4. Unexpected Termination Detection:
 *    - Listens to MediaStreamTrack 'ended', 'mute', and 'unmute' events.
 *    - If a physical webcam is unplugged, locked, or permissions revoked, transitions
 *      state to 'ended' and sets recovery instructions.
 *
 * 5. Deterministic Teardown:
 *    - All media tracks are stopped (track.stop()) upon unmount, explicit stop, or retry.
 *    - This releases the hardware device immediately and turns off the camera indicator LED.
 *    - Detaches all event listeners to prevent memory leaks.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { evaluateCameraError } from '../utils/preflightHelpers.js';
import { isStreamLive } from '../utils/cameraUtils.js';

export function useWebcam() {
  // Current webcam lifecycle status:
  // 'idle'        -> Initial state; no camera requested yet
  // 'checking'    -> Awaiting user permission prompt or hardware initialization
  // 'granted'     -> Stream active and live video tracks producing frames
  // 'denied'      -> User declined or OS privacy policy prevented access
  // 'unavailable' -> Hardware missing, unplugged, or locked by another app
  // 'unsupported' -> MediaDevices API missing in runtime environment
  // 'ended'       -> Stream unexpectedly terminated (e.g., USB unplugged)
  const [, setTick] = useState(0);
  const triggerRender = useCallback(() => setTick((t) => t + 1), []);

  const statusRef = useRef('idle');
  const streamRef = useRef(null);
  const deviceLabelRef = useRef(null);
  const deviceIdRef = useRef(null);
  const errorRef = useRef(null);
  const remedyRef = useRef(null);

  const updateStatus = useCallback((s) => {
    statusRef.current = s;
    triggerRender();
  }, [triggerRender]);

  const updateStream = useCallback((st) => {
    streamRef.current = st;
    triggerRender();
  }, [triggerRender]);

  const updateError = useCallback((e) => {
    errorRef.current = e;
    triggerRender();
  }, [triggerRender]);

  const updateRemedy = useCallback((r) => {
    remedyRef.current = r;
    triggerRender();
  }, [triggerRender]);

  const updateDeviceLabel = useCallback((l) => {
    deviceLabelRef.current = l;
    triggerRender();
  }, [triggerRender]);

  const updateDeviceId = useCallback((id) => {
    deviceIdRef.current = id;
    triggerRender();
  }, [triggerRender]);

  // References to event listeners for clean detachment
  const listenersRef = useRef(null);

  /**
   * Internal Helper: Cleans up all track listeners and terminates all tracks
   * in the active MediaStream, releasing hardware locks.
   */
  const cleanupStream = useCallback(() => {
    // 1. Detach track-level listeners
    if (listenersRef.current) {
      const { track, handleEnded, handleMute, handleUnmute } = listenersRef.current;
      if (track) {
        try {
          track.removeEventListener('ended', handleEnded);
          track.removeEventListener('mute', handleMute);
          track.removeEventListener('unmute', handleUnmute);
        } catch (e) {
          console.warn('[useWebcam] Notice removing track listeners:', e);
        }
      }
      listenersRef.current = null;
    }

    // 2. Stop each track to turn off webcam hardware LED
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('[useWebcam] Notice stopping media track:', e);
        }
      });
      streamRef.current = null;
    }

    updateStream(null);
    updateDeviceLabel(null);
    updateDeviceId(null);
  }, [updateDeviceId, updateDeviceLabel, updateStream]);

  /**
   * Handles unexpected video track termination (e.g., USB camera unplugged,
   * system sleep, or OS permission revoked while in use).
   */
  const handleTrackEnded = useCallback((track) => {
    console.warn('[useWebcam] Video track ended unexpectedly:', track?.label || 'Camera');
    cleanupStream();
    updateStatus('ended');
    updateError('Webcam feed was disconnected or terminated unexpectedly.');
    updateRemedy('Please ensure your camera is securely connected and click "Retry Access".');
  }, [cleanupStream, updateError, updateRemedy, updateStatus]);

  /**
   * Requests camera access via navigator.mediaDevices.getUserMedia.
   *
   * Reuses an existing live stream if one is already open and valid.
   *
   * @param {MediaStreamConstraints} [customConstraints]
   * @returns {Promise<MediaStream | null>}
   */
  const requestCamera = useCallback(async (customConstraints) => {
    // 1. Verify environment support for MediaDevices
    if (!navigator?.mediaDevices?.getUserMedia) {
      updateStatus('unsupported');
      updateError('MediaDevices.getUserMedia is not supported in this runtime environment.');
      updateRemedy('Please run Athena inside the supported desktop application.');
      return null;
    }

    // 2. Avoid requesting a new stream repeatedly if an existing valid stream is live
    if (isStreamLive(streamRef.current)) {
      const activeTrack = streamRef.current.getVideoTracks()[0];
      updateStatus('granted');
      updateStream(streamRef.current);
      updateDeviceLabel(activeTrack?.label || 'Default Camera Device');
      updateError(null);
      updateRemedy(null);
      return streamRef.current;
    }

    // 3. Clean up any previous dead or stale stream before requesting a fresh one
    cleanupStream();

    updateStatus('checking');
    updateError(null);
    updateRemedy(null);

    try {
      // Secure constraints: standard resolution, user-facing, strictly NO audio/microphone
      const defaultConstraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false, // Audio monitoring is explicitly disabled
      };

      const constraints = customConstraints || defaultConstraints;
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);

      updateStream(newStream);

      const track = newStream.getVideoTracks()[0];
      if (track) {
        updateDeviceLabel(track.label || 'Default Camera Device');
        updateDeviceId(track.getSettings?.()?.deviceId || null);

        // Attach event listeners for unexpected termination and mute events
        const handleEnded = () => handleTrackEnded(track);
        const handleMute = () => {
          console.warn('[useWebcam] Video track temporarily muted (no frames)');
        };
        const handleUnmute = () => {
          console.info('[useWebcam] Video track unmuted (frames resuming)');
        };

        track.addEventListener('ended', handleEnded);
        track.addEventListener('mute', handleMute);
        track.addEventListener('unmute', handleUnmute);

        listenersRef.current = { track, handleEnded, handleMute, handleUnmute };
      }

      updateStatus('granted');
      updateError(null);
      updateRemedy(null);
      return newStream;
    } catch (err) {
      const classified = evaluateCameraError(err);
      updateStatus(classified.status);
      updateError(classified.message);
      updateRemedy(classified.remedy);
      cleanupStream();
      return null;
    }
  }, [
    cleanupStream,
    handleTrackEnded,
    updateDeviceId,
    updateDeviceLabel,
    updateError,
    updateRemedy,
    updateStatus,
    updateStream,
  ]);

  /**
   * Explicitly stops all tracks, resets state to 'idle', and turns off the camera LED.
   */
  const stopCamera = useCallback(() => {
    cleanupStream();
    updateStatus('idle');
    updateError(null);
    updateRemedy(null);
  }, [cleanupStream, updateError, updateRemedy, updateStatus]);

  /**
   * Controlled retry/reinitialization flow.
   * Completely tears down any previous stream and requests a brand new one.
   *
   * @param {MediaStreamConstraints} [customConstraints]
   * @returns {Promise<MediaStream | null>}
   */
  const restartCamera = useCallback(async (customConstraints) => {
    cleanupStream();
    return requestCamera(customConstraints);
  }, [cleanupStream, requestCamera]);

  /**
   * Hardware change detection: Listen to navigator.mediaDevices 'devicechange'
   * events to detect if the active webcam was disconnected at the OS level.
   */
  useEffect(() => {
    async function handleDeviceChange() {
      if (streamRef.current && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          if (videoInputs.length === 0) {
            handleTrackEnded();
          }
        } catch {
          // Ignore enumeration errors
        }
      }
    }

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    return () => {
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
    };
  }, [handleTrackEnded]);

  /**
   * Deterministic cleanup on component unmount:
   * Guarantees all camera tracks are stopped when leaving the view.
   */
  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
    get status() {
      return statusRef.current;
    },
    get stream() {
      return streamRef.current;
    },
    get deviceLabel() {
      return deviceLabelRef.current;
    },
    get deviceId() {
      return deviceIdRef.current;
    },
    get error() {
      return errorRef.current;
    },
    get remedy() {
      return remedyRef.current;
    },
    get isLive() {
      return isStreamLive(streamRef.current);
    },
    requestCamera,
    startCamera: requestCamera,
    stopCamera,
    restartCamera,
  };
}
