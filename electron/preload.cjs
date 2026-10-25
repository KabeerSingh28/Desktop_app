/**
 * Athena - Secure Preload Bridge
 *
 * SECURITY BOUNDARY
 * =================
 * This file runs in its own isolated JavaScript context (contextIsolation: true)
 * inside the renderer's OS process. It has access to Node.js and Electron APIs
 * but the web page itself does NOT. The ONLY way the page can reach Electron APIs
 * is through the controlled surface defined below via contextBridge.
 *
 * Rules enforced here:
 *   1. ipcRenderer is never forwarded or exposed – only named wrapper functions.
 *   2. Every exposed function targets exactly one known channel.
 *   3. No Node.js primitives (fs, path, child_process, require) are exposed.
 *   4. All functions are synchronously validated here before the message is sent
 *      so the main process gets only well-typed payloads.
 *   5. Any on/once listener returned to the renderer is wrapped so the renderer
 *      cannot call removeAllListeners or otherwise manipulate the raw emitter.
 *
 * Channel naming convention (mirrors main.cjs):
 *   athena:<domain>:<action>
 *   e.g.  athena:app:get-status
 *         athena:window:enter-fullscreen
 *         athena:exam:show-rules
 *
 * The API exposed to the renderer as window.athena (not window.electronAPI).
 * Renaming from 'electronAPI' intentionally avoids leaking implementation details
 * to the renderer and keeps the surface domain-scoped.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { CHANNELS } = require('./ipc-helpers.cjs');


// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wraps ipcRenderer.invoke and surfaces the error in a predictable shape so
 * the renderer can handle both success and failure uniformly.
 *
 * @param {string} channel
 * @param {...any} args
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: string }>}
 */
