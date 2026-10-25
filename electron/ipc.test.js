/**
 * IPC contract tests – pure validation / helper logic only.
 *
 * These tests run entirely in Node.js / Vitest without launching Electron.
 * They exercise:
 *   1. The payload validation logic that the main process and preload share.
 *   2. The channel name registry to catch typos between preload and main.
 *   3. The data-URL guard logic used in athena:evidence:save-snapshot.
 *
 * No Electron objects are imported; all logic under test is extracted into
 * plain functions in electron/ipc-helpers.cjs and imported here.
 */

import { describe, it, expect } from 'vitest';
import {
  validateString,
  validateSnapshotPayload,
  validateCandidatePayload,
  validateSessionIdPayload,
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
// CHANNELS registry – guard against naming typos between preload and main
// ---------------------------------------------------------------------------
describe('CHANNELS registry', () => {
  const expectedChannels = [
    'athena:app:get-status',
    'athena:window:enter-fullscreen',
    'athena:window:exit-fullscreen',
    'athena:exam:show-rules',
    'athena:exam:start-session',
    'athena:exam:get-remaining-time',
    'athena:exam:submit-session',
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
