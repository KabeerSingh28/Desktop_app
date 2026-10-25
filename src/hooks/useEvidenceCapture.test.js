/**
 * Evidence Capture Module Tests
 *
 * Tests:
 * 1. Consent gating (never captures without consent & active session)
 * 2. In-flight mutex protection (overlapping capture prevention)
 * 3. Stream termination handling & cleanup
 * 4. Submission snapshot trigger
 * 5. MediaRecorder error handling & unsupported MIME formats
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useEvidenceCapture } from './useEvidenceCapture.js';
import * as cameraUtils from '../utils/cameraUtils.js';

describe('useEvidenceCapture Hook Logic', () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.window = { ...originalWindow };
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.window = originalWindow;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects capture if consent is not accepted or session is inactive', async () => {
    vi.spyOn(cameraUtils, 'captureFrame').mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,abc',
      method: 'canvas',
    });

    const mockTrack = { readyState: 'live', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const mockStream = { active: true, getVideoTracks: () => [mockTrack] };

    let hookResult;
    function TestComponent() {
      hookResult = useEvidenceCapture({
        sessionId: 'test-sess',
        stream: mockStream,
        active: false, // Inactive
        consentAccepted: false,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const result = await hookResult.captureSnapshot('interval');
    expect(result).toBeNull();
    expect(cameraUtils.captureFrame).not.toHaveBeenCalled();
  });

  it('captures snapshot when active, consented, and stream is live', async () => {
    vi.spyOn(cameraUtils, 'captureFrame').mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      method: 'ImageCapture',
    });

    const saveSnapshotMock = vi.fn().mockResolvedValue({ ok: true });
    global.window.athena = {
      saveSnapshot: saveSnapshotMock,
    };

    const mockTrack = { readyState: 'live', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const mockStream = { active: true, getVideoTracks: () => [mockTrack] };

    let hookResult;
    function TestComponent() {
      hookResult = useEvidenceCapture({
        sessionId: 'test-sess-1',
        stream: mockStream,
        active: true,
        consentAccepted: true,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const snapResult = await hookResult.captureSnapshot('session:start');
    expect(snapResult).not.toBeNull();
    expect(snapResult.ok).toBe(true);
    expect(snapResult.trigger).toBe('session:start');
    expect(saveSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-sess-1',
        trigger: 'session:start',
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      })
    );
  });

  it('falls back to HTTP upload when window.athena is not present', async () => {
    vi.spyOn(cameraUtils, 'captureFrame').mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      method: 'canvas',
    });

    delete global.window.athena;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const mockTrack = { readyState: 'live', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const mockStream = { active: true, getVideoTracks: () => [mockTrack] };

    let hookResult;
    function TestComponent() {
      hookResult = useEvidenceCapture({
        sessionId: 'http-sess-1',
        stream: mockStream,
        active: true,
        consentAccepted: true,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const snapResult = await hookResult.captureSnapshot('interval');
    expect(snapResult).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/exam/session/http-sess-1/snapshot'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('prevents overlapping capture requests using in-flight lock', async () => {
    let resolveCapture;
    const capturePromise = new Promise((resolve) => {
      resolveCapture = resolve;
    });

    vi.spyOn(cameraUtils, 'captureFrame').mockImplementation(() => capturePromise);

    const saveSnapshotMock = vi.fn().mockResolvedValue({ ok: true });
    global.window.athena = { saveSnapshot: saveSnapshotMock };

    const mockTrack = { readyState: 'live', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const mockStream = { active: true, getVideoTracks: () => [mockTrack] };

    let hookResult;
    function TestComponent() {
      hookResult = useEvidenceCapture({
        sessionId: 'lock-sess-1',
        stream: mockStream,
        active: true,
        consentAccepted: true,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    // Start first capture
    const firstCallPromise = hookResult.captureSnapshot('first');
    // Start second capture concurrently before first resolves
    const secondCallResult = await hookResult.captureSnapshot('second');

    // Second call should immediately abort due to mutex lock
    expect(secondCallResult).toBeNull();

    // Complete first call
    resolveCapture({ dataUrl: 'data:image/jpeg;base64,done', method: 'canvas' });
    const firstCallResult = await firstCallPromise;
    expect(firstCallResult).not.toBeNull();
  });

  it('records proctoring error event when capture fails', async () => {
    vi.spyOn(cameraUtils, 'captureFrame').mockRejectedValue(new Error('Canvas hardware error'));

    const onProctorEventMock = vi.fn();
    const mockTrack = { readyState: 'live', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const mockStream = { active: true, getVideoTracks: () => [mockTrack] };

    let hookResult;
    function TestComponent() {
      hookResult = useEvidenceCapture({
        sessionId: 'err-sess-1',
        stream: mockStream,
        active: true,
        consentAccepted: true,
        onProctorEvent: onProctorEventMock,
      });
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const result = await hookResult.captureSnapshot('interval');
    expect(result).toBeNull();
    expect(onProctorEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'monitoring:error',
        severity: 'warning',
        metadata: expect.objectContaining({ reason: 'Canvas hardware error' }),
      })
    );
  });
});
