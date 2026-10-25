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
  EVIDENCE_SAVE_VIDEO_CHUNK:  'athena:evidence:save-video-chunk',
  EVIDENCE_GET_STATUS:        'athena:evidence:get-status',
  EVIDENCE_CLEANUP:           'athena:evidence:cleanup',
  PROCTOR_RECORD_EVENT:       'athena:proctor:record-event',
  PROCTOR_GET_EVENTS:         'athena:proctor:get-events',
  PROCTOR_EVENT_RECORDED:     'athena:proctor:event-recorded',
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
 * Sanitizes a directory or file path segment to eliminate directory traversal
 * attacks (e.g. "../", absolute paths, null bytes) and special filesystem characters.
 *
 * @param {string} segment
 * @returns {string}
 */
function sanitizePathSegment(segment) {
  if (typeof segment !== 'string') return 'unknown';
  // Strip null bytes and path delimiters, restrict to alphanumeric, hyphen, underscore
  const cleaned = segment.replace(/[\0/\\]/g, '').replace(/[^a-zA-Z0-9_-]/g, '').trim();
  return cleaned || 'unknown';
}

/**
 * Validates the evidence payload for athena:evidence:save-snapshot.
 *
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

  if (payload.trigger !== undefined) {
    validateString(payload.trigger, 'trigger', 32);
  }
  if (payload.timestamp !== undefined) {
    if (typeof payload.timestamp !== 'string' && typeof payload.timestamp !== 'number') {
      throw new TypeError('timestamp must be a string or number');
    }
  }
}

/**
 * Validates the payload for athena:evidence:save-video-chunk.
 *
 * @param {unknown} payload
 * @throws {TypeError}
 */
function validateVideoChunkPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Video chunk payload must be a plain object');
  }
  validateString(payload.sessionId, 'sessionId', 64);

  if (typeof payload.chunk === 'string') {
    // Base64 chunk capped at 10 MB
    validateString(payload.chunk, 'chunk', 10 * 1024 * 1024);
  } else if (!payload.chunk || (!Buffer.isBuffer(payload.chunk) && !(payload.chunk instanceof Uint8Array))) {
    throw new TypeError('chunk must be a base64 string or binary buffer');
  }

  if (payload.mimeType !== undefined) {
    validateString(payload.mimeType, 'mimeType', 64);
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
// Proctoring Event System Specifications & Utilities
// ---------------------------------------------------------------------------

const KNOWN_PROCTOR_EVENT_TYPES = Object.freeze([
  'fullscreen:exit',
  'fullscreen:enter',
  'window:blur',
  'window:focus',
  'visibility:hidden',
  'visibility:visible',
  'navigation:blocked',
  'window-open:blocked',
  'camera:interrupted',
  'camera:terminated',
  'camera:recovered',
  'backend:disconnected',
  'backend:reconnected',
  'monitoring:error',
]);

const PROCTOR_SEVERITIES = Object.freeze(['info', 'warning', 'critical']);
const PROCTOR_SOURCES = Object.freeze(['main-process', 'renderer', 'backend']);

/**
 * Validates a proctoring event payload before sending across IPC or recording.
 *
 * @param {unknown} payload
 * @throws {TypeError}
 */
function validateProctorEventPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Proctoring event payload must be a plain object');
  }

  if (!payload.eventType || !KNOWN_PROCTOR_EVENT_TYPES.includes(payload.eventType)) {
    throw new TypeError(
      `Invalid eventType "${payload.eventType}". Must be one of: ${KNOWN_PROCTOR_EVENT_TYPES.join(', ')}`
    );
  }

  if (!payload.severity || !PROCTOR_SEVERITIES.includes(payload.severity)) {
    throw new TypeError(
      `Invalid severity "${payload.severity}". Must be one of: ${PROCTOR_SEVERITIES.join(', ')}`
    );
  }

  if (payload.source && !PROCTOR_SOURCES.includes(payload.source)) {
    throw new TypeError(
      `Invalid source "${payload.source}". Must be one of: ${PROCTOR_SOURCES.join(', ')}`
    );
  }

  if (payload.metadata !== undefined && (typeof payload.metadata !== 'object' || payload.metadata === null || Array.isArray(payload.metadata))) {
    throw new TypeError('metadata must be a plain object');
  }
}

