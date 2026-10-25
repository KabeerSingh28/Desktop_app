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
  // Fullscreen is managed by the main process so that kiosk-level enforcement
  // can be added in a later phase without changing the renderer API.
  // -------------------------------------------------------------------------

  /**
   * Requests the main window to enter fullscreen mode.
   * @returns {Promise<{ ok: boolean }>}
   */
  enterFullscreen: () => invoke(CHANNELS.WINDOW_ENTER_FULLSCREEN),

  /**
   * Requests the main window to exit fullscreen mode.
   * Allowed only after exam submission – enforced by the main process.
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  exitFullscreen: () => invoke(CHANNELS.WINDOW_EXIT_FULLSCREEN),

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
   * @param {{ sessionId: string, dataUrl: string }} payload
   * @returns {Promise<{ ok: boolean }>}
   */
  saveSnapshot: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.resolve({ ok: false, error: 'payload must be an object' });
    }
    try {
      assertString(payload.sessionId, 'sessionId', 64);
      assertString(payload.dataUrl, 'dataUrl', 512 * 1024); // 512 KB hard cap
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message });
    }
    if (!payload.dataUrl.startsWith('data:image/')) {
      return Promise.resolve({ ok: false, error: 'dataUrl must be an image data URL' });
    }
    return invoke(CHANNELS.EVIDENCE_SAVE_SNAPSHOT, {
      sessionId: payload.sessionId,
      dataUrl: payload.dataUrl,
    });
  },

});