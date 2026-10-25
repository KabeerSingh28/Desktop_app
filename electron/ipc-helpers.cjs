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
  EXAM_SHOW_RULES:            'athena:exam:show-rules',
  EXAM_START_SESSION:         'athena:exam:start-session',
  EXAM_GET_REMAINING_TIME:    'athena:exam:get-remaining-time',
  EXAM_SUBMIT_SESSION:        'athena:exam:submit-session',
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
// Exports – CommonJS so this file loads in both Electron and Vitest
// ---------------------------------------------------------------------------
module.exports = {
  CHANNELS,
  validateString,
  validateCandidatePayload,
  validateSessionIdPayload,
  validateSnapshotPayload,
};