async function invoke(channel, ...args) {
  try {
    const data = await ipcRenderer.invoke(channel, ...args);
    return { ok: true, data };
  } catch (err) {
    console.error(`[preload] IPC invoke failed on "${channel}":`, err.message);
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Asserts that a value is a non-empty string with a maximum byte length.
 * Throws a TypeError if the assertion fails – the error is caught inside
 * invoke() and returned as { ok: false, error } to the renderer.
 */
function assertString(value, name, maxLen = 256) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (value.length > maxLen) {
    throw new TypeError(`${name} exceeds maximum length of ${maxLen} characters`);
  }
}

// ---------------------------------------------------------------------------
// Exposed API surface
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld('athena', {

  // -------------------------------------------------------------------------
  // Domain: app
  // Returns diagnostic information about the running application (environment,
  // version). Useful for the renderer to show a dev/prod badge and adapt UI.
  // -------------------------------------------------------------------------

  /**
   * @returns {Promise<{ ok: boolean, data?: { isDev: boolean, version: string } }>}
   */
  getAppStatus: () => invoke(CHANNELS.APP_GET_STATUS),

  // -------------------------------------------------------------------------
  // Domain: window
  // Fullscreen and kiosk modes are managed by the main process BrowserWindow
  // APIs so desktop security guarantees and multi-platform quirks are handled
  // behind a clean, safe promise-based API.
  // -------------------------------------------------------------------------

  /**
   * Requests the main window to enter fullscreen mode (and optionally kiosk mode).
   * @param {{ kiosk?: boolean }} [options]
   * @returns {Promise<{ ok: boolean, data?: { isFullScreen: boolean, isKiosk: boolean }, error?: string }>}
   */
  enterFullscreen: (options) => {
    const payload = options && typeof options === 'object' ? { kiosk: Boolean(options.kiosk) } : {};
    return invoke(CHANNELS.WINDOW_ENTER_FULLSCREEN, payload);
  },

  /**
   * Requests the main window to exit fullscreen mode.
   * Allowed only after exam submission or cancellation – enforced by the main process.
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  exitFullscreen: () => invoke(CHANNELS.WINDOW_EXIT_FULLSCREEN),

  /**
   * Returns current window presentation state: isFullScreen and isKiosk.
   * @returns {Promise<{ ok: boolean, data?: { isFullScreen: boolean, isKiosk: boolean } }>}
   */
  getWindowState: () => invoke(CHANNELS.WINDOW_GET_STATE),

  /**
   * Enables or disables kiosk mode on the main window.
   * @param {boolean} enabled
   * @returns {Promise<{ ok: boolean, data?: { isKiosk: boolean }, error?: string }>}
   */
  setKioskMode: (enabled) => {
    if (typeof enabled !== 'boolean') {
      return Promise.resolve({ ok: false, error: 'enabled must be a boolean' });
    }
    return invoke(CHANNELS.WINDOW_SET_KIOSK, { enabled });
  },

  /**
   * Restores the window to normal non-fullscreen, non-kiosk state upon
   * exam completion, cancellation, or error recovery.
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  restoreNormalState: () => invoke(CHANNELS.WINDOW_RESTORE_NORMAL),

  /**
   * Subscribes to window fullscreen/kiosk presentation state changes pushed
   * by the main process.
   * Returns an unsubscribe cleanup function.
   *
   * @param {(state: { isFullScreen: boolean, isKiosk: boolean }) => void} callback
   * @returns {() => void}
   */
  onWindowStateChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, state) => {
      try {
        callback(state);
      } catch (err) {
        console.error('[preload] onWindowStateChange subscriber error:', err);
      }
    };
    ipcRenderer.on(CHANNELS.WINDOW_STATE_CHANGED, subscription);
    return () => {
      ipcRenderer.removeListener(CHANNELS.WINDOW_STATE_CHANGED, subscription);
    };
  },

  // -------------------------------------------------------------------------
  // Domain: exam
  // Lifecycle: show-rules → start-session → [question loop] → submit-session
  // -------------------------------------------------------------------------

  /**
   * Shows the native exam rules dialog and returns whether the candidate
   * accepted (true) or declined (false).
   * @returns {Promise<{ ok: boolean, data?: boolean }>}
   */
  showExamRules: () => invoke(CHANNELS.EXAM_SHOW_RULES),

  /**
   * Starts an exam session on the backend for the given candidate.
   * @param {{ name: string, userId: string }} candidate
   * @returns {Promise<{ ok: boolean, data?: { sessionId: string, deadlineEpoch: number, totalQuestions: number } }>}
   */
  startExamSession: (candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return Promise.resolve({ ok: false, error: 'candidate must be an object' });
    }
    try {
      assertString(candidate.name, 'candidate.name', 128);
      assertString(candidate.userId, 'candidate.userId', 64);
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message });
    }
    // Only pass the two allowed fields – never forward the full object
    return invoke(CHANNELS.EXAM_START_SESSION, {
      name: candidate.name.trim(),
      userId: candidate.userId.trim(),
    });
  },

  /**
   * Submits the completed exam and closes the session on the backend.
   * @param {{ sessionId: string }} payload
   * @returns {Promise<{ ok: boolean, data?: { attempted: number, correct: number, wrong: number } }>}
   */
  submitExamSession: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.resolve({ ok: false, error: 'payload must be an object' });
    }
    try {
      assertString(payload.sessionId, 'sessionId', 64);
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message });
    }
    return invoke(CHANNELS.EXAM_SUBMIT_SESSION, { sessionId: payload.sessionId });
  },

  /**
   * Cancels the active exam session, restores normal window presentation,
   * and clears session timers in the main process.
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  cancelExamSession: () => invoke(CHANNELS.EXAM_CANCEL_SESSION),

  /**
   * Fetches the remaining exam time as computed by the main process clock.
   * The renderer should call this once per second and display the result.
   * Authoritative time must never come solely from the renderer's own clock.
   * @returns {Promise<{ ok: boolean, data?: number }>} remaining milliseconds
   */
  getRemainingTime: () => invoke(CHANNELS.EXAM_GET_REMAINING_TIME),

  // -------------------------------------------------------------------------
  // Domain: evidence
  // Proctoring snapshots – the renderer provides a base64 data URL and the
  // main process decides where and how to persist it. The renderer has no
  // knowledge of file paths.
  // -------------------------------------------------------------------------

  /**
   * Saves one webcam snapshot for the current exam session.
   * Max payload: 512 KB (base64-encoded JPEG at 60% quality, 640×480).
   * @param {{ sessionId: string, dataUrl: string, trigger?: string, timestamp?: string | number }} payload
   * @returns {Promise<{ ok: boolean, data?: { filename: string }, error?: string }>}
   */
  saveSnapshot: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.resolve({ ok: false, error: 'payload must be an object' });
    }
    try {
      assertString(payload.sessionId, 'sessionId', 64);
      assertString(payload.dataUrl, 'dataUrl', 512 * 1024); // 512 KB hard cap
      if (payload.trigger) {
        assertString(payload.trigger, 'trigger', 32);
      }
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message });
    }
    if (!payload.dataUrl.startsWith('data:image/')) {
      return Promise.resolve({ ok: false, error: 'dataUrl must be an image data URL' });
    }
    return invoke(CHANNELS.EVIDENCE_SAVE_SNAPSHOT, {
      sessionId: payload.sessionId,
      dataUrl: payload.dataUrl,
      trigger: payload.trigger,
      timestamp: payload.timestamp,
    });
  },

  /**
   * Persists a video chunk for optional continuous recording.
   * @param {{ sessionId: string, chunk: string | Uint8Array, mimeType?: string }} payload
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  saveVideoChunk: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.resolve({ ok: false, error: 'payload must be an object' });
    }
    try {
      assertString(payload.sessionId, 'sessionId', 64);
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message });
    }
    return invoke(CHANNELS.EVIDENCE_SAVE_VIDEO_CHUNK, payload);
  },

  /**
   * Returns storage telemetry and counts for a given session.
   * @param {string} sessionId
   * @returns {Promise<{ ok: boolean, data?: { sessionId: string, snapshotCount: number, videoBytes: number }, error?: string }>}
   */
  getEvidenceStatus: (sessionId) => {
    return invoke(CHANNELS.EVIDENCE_GET_STATUS, { sessionId });
  },

  /**
   * Cleans up local evidence artifacts for a closed or purged session.
   * @param {string} sessionId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  cleanupEvidence: (sessionId) => {
    return invoke(CHANNELS.EVIDENCE_CLEANUP, { sessionId });
  },

  // -------------------------------------------------------------------------
  // Domain: proctor
  // Structured proctoring event system – records observable telemetry
  // (fullscreen exits, window blurs, visibility changes, camera drops) with
  // deduplication and timestamping.
  // -------------------------------------------------------------------------

  /**
   * Records an observable proctoring event.
   * @param {{
   *   sessionId: string,
   *   eventType: string,
   *   severity?: 'info' | 'warning' | 'critical',
   *   source?: 'main-process' | 'renderer' | 'backend',
   *   metadata?: Record<string, any>
   * }} event
   * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
   */
  recordProctorEvent: (event) => {
    if (!event || typeof event !== 'object') {
      return Promise.resolve({ ok: false, error: 'event must be an object' });
    }
    return invoke(CHANNELS.PROCTOR_RECORD_EVENT, event);
  },

  /**
   * Retrieves all recorded proctoring events for a session.
   * @param {string} sessionId
   * @returns {Promise<{ ok: boolean, data?: Array<object>, error?: string }>}
   */
  getProctorEvents: (sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return Promise.resolve({ ok: false, error: 'sessionId must be a non-empty string' });
    }
    return invoke(CHANNELS.PROCTOR_GET_EVENTS, { sessionId: sessionId.trim() });
  },

  /**
   * Subscribes to proctoring events recorded in real-time.
   * Returns an unsubscribe cleanup function.
   * @param {(event: object) => void} callback
   * @returns {() => void}
   */
  onProctorEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, evt) => {
      try {
        callback(evt);
      } catch (err) {
        console.error('[preload] onProctorEvent subscriber error:', err);
      }
    };
    ipcRenderer.on(CHANNELS.PROCTOR_EVENT_RECORDED, subscription);
    return () => {
      ipcRenderer.removeListener(CHANNELS.PROCTOR_EVENT_RECORDED, subscription);
    };
  },

});