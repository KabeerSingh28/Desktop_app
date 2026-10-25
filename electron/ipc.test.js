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
  validateCandidatePayload,
  validateSessionIdPayload,
  validateKioskPayload,
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
