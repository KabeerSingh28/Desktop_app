/**
 * Preflight Check Utilities
 *
 * Pure validation, error classification, and readiness assessment functions.
 * Framework-independent and unit-tested in Vitest.
 */

export const PLATFORM_INSTRUCTIONS = {
  macos: {
    title: 'macOS Camera Permission Guide',
    steps: [
      'Open System Settings (Apple Menu  → System Settings).',
      'Select "Privacy & Security" in the sidebar.',
      'Click on "Camera" in the list on the right.',
      'Locate "Athena" (or "Electron") and toggle the permission switch ON.',
      'Return to Athena and click "Retry Access" below.',
    ],
  },
  windows: {
    title: 'Windows Camera Permission Guide',
    steps: [
      'Open the Start Menu and select Settings (or press Win + I).',
      'Navigate to "Privacy & Security" → "Camera".',
      'Ensure "Camera access" is toggled ON.',
      'Scroll down to "Let desktop apps access your camera" and ensure it is turned ON.',
      'Return to Athena and click "Retry Access" below.',
    ],
  },
  linux: {
    title: 'Linux Camera Permission Guide',
    steps: [
      'Ensure your user account belongs to the video group: `sudo usermod -a -G video $USER`.',
      'Log out and log back in for group changes to take effect.',
      'Check device availability: `ls -l /dev/video*`.',
      'Return to Athena and click "Retry Access" below.',
    ],
  },
};

/**
 * Classifies getUserMedia DOMExceptions into understandable states and remedy steps.
 *
 * @param {Error|DOMException} error
 * @returns {{ status: 'denied' | 'unavailable' | 'unsupported', message: string, remedy: string }}
 */
export function evaluateCameraError(error) {
  if (!error) {
    return {
      status: 'unavailable',
      message: 'Unknown camera error occurred.',
      remedy: 'Please verify that your webcam is connected and functioning.',
    };
  }

  const name = error.name || '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      status: 'denied',
      message: 'Camera access was denied by the user or operating system policy.',
      remedy: 'Please grant camera permission in your operating system settings and click "Retry Access".',
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      status: 'unavailable',
      message: 'No video input device (webcam) was detected on this computer.',
      remedy: 'Please connect a functional USB or built-in webcam and click "Retry Access".',
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      status: 'unavailable',
      message: 'The camera is currently locked or in use by another application.',
      remedy: 'Please close any other programs using your webcam (e.g. Zoom, Microsoft Teams, FaceTime, Skype) and click "Retry Access".',
    };
  }

  if (name === 'OverconstrainedError') {
    return {
      status: 'unavailable',
      message: 'The requested video resolution or frame rate constraints cannot be satisfied.',
      remedy: 'Ensure your camera supports standard video capture (640x480) and click "Retry Access".',
    };
  }

  if (name === 'SecurityError') {
    return {
      status: 'denied',
      message: 'Camera access is restricted by document security policy or frame configuration.',
      remedy: 'Please launch the app in a standard trusted window.',
    };
  }

  if (name === 'AbortError') {
    return {
      status: 'unavailable',
      message: 'A hardware error occurred while accessing the webcam.',
      remedy: 'Please disconnect and reconnect your camera, then click "Retry Access".',
    };
  }

  return {
    status: 'denied',
    message: error.message || 'Unable to open camera stream.',
    remedy: 'Please check your camera settings and try again.',
  };
}

/**
 * Evaluates backend health by sending a lightweight ping request.
 *
 * @param {string} baseUrl
 * @param {typeof fetch} [fetchFn=fetch]
 * @param {number} [timeoutMs=3500]
 * @returns {Promise<{ ok: boolean, latencyMs: number | null, error: string | null }>}
 */
export async function checkBackendHealth(baseUrl, fetchFn = fetch, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    const res = await fetchFn(`${baseUrl}/`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const latencyMs = Math.round(performance.now() - start);
      return { ok: true, latencyMs, error: null };
    }

    return {
      ok: false,
      latencyMs: null,
      error: `Backend returned unexpected status ${res.status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return {
      ok: false,
      latencyMs: null,
      error: isTimeout ? 'Backend health check timed out' : (err.message || 'Connection refused'),
    };
  }
}

/**
 * Validates whether all mandatory preflight conditions and user inputs
 * are met before allowing the candidate to start the assessment.
 *
 * @param {{
 *   name: string,
 *   userId: string,
 *   cameraStatus: string,
 *   backendStatus: string,
 *   isFullscreen: boolean,
 *   hasConsented: boolean
 * }} params
 * @returns {{ ready: boolean, missingRequirements: string[] }}
 */
export function canStartExam({
  name,
  userId,
  cameraStatus,
  backendStatus,
  isFullscreen,
  hasConsented,
}) {
  const missing = [];

  if (!name || typeof name !== 'string' || name.trim() === '') {
    missing.push('Candidate full name is required');
  }

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    missing.push('Student ID / URN is required');
  }

  if (cameraStatus !== 'granted' && cameraStatus !== 'active') {
    missing.push('Camera availability and permission check must be passed');
  }

  if (backendStatus !== 'connected') {
    missing.push('Examination backend service must be connected');
  }

  if (!isFullscreen) {
    missing.push('Application must be in full screen mode');
  }

  if (!hasConsented) {
    missing.push('Explicit proctoring consent must be acknowledged');
  }

  return {
    ready: missing.length === 0,
    missingRequirements: missing,
  };
}
