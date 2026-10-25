/**
 * Proctoring Events Hook & Telemetry Integration Tests
 *
 * Tests:
 * 1. Inactive/unassigned session gate (never records when inactive or without sessionId)
 * 2. IPC event bridging via window.athena.recordProctorEvent
 * 3. Standalone HTTP fallback event dispatch
 * 4. In-memory deduplication and clearEvents
 * 5. EventDeduplicator telemetry constraints (consecutive state suppression & 400ms throttling)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useProctoringEvents } from './useProctoringEvents.js';
import { EventDeduplicator, validateProctorEventPayload } from '../../electron/ipc-helpers.cjs';

describe('useProctoringEvents Hook & Telemetry', () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.window = {
      location: { pathname: '/exam' },
    };
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.window = originalWindow;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects recording when session is inactive or sessionId is missing', async () => {
    const recordProctorMock = vi.fn();
    global.window.athena = { recordProctorEvent: recordProctorMock };

    let hookResult;
    function TestComponent() {
      hookResult = useProctoringEvents({
        sessionId: null, // missing
        active: false,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const res = await hookResult.recordEvent({
      eventType: 'visibility:hidden',
      severity: 'warning',
    });

    expect(res).toBeNull();
    expect(recordProctorMock).not.toHaveBeenCalled();
    expect(hookResult.events).toHaveLength(0);
  });

  it('records proctoring event via Electron IPC bridge when active', async () => {
    const mockCreatedEvent = {
      eventId: 'evt-101',
      sessionId: 'sess-active-1',
      eventType: 'visibility:hidden',
      severity: 'warning',
      source: 'renderer',
      timestamp: new Date().toISOString(),
      metadata: { note: 'Assessment viewport became hidden' },
    };

    const recordProctorMock = vi.fn().mockResolvedValue({
      ok: true,
      data: mockCreatedEvent,
    });
    global.window.athena = { recordProctorEvent: recordProctorMock };

    let hookResult;
    function TestComponent() {
      hookResult = useProctoringEvents({
        sessionId: 'sess-active-1',
        active: true,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const res = await hookResult.recordEvent({
      eventType: 'visibility:hidden',
      severity: 'warning',
      metadata: { note: 'Assessment viewport became hidden' },
    });

    expect(res).toEqual(mockCreatedEvent);
    expect(recordProctorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-active-1',
        eventType: 'visibility:hidden',
        severity: 'warning',
        source: 'renderer',
      })
    );
    expect(hookResult.events).toContainEqual(mockCreatedEvent);
  });

  it('falls back to HTTP API when window.athena is unavailable', async () => {
    delete global.window.athena;

    const mockHttpEvent = {
      eventId: 'evt-http-202',
      sessionId: 'sess-http-2',
      eventType: 'backend:disconnected',
      severity: 'warning',
      source: 'renderer',
      timestamp: new Date().toISOString(),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, event: mockHttpEvent }),
    });

    let hookResult;
    function TestComponent() {
      hookResult = useProctoringEvents({
        sessionId: 'sess-http-2',
        active: true,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const res = await hookResult.recordEvent({
      eventType: 'backend:disconnected',
      severity: 'warning',
    });

    expect(res).toEqual(mockHttpEvent);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/exam/session/sess-http-2/event'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(hookResult.events).toHaveLength(1);
    expect(hookResult.events[0].eventId).toBe('evt-http-202');
  });

  it('prevents duplicate events by eventId and supports clearEvents', async () => {
    const mockEvent = {
      eventId: 'evt-unique-1',
      sessionId: 'sess-test',
      eventType: 'camera:recovered',
      severity: 'info',
    };

    global.window.athena = {
      recordProctorEvent: vi.fn().mockResolvedValue({ ok: true, data: mockEvent }),
    };

    let hookResult;
    function TestComponent() {
      hookResult = useProctoringEvents({
        sessionId: 'sess-test',
        active: true,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    await hookResult.recordEvent({ eventType: 'camera:recovered' });
    await hookResult.recordEvent({ eventType: 'camera:recovered' });

    // Should contain exactly 1 event despite duplicate return from backend
    expect(hookResult.events).toHaveLength(1);

    hookResult.clearEvents();
    expect(hookResult.events).toHaveLength(0);
  });

  it('validates proctoring payloads conform to official telemetry schemas', () => {
    const validPayload = {
      sessionId: 'sess-001',
      eventType: 'camera:terminated',
      severity: 'critical',
      source: 'renderer',
      metadata: { reason: 'NotFoundError' },
    };

    expect(() => validateProctorEventPayload(validPayload)).not.toThrow();

    // Invalid eventType
    expect(() =>
      validateProctorEventPayload({
        ...validPayload,
        eventType: 'unauthorized:event',
      })
    ).toThrow('Invalid eventType');

    // Invalid severity
    expect(() =>
      validateProctorEventPayload({
        ...validPayload,
        severity: 'fatal',
      })
    ).toThrow('Invalid severity');
  });

  it('suppresses duplicate consecutive and oscillating proctoring events via EventDeduplicator', () => {
    const dedup = new EventDeduplicator({ debounceMs: 400 });
    const t0 = 1700000000000;

    // 1. Initial visibility:hidden -> Allowed
    expect(dedup.shouldRecord({ eventType: 'visibility:hidden', timestamp: t0 })).toBe(true);

    // 2. Duplicate consecutive visibility:hidden within 100ms -> Suppressed
    expect(dedup.shouldRecord({ eventType: 'visibility:hidden', timestamp: t0 + 100 })).toBe(false);

    // 3. Duplicate consecutive visibility:hidden even after 600ms (same state without intervening visible) -> Suppressed
    expect(dedup.shouldRecord({ eventType: 'visibility:hidden', timestamp: t0 + 600 })).toBe(false);

    // 4. Proper transition to visibility:visible -> Allowed
    expect(dedup.shouldRecord({ eventType: 'visibility:visible', timestamp: t0 + 700 })).toBe(true);

    // 5. Rapid toggle back to visibility:visible within 200ms -> Suppressed (duplicate consecutive & within debounce)
    expect(dedup.shouldRecord({ eventType: 'visibility:visible', timestamp: t0 + 900 })).toBe(false);

    // 6. Camera transitions: camera:terminated -> camera:recovered
    expect(dedup.shouldRecord({ eventType: 'camera:terminated', timestamp: t0 + 1000 })).toBe(true);
    expect(dedup.shouldRecord({ eventType: 'camera:terminated', timestamp: t0 + 1100 })).toBe(false);
    expect(dedup.shouldRecord({ eventType: 'camera:recovered', timestamp: t0 + 1500 })).toBe(true);

    // 7. Backend transitions: backend:disconnected -> backend:reconnected
    expect(dedup.shouldRecord({ eventType: 'backend:disconnected', timestamp: t0 + 1600 })).toBe(true);
    expect(dedup.shouldRecord({ eventType: 'backend:disconnected', timestamp: t0 + 1700 })).toBe(false);
    expect(dedup.shouldRecord({ eventType: 'backend:reconnected', timestamp: t0 + 2100 })).toBe(true);
  });
});
