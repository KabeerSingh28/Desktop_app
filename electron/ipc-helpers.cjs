/**
 * electron/ipc-helpers.cjs
 *
 * Pure validation helpers and the channel-name registry shared between:
 *   - electron/main.cjs   (imported as require)
 *   - electron/preload.cjs (imported as require)
 *   - electron/ipc.test.js (imported via Vitest / ESM)
 *
 * Nothing in this file imports Electron. It is intentionally framework-free
 * so it can be unit-tested by Vitest running in plain Node.
 *
 * Naming convention: athena:<domain>:<action>
 */

'use strict';

const path = require('node:path');

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------
// Single source of truth. Both main.cjs and preload.cjs reference these
// constants, so a typo in one place causes a test failure rather than a
// silent runtime mismatch.
const CHANNELS = Object.freeze({
  APP_GET_STATUS:             'athena:app:get-status',
  WINDOW_ENTER_FULLSCREEN:    'athena:window:enter-fullscreen',
  WINDOW_EXIT_FULLSCREEN:     'athena:window:exit-fullscreen',
  WINDOW_GET_STATE:           'athena:window:get-state',
  WINDOW_SET_KIOSK:           'athena:window:set-kiosk',
  WINDOW_STATE_CHANGED:       'athena:window:state-changed',
  WINDOW_RESTORE_NORMAL:      'athena:window:restore-normal',
  EXAM_SHOW_RULES:            'athena:exam:show-rules',
  EXAM_START_SESSION:         'athena:exam:start-session',
  EXAM_GET_REMAINING_TIME:    'athena:exam:get-remaining-time',
  EXAM_SUBMIT_SESSION:        'athena:exam:submit-session',
  EXAM_CANCEL_SESSION:        'athena:exam:cancel-session',
  EVIDENCE_SAVE_SNAPSHOT:     'athena:evidence:save-snapshot',
});

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

/**
 * Asserts that value is a non-empty string within maxLen characters.
 * @param {unknown} value
 * @param {string}  name    Field name, used in the error message.
 * @param {number}  [maxLen=256]
 * @throws {TypeError}
 */
function validateString(value, name, maxLen = 256) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (value.length > maxLen) {
    throw new TypeError(`${name} exceeds maximum length of ${maxLen} chars`);
  }
}

// ---------------------------------------------------------------------------
// Domain-specific payload validators
// ---------------------------------------------------------------------------

/**
 * Validates the candidate payload for athena:exam:start-session.
 * @param {unknown} payload
 * @throws {TypeError}
 */
function validateCandidatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Payload must be a plain object');
  }
  validateString(payload.name,   'name',   128);
  validateString(payload.userId, 'userId',  64);
}

/**
 * Validates the session-id payload for athena:exam:submit-session.
 * @param {unknown} payload
 * @throws {TypeError}
 */
function validateSessionIdPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Payload must be a plain object');
  }
  validateString(payload.sessionId, 'sessionId', 64);
}

/**
 * Validates the kiosk toggle payload for athena:window:set-kiosk.
 * @param {unknown} payload
 * @throws {TypeError}
 */
function validateKioskPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Payload must be a plain object');
  }
  if (typeof payload.enabled !== 'boolean') {
    throw new TypeError('enabled must be a boolean');
  }
}

/**
 * Validates the evidence payload for athena:evidence:save-snapshot.
 * @param {unknown} payload
 * @throws {TypeError}
 */
function validateSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Payload must be a plain object');
  }
  validateString(payload.sessionId, 'sessionId', 64);
  // 512 KB hard cap on the full data URL string (header + base64 body)
  validateString(payload.dataUrl, 'dataUrl', 512 * 1024);

  if (!payload.dataUrl.startsWith('data:image/')) {
    throw new TypeError('dataUrl must be an image data URL');
  }
  if (!payload.dataUrl.includes(',')) {
    throw new TypeError('Invalid data URL format');
  }
}

// ---------------------------------------------------------------------------
// Security & Navigation Rules
// ---------------------------------------------------------------------------

