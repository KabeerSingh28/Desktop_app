/**
 * IPC contract tests – pure validation / helper logic only.
 *
 * These tests run entirely in Node.js / Vitest without launching Electron.
 * They exercise:
 *   1. The payload validation logic that the main process and preload share.
 *   2. The channel name registry to catch typos between preload and main.
 *   3. The data-URL guard logic used in athena:evidence:save-snapshot.
 *   4. Exact-origin/file navigation allowlist validation.
 *   5. Keyboard shortcut filtering and protection during active exams.
 *
 * No Electron objects are imported; all logic under test is extracted into
 * plain functions in electron/ipc-helpers.cjs and imported here.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  validateString,
  validateSnapshotPayload,
  validateVideoChunkPayload,
  sanitizePathSegment,
  validateCandidatePayload,
  validateSessionIdPayload,
  validateKioskPayload,
  calculateRemainingTime,
  validateProctorEventPayload,
  EventDeduplicator,
  isAllowedNavigationUrl,
  isRestrictedExamShortcut,
  CHANNELS,
} from '../electron/ipc-helpers.cjs';

// ---------------------------------------------------------------------------
// validateString
// ---------------------------------------------------------------------------
describe('validateString', () => {
  it('passes for a normal string', () => {
    expect(() => validateString('Alice', 'name')).not.toThrow();
  });

  it('throws for an empty string', () => {
    expect(() => validateString('', 'name')).toThrow(TypeError);
    expect(() => validateString('', 'name')).toThrow('name must be a non-empty string');
  });

  it('throws for a whitespace-only string', () => {
    expect(() => validateString('   ', 'name')).toThrow(TypeError);
  });

  it('throws for a non-string value', () => {
    expect(() => validateString(42, 'name')).toThrow(TypeError);
    expect(() => validateString(null, 'name')).toThrow(TypeError);
    expect(() => validateString(undefined, 'name')).toThrow(TypeError);
  });

  it('throws when the string exceeds maxLen', () => {
    const long = 'a'.repeat(257);
    expect(() => validateString(long, 'name', 256)).toThrow('exceeds maximum length');
  });

  it('passes for a string exactly at maxLen', () => {
    const exact = 'a'.repeat(256);
    expect(() => validateString(exact, 'name', 256)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateCandidatePayload  (used by athena:exam:start-session)
// ---------------------------------------------------------------------------
describe('validateCandidatePayload', () => {
  it('passes for valid candidate', () => {
    expect(() =>
      validateCandidatePayload({ name: 'Alice', userId: 'u-001' }),
    ).not.toThrow();
  });

  it('throws when payload is null', () => {
    expect(() => validateCandidatePayload(null)).toThrow(TypeError);
  });

  it('throws when payload is an array', () => {
    expect(() => validateCandidatePayload(['Alice', 'u-001'])).toThrow(TypeError);
  });

  it('throws when name is missing', () => {
    expect(() => validateCandidatePayload({ userId: 'u-001' })).toThrow(TypeError);
  });

  it('throws when userId is missing', () => {
    expect(() => validateCandidatePayload({ name: 'Alice' })).toThrow(TypeError);
  });

  it('throws when name is too long (>128 chars)', () => {
    expect(() =>
      validateCandidatePayload({ name: 'a'.repeat(129), userId: 'u-001' }),
    ).toThrow('exceeds maximum length');
  });

  it('throws when userId is too long (>64 chars)', () => {
    expect(() =>
      validateCandidatePayload({ name: 'Alice', userId: 'u'.repeat(65) }),
    ).toThrow('exceeds maximum length');
  });
});

// ---------------------------------------------------------------------------
// validateSessionIdPayload  (used by athena:exam:submit-session)
// ---------------------------------------------------------------------------
describe('validateSessionIdPayload', () => {
  it('passes for a valid sessionId', () => {
    expect(() =>
      validateSessionIdPayload({ sessionId: 'session-1790599029215' }),
    ).not.toThrow();
  });

  it('throws when payload is null', () => {
    expect(() => validateSessionIdPayload(null)).toThrow(TypeError);
  });

  it('throws when sessionId is missing', () => {
    expect(() => validateSessionIdPayload({})).toThrow(TypeError);
  });

  it('throws when sessionId is too long', () => {
    expect(() =>
      validateSessionIdPayload({ sessionId: 's'.repeat(65) }),
    ).toThrow('exceeds maximum length');
  });
});

// ---------------------------------------------------------------------------
// validateKioskPayload  (used by athena:window:set-kiosk)
// ---------------------------------------------------------------------------
describe('validateKioskPayload', () => {
  it('passes for valid boolean payload', () => {
    expect(() => validateKioskPayload({ enabled: true })).not.toThrow();
    expect(() => validateKioskPayload({ enabled: false })).not.toThrow();
  });

  it('throws when payload is null or not a plain object', () => {
    expect(() => validateKioskPayload(null)).toThrow(TypeError);
    expect(() => validateKioskPayload(true)).toThrow(TypeError);
    expect(() => validateKioskPayload(['enabled'])).toThrow(TypeError);
  });

  it('throws when enabled is not boolean', () => {
    expect(() => validateKioskPayload({ enabled: 'true' })).toThrow('enabled must be a boolean');
    expect(() => validateKioskPayload({ enabled: 1 })).toThrow('enabled must be a boolean');
    expect(() => validateKioskPayload({})).toThrow('enabled must be a boolean');
  });
});

// ---------------------------------------------------------------------------
// validateSnapshotPayload  (used by athena:evidence:save-snapshot)
// ---------------------------------------------------------------------------
describe('validateSnapshotPayload', () => {
  const validDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('passes for a valid snapshot payload', () => {
    expect(() =>
      validateSnapshotPayload({ sessionId: 'sess-1', dataUrl: validDataUrl }),
    ).not.toThrow();
  });

  it('throws when payload is null', () => {
    expect(() => validateSnapshotPayload(null)).toThrow(TypeError);
  });

  it('throws when dataUrl does not start with data:image/', () => {
    expect(() =>
      validateSnapshotPayload({ sessionId: 'sess-1', dataUrl: 'data:text/plain;base64,abc' }),
    ).toThrow('must be an image data URL');
  });

  it('throws when dataUrl lacks a comma (invalid format)', () => {
    expect(() =>
      validateSnapshotPayload({ sessionId: 'sess-1', dataUrl: 'data:image/jpeg;base64' }),
    ).toThrow('Invalid data URL format');
  });

  it('throws when dataUrl exceeds 512 KB', () => {
    // 512 KB + 1 byte of 'A' characters, prefixed with a valid header
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(512 * 1024 + 1);
    expect(() =>
      validateSnapshotPayload({ sessionId: 'sess-1', dataUrl: huge }),
    ).toThrow('exceeds maximum length');
  });

  it('accepts optional trigger and timestamp', () => {
    expect(() =>
      validateSnapshotPayload({
        sessionId: 'sess-1',
        dataUrl: validDataUrl,
        trigger: 'session:start',
        timestamp: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it('rejects trigger exceeding 32 chars', () => {
    expect(() =>
      validateSnapshotPayload({
        sessionId: 'sess-1',
        dataUrl: validDataUrl,
        trigger: 'a'.repeat(33),
      }),
    ).toThrow(/trigger exceeds maximum length/);
  });

  it('rejects non-string/number timestamp', () => {
    expect(() =>
      validateSnapshotPayload({
        sessionId: 'sess-1',
        dataUrl: validDataUrl,
        timestamp: { date: 'now' },
      }),
    ).toThrow(/timestamp must be a string or number/);
  });
});

// ---------------------------------------------------------------------------
// sanitizePathSegment
// ---------------------------------------------------------------------------
describe('sanitizePathSegment', () => {
  it('preserves clean alphanumeric names and underscores/hyphens', () => {
    expect(sanitizePathSegment('session-123_abc')).toBe('session-123_abc');
  });

  it('strips directory traversal components like ../ and ..\\', () => {
    expect(sanitizePathSegment('../../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizePathSegment('..\\..\\windows\\system32')).toBe('windowssystem32');
  });

  it('strips null bytes and whitespace', () => {
    expect(sanitizePathSegment('file\0name')).toBe('filename');
    expect(sanitizePathSegment('  clean-name  ')).toBe('clean-name');
  });

  it('falls back to "unknown" for empty or non-string inputs', () => {
    expect(sanitizePathSegment('')).toBe('unknown');
    expect(sanitizePathSegment(null)).toBe('unknown');
    expect(sanitizePathSegment(undefined)).toBe('unknown');
    expect(sanitizePathSegment(123)).toBe('unknown');
    expect(sanitizePathSegment('/..//')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// validateVideoChunkPayload
// ---------------------------------------------------------------------------
describe('validateVideoChunkPayload', () => {
  it('accepts valid base64 chunk string', () => {
    expect(() =>
      validateVideoChunkPayload({
        sessionId: 'sess-1',
        chunk: 'GkXfo59ChoEBQveBAULygQ8=',
        mimeType: 'video/webm',
      })
    ).not.toThrow();
  });

  it('accepts Uint8Array chunk buffer', () => {
    expect(() =>
      validateVideoChunkPayload({
        sessionId: 'sess-1',
        chunk: new Uint8Array([1, 2, 3, 4]),
      })
    ).not.toThrow();
  });

  it('throws when payload is null or non-object', () => {
    expect(() => validateVideoChunkPayload(null)).toThrow(TypeError);
    expect(() => validateVideoChunkPayload('bad')).toThrow(TypeError);
  });

  it('throws when chunk is missing or invalid type', () => {
    expect(() =>
      validateVideoChunkPayload({ sessionId: 'sess-1' })
    ).toThrow(/chunk must be a base64 string or binary buffer/);
  });
});

// ---------------------------------------------------------------------------
// calculateRemainingTime
// ---------------------------------------------------------------------------
describe('calculateRemainingTime', () => {
  it('returns positive remaining milliseconds when deadline is in the future', () => {
    const now = 1000000;
    const deadline = now + 45 * 60 * 1000; // 45 minutes
    expect(calculateRemainingTime(deadline, now)).toBe(45 * 60 * 1000);
  });

  it('clamps at 0 when current time equals or exceeds deadline', () => {
    const now = 1000000;
    expect(calculateRemainingTime(now, now)).toBe(0);
    expect(calculateRemainingTime(now - 5000, now)).toBe(0);
  });

  it('returns 0 for non-numeric, null, undefined, or non-finite deadline values', () => {
    expect(calculateRemainingTime(null)).toBe(0);
    expect(calculateRemainingTime(undefined)).toBe(0);
    expect(calculateRemainingTime(NaN)).toBe(0);
    expect(calculateRemainingTime(-1000)).toBe(0);
    expect(calculateRemainingTime('invalid')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isAllowedNavigationUrl
// ---------------------------------------------------------------------------
describe('isAllowedNavigationUrl', () => {
  describe('development mode', () => {
    const devServerUrl = 'http://localhost:5173/';

    it('allows exact origin matching the dev server', () => {
      expect(isAllowedNavigationUrl('http://localhost:5173/', { isDev: true, devServerUrl })).toBe(true);
      expect(isAllowedNavigationUrl('http://localhost:5173/exam?candidate=1', { isDev: true, devServerUrl })).toBe(true);
    });

    it('allows about:blank and data: URLs in dev mode', () => {
      expect(isAllowedNavigationUrl('about:blank', { isDev: true, devServerUrl })).toBe(true);
      expect(isAllowedNavigationUrl('data:text/html,Error', { isDev: true, devServerUrl })).toBe(true);
    });

    it('rejects external websites and ports', () => {
      expect(isAllowedNavigationUrl('https://google.com', { isDev: true, devServerUrl })).toBe(false);
      expect(isAllowedNavigationUrl('http://localhost:3000/', { isDev: true, devServerUrl })).toBe(false);
      expect(isAllowedNavigationUrl('http://attacker.com/localhost:5173', { isDev: true, devServerUrl })).toBe(false);
    });

    it('rejects malformed or empty URLs', () => {
      expect(isAllowedNavigationUrl('', { isDev: true, devServerUrl })).toBe(false);
      expect(isAllowedNavigationUrl('not-a-valid-url', { isDev: true, devServerUrl })).toBe(false);
    });
  });

  describe('production mode', () => {
    const distHtmlPath = path.resolve('/Applications/Athena.app/Contents/Resources/app/dist/index.html');

    it('allows exact file URL matching production index.html', () => {
      expect(
        isAllowedNavigationUrl(`file://${distHtmlPath}`, { isDev: false, distHtmlPath })
      ).toBe(true);
    });

    it('rejects external web origins in production', () => {
      expect(
        isAllowedNavigationUrl('http://localhost:5173/', { isDev: false, distHtmlPath })
      ).toBe(false);
      expect(
        isAllowedNavigationUrl('https://example.com', { isDev: false, distHtmlPath })
      ).toBe(false);
    });

    it('rejects file URLs pointing to different files', () => {
      expect(
        isAllowedNavigationUrl('file:///etc/passwd', { isDev: false, distHtmlPath })
      ).toBe(false);
      expect(
        isAllowedNavigationUrl('file:///Users/attacker/script.html', { isDev: false, distHtmlPath })
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// isRestrictedExamShortcut
// ---------------------------------------------------------------------------
describe('isRestrictedExamShortcut', () => {
  it('blocks reload shortcuts during active exam (Cmd+R, Ctrl+R, F5)', () => {
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'r', meta: true }, { examInProgress: true })).toBe(true);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'R', control: true }, { examInProgress: true })).toBe(true);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'F5' }, { examInProgress: true })).toBe(true);
  });

  it('blocks DevTools shortcuts in production or active exam (F12, Cmd+Alt+I, Ctrl+Shift+I)', () => {
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'F12' }, { isDev: false, examInProgress: false })).toBe(true);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'i', meta: true, alt: true }, { isDev: false, examInProgress: false })).toBe(true);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'j', control: true, shift: true }, { isDev: false, examInProgress: false })).toBe(true);
  });

  it('blocks Print and Save shortcuts during active exam (Cmd+P, Ctrl+P, Cmd+S, Ctrl+S)', () => {
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'p', meta: true }, { examInProgress: true })).toBe(true);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 's', control: true }, { examInProgress: true })).toBe(true);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'u', meta: true }, { examInProgress: true })).toBe(true);
  });

  it('does NOT block emergency system controls like Cmd+Q (macOS)', () => {
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'q', meta: true }, { examInProgress: true })).toBe(false);
  });

  it('does NOT block normal text typing or navigation keys', () => {
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'a' }, { examInProgress: true })).toBe(false);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'Backspace' }, { examInProgress: true })).toBe(false);
    expect(isRestrictedExamShortcut({ type: 'keyDown', key: 'ArrowRight' }, { examInProgress: true })).toBe(false);
    expect(isRestrictedExamShortcut({ type: 'keyUp', key: 'r', meta: true }, { examInProgress: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateProctorEventPayload
// ---------------------------------------------------------------------------
describe('validateProctorEventPayload', () => {
  it('passes for a valid proctoring event payload', () => {
    expect(() =>
      validateProctorEventPayload({
        eventType: 'window:blur',
        severity: 'warning',
        source: 'main-process',
        metadata: { note: 'Lost focus' },
      })
    ).not.toThrow();
  });

  it('throws when payload is null or non-object', () => {
    expect(() => validateProctorEventPayload(null)).toThrow(TypeError);
    expect(() => validateProctorEventPayload([])).toThrow(TypeError);
    expect(() => validateProctorEventPayload('event')).toThrow(TypeError);
  });

  it('throws for unknown eventType', () => {
    expect(() =>
      validateProctorEventPayload({
        eventType: 'keyboard:cheating',
        severity: 'critical',
      })
    ).toThrow(/Invalid eventType/);
  });

  it('throws for invalid severity', () => {
    expect(() =>
      validateProctorEventPayload({
        eventType: 'fullscreen:exit',
        severity: 'fatal',
      })
    ).toThrow(/Invalid severity/);
  });

  it('throws for invalid source', () => {
    expect(() =>
      validateProctorEventPayload({
        eventType: 'fullscreen:exit',
        severity: 'warning',
        source: 'unknown-agent',
      })
    ).toThrow(/Invalid source/);
  });

  it('throws when metadata is not a plain object', () => {
    expect(() =>
      validateProctorEventPayload({
        eventType: 'fullscreen:exit',
        severity: 'warning',
        metadata: 'bad-metadata',
      })
    ).toThrow(/metadata must be a plain object/);
    expect(() =>
      validateProctorEventPayload({
        eventType: 'fullscreen:exit',
        severity: 'warning',
        metadata: ['array'],
      })
    ).toThrow(/metadata must be a plain object/);
  });
});

// ---------------------------------------------------------------------------
// EventDeduplicator
// ---------------------------------------------------------------------------
describe('EventDeduplicator', () => {
  it('records initial stateful transition', () => {
    const dedup = new EventDeduplicator({ debounceMs: 400 });
    const shouldRec = dedup.shouldRecord({ eventType: 'window:blur', timestamp: 1000 });
    expect(shouldRec).toBe(true);
  });

  it('suppresses duplicate consecutive events in the same state', () => {
    const dedup = new EventDeduplicator({ debounceMs: 400 });
    expect(dedup.shouldRecord({ eventType: 'window:blur', timestamp: 1000 })).toBe(true);
    // Duplicate consecutive blur event should be suppressed regardless of time
    expect(dedup.shouldRecord({ eventType: 'window:blur', timestamp: 2000 })).toBe(false);
  });

  it('allows paired alternating transitions outside debounce window', () => {
    const dedup = new EventDeduplicator({ debounceMs: 400 });
    expect(dedup.shouldRecord({ eventType: 'window:blur', timestamp: 1000 })).toBe(true);
    expect(dedup.shouldRecord({ eventType: 'window:focus', timestamp: 1500 })).toBe(true);
    expect(dedup.shouldRecord({ eventType: 'window:blur', timestamp: 2000 })).toBe(true);
  });

  it('filters rapid paired oscillation within debounce window', () => {
    const dedup = new EventDeduplicator({ debounceMs: 400 });
    expect(dedup.shouldRecord({ eventType: 'fullscreen:exit', timestamp: 1000 })).toBe(true);
    // Returning to enter state, but within 100ms
    expect(dedup.shouldRecord({ eventType: 'fullscreen:enter', timestamp: 1100 })).toBe(true);
    // Rapid exit again within 200ms of last exit
    expect(dedup.shouldRecord({ eventType: 'fullscreen:exit', timestamp: 1200 })).toBe(false);
  });

  it('throttles discrete events like navigation:blocked within debounce window', () => {
    const dedup = new EventDeduplicator({ debounceMs: 400 });
    expect(dedup.shouldRecord({ eventType: 'navigation:blocked', timestamp: 1000 })).toBe(true);
    // Rapid repeated block within 200ms
    expect(dedup.shouldRecord({ eventType: 'navigation:blocked', timestamp: 1200 })).toBe(false);
    // Outside 400ms debounce
    expect(dedup.shouldRecord({ eventType: 'navigation:blocked', timestamp: 1500 })).toBe(true);
  });

  it('resets tracking state completely on reset()', () => {
    const dedup = new EventDeduplicator({ debounceMs: 400 });
    expect(dedup.shouldRecord({ eventType: 'camera:terminated', timestamp: 1000 })).toBe(true);
    expect(dedup.shouldRecord({ eventType: 'camera:terminated', timestamp: 2000 })).toBe(false);

    dedup.reset();
    expect(dedup.shouldRecord({ eventType: 'camera:terminated', timestamp: 2100 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CHANNELS registry – guard against naming typos between preload and main
// ---------------------------------------------------------------------------
describe('CHANNELS registry', () => {
  const expectedChannels = [
    'athena:app:get-status',
    'athena:window:enter-fullscreen',
    'athena:window:exit-fullscreen',
    'athena:window:get-state',
    'athena:window:set-kiosk',
    'athena:window:state-changed',
    'athena:window:restore-normal',
    'athena:exam:show-rules',
    'athena:exam:start-session',
    'athena:exam:get-remaining-time',
    'athena:exam:submit-session',
    'athena:exam:cancel-session',
    'athena:evidence:save-snapshot',
    'athena:evidence:save-video-chunk',
    'athena:evidence:get-status',
    'athena:evidence:cleanup',
    'athena:proctor:record-event',
    'athena:proctor:get-events',
    'athena:proctor:event-recorded',
  ];

  it('exports all expected channel names', () => {
    for (const ch of expectedChannels) {
      expect(Object.values(CHANNELS)).toContain(ch);
    }
  });

  it('channel values follow athena:<domain>:<action> naming pattern', () => {
    const pattern = /^athena:[a-z]+:[a-z]+(-[a-z]+)*$/;
    for (const ch of Object.values(CHANNELS)) {
      expect(ch).toMatch(pattern);
    }
  });
});