/**
 * EventDeduplicator
 *
 * Suppresses rapid duplicate event spam and handles stateful transitions.
 * Stateful pairs (e.g. window:blur / window:focus) are tracked so that:
 * 1. Redundant consecutive events (e.g. blur followed by blur without intervening focus) are suppressed.
 * 2. Rapid oscillations within debounceMs (default 400ms) are filtered out.
 * 3. Discrete events (navigation:blocked, window-open:blocked) are throttled if identical within debounceMs.
 */
class EventDeduplicator {
  constructor({ debounceMs = 400 } = {}) {
    this.debounceMs = debounceMs;
    this.statefulMap = new Map();
    this.lastRecordedTimestamps = new Map();

    this.pairedCategories = {
      'window:blur': { category: 'window-focus', state: 'blur' },
      'window:focus': { category: 'window-focus', state: 'focus' },
      'fullscreen:exit': { category: 'fullscreen', state: 'exit' },
      'fullscreen:enter': { category: 'fullscreen', state: 'enter' },
      'visibility:hidden': { category: 'visibility', state: 'hidden' },
      'visibility:visible': { category: 'visibility', state: 'visible' },
      'camera:terminated': { category: 'camera', state: 'terminated' },
      'camera:recovered': { category: 'camera', state: 'recovered' },
      'backend:disconnected': { category: 'backend', state: 'disconnected' },
      'backend:reconnected': { category: 'backend', state: 'reconnected' },
    };
  }

  /**
   * Determines whether an event should be recorded.
   * If true, updates internal deduplication state.
   *
   * @param {{ eventType: string, timestamp?: string | number }} event
   * @returns {boolean}
   */
  shouldRecord(event) {
    if (!event || !event.eventType) return false;

    const eventType = event.eventType;
    const now = typeof event.timestamp === 'number'
      ? event.timestamp
      : (event.timestamp ? new Date(event.timestamp).getTime() : Date.now());

    // 1. Stateful event check
    const paired = this.pairedCategories[eventType];
    if (paired) {
      const currentState = this.statefulMap.get(paired.category);
      // Suppress duplicate consecutive event in same state
      if (currentState === paired.state) {
        return false;
      }

      // Check rapid toggle within debounce window
      const lastRecorded = this.lastRecordedTimestamps.get(eventType) || 0;
      if (now - lastRecorded < this.debounceMs) {
        return false;
      }

      this.statefulMap.set(paired.category, paired.state);
      this.lastRecordedTimestamps.set(eventType, now);
      return true;
    }

    // 2. Discrete events (e.g. navigation:blocked, monitoring:error)
    const lastRecorded = this.lastRecordedTimestamps.get(eventType) || 0;
    if (now - lastRecorded < this.debounceMs) {
      return false; // Throttled
    }

    this.lastRecordedTimestamps.set(eventType, now);
    return true;
  }

  /**
   * Clears all internal deduplication state.
   */
  reset() {
    this.statefulMap.clear();
    this.lastRecordedTimestamps.clear();
  }
}

// ---------------------------------------------------------------------------
// Exports – CommonJS so this file loads in both Electron and Vitest
// ---------------------------------------------------------------------------
module.exports = {
  CHANNELS,
  KNOWN_PROCTOR_EVENT_TYPES,
  PROCTOR_SEVERITIES,
  PROCTOR_SOURCES,
  validateString,
  validateCandidatePayload,
  validateSessionIdPayload,
  validateKioskPayload,
  validateSnapshotPayload,
  validateVideoChunkPayload,
  sanitizePathSegment,
  validateProctorEventPayload,
  EventDeduplicator,
  isAllowedNavigationUrl,
  isRestrictedExamShortcut,
};