/**
 * Validates whether an incoming navigation or redirect URL is allowed.
 * Strictly checks exact origin in development or exact normalized file path
 * in production, preventing open-redirects and arbitrary external browsing.
 *
 * @param {string} targetUrl
 * @param {{
 *   isDev: boolean,
 *   devServerUrl?: string,
 *   distHtmlPath?: string
 * }} options
 * @returns {boolean}
 */
function isAllowedNavigationUrl(targetUrl, { isDev, devServerUrl = 'http://localhost:5173/', distHtmlPath = '' } = {}) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;

  try {
    const parsed = new URL(targetUrl);

    // Development Mode: strict origin matching against Vite dev server
    if (isDev) {
      if (parsed.protocol === 'data:' || targetUrl === 'about:blank') {
        return true;
      }
      const devOrigin = new URL(devServerUrl).origin;
      return parsed.origin === devOrigin;
    }

    // Production Mode: strict file URL matching against packaged index.html
    if (parsed.protocol === 'file:') {
      if (!distHtmlPath) return false;
      const expectedPath = path.normalize(distHtmlPath);
      // Decode URI components (e.g. %20 for spaces in user paths)
      const targetPath = path.normalize(decodeURIComponent(parsed.pathname));

      if (process.platform === 'win32') {
        return targetPath.toLowerCase() === expectedPath.toLowerCase();
      }
      return targetPath === expectedPath;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Determines whether a keyboard input event during an active exam (or in production)
 * represents a restricted shortcut that could reload, open dev tools, or interfere
 * with assessment security.
 *
 * NOTE: Emergency OS controls (such as macOS Cmd+Q or Windows Alt+F4 / Ctrl+Alt+Del)
 * are NEVER intercepted, ensuring the machine's owner can safely exit.
 *
 * @param {object} input - Electron before-input-event input descriptor
 * @param {{ isDev: boolean, examInProgress: boolean }} options
 * @returns {boolean}
 */
function isRestrictedExamShortcut(input, { isDev = false, examInProgress = false } = {}) {
  if (!input || input.type !== 'keyDown') return false;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '');
  const hasMeta = Boolean(input.meta);
  const hasCtrl = Boolean(input.control);
  const hasAlt = Boolean(input.alt);
  const hasShift = Boolean(input.shift);
  const isCmdOrCtrl = hasMeta || hasCtrl;

  // 1. Reloading shortcuts (Cmd+R, Ctrl+R, F5, Cmd+Shift+R, Ctrl+Shift+R)
  if (isCmdOrCtrl && (key === 'r' || code === 'KeyR')) {
    return true;
  }
  if (key === 'f5' || code === 'F5') {
    return true;
  }

  // 2. DevTools shortcuts (F12, Cmd+Alt+I, Ctrl+Shift+I, Cmd+Alt+J, Ctrl+Shift+J)
  // Restricted in production always, and in dev when exam is active
  if (!isDev || examInProgress) {
    if (key === 'f12' || code === 'F12') {
      return true;
    }
    if ((hasMeta && hasAlt) || (hasCtrl && hasShift)) {
      if (['i', 'j', 'c'].includes(key) || ['KeyI', 'KeyJ', 'KeyC'].includes(code)) {
        return true;
      }
    }
  }

  // 3. Printing (Cmd+P, Ctrl+P) during active exam
  if (examInProgress && isCmdOrCtrl && (key === 'p' || code === 'KeyP')) {
    return true;
  }

  // 4. View Source & Page Saving (Cmd+U, Ctrl+U, Cmd+S, Ctrl+S) during active exam
  if (examInProgress && isCmdOrCtrl && (['u', 's'].includes(key) || ['KeyU', 'KeyS'].includes(code))) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Exports – CommonJS so this file loads in both Electron and Vitest
// ---------------------------------------------------------------------------
module.exports = {
  CHANNELS,
  validateString,
  validateCandidatePayload,
  validateSessionIdPayload,
  validateKioskPayload,
  validateSnapshotPayload,
  isAllowedNavigationUrl,
  isRestrictedExamShortcut,
};
