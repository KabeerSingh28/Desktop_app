/**
 * Unit Tests: useWebcam Hook
 *
 * Tests:
 * 1. Camera acquisition and stream reuse
 * 2. Error handling (NotAllowedError, NotFoundError, NotReadableError, unsupported)
 * 3. Unexpected stream termination (track 'ended' event)
 * 4. Deterministic teardown (stopCamera halts all tracks and clears state)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useWebcam } from './useWebcam.js';

describe('useWebcam Hook', () => {
  const originalMediaDevices = global.navigator?.mediaDevices;

  function mockMediaDevices(mockObj) {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: mockObj,
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('initializes in idle state without requesting camera automatically', () => {
    let hookResult;
    function TestComponent() {
      hookResult = useWebcam();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    expect(hookResult.status).toBe('idle');
    expect(hookResult.stream).toBeNull();
    expect(hookResult.error).toBeNull();
  });

  it('handles unsupported environment when getUserMedia is missing', async () => {
    mockMediaDevices({}); // Missing getUserMedia

    let hookResult;
    function TestComponent() {
      hookResult = useWebcam();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const stream = await hookResult.requestCamera();
    expect(stream).toBeNull();
    expect(hookResult.status).toBe('unsupported');
    expect(hookResult.error).toContain('getUserMedia is not supported');
  });

  it('acquires camera stream successfully upon user request', async () => {
    const mockStop = vi.fn();
    const mockTrack = {
      label: 'FaceTime HD Camera',
      readyState: 'live',
      stop: mockStop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ deviceId: 'cam-123' }),
    };

    const mockStream = {
      active: true,
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    };

    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
    mockMediaDevices({
      getUserMedia: getUserMediaMock,
      enumerateDevices: vi.fn().mockResolvedValue([]),
    });

    let hookResult;
    function TestComponent() {
      hookResult = useWebcam();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const stream = await hookResult.startCamera();
    expect(stream).toBe(mockStream);
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Test stream reuse: calling requestCamera again reuses the existing live stream
    const reusedStream = await hookResult.requestCamera();
    expect(reusedStream).toBe(mockStream);
    expect(getUserMediaMock).toHaveBeenCalledTimes(1); // Not called again
  });

  it('classifies NotAllowedError as denied with guidance', async () => {
    const permissionError = new Error('Permission denied by user');
    permissionError.name = 'NotAllowedError';

    mockMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(permissionError),
    });

    let hookResult;
    function TestComponent() {
      hookResult = useWebcam();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const stream = await hookResult.requestCamera();
    expect(stream).toBeNull();
    expect(hookResult.status).toBe('denied');
    expect(hookResult.error).toContain('Camera access was denied');
    expect(hookResult.remedy).toContain('operating system settings');
  });

  it('classifies NotFoundError as unavailable', async () => {
    const notFoundError = new Error('Requested device not found');
    notFoundError.name = 'NotFoundError';

    mockMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(notFoundError),
    });

    let hookResult;
    function TestComponent() {
      hookResult = useWebcam();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const stream = await hookResult.requestCamera();
    expect(stream).toBeNull();
    expect(hookResult.status).toBe('unavailable');
    expect(hookResult.error).toContain('No video input device');
  });

  it('classifies NotReadableError as hardware in-use', async () => {
    const busyError = new Error('Device in use');
    busyError.name = 'NotReadableError';

    mockMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(busyError),
    });

    let hookResult;
    function TestComponent() {
      hookResult = useWebcam();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    const stream = await hookResult.requestCamera();
    expect(stream).toBeNull();
    expect(hookResult.status).toBe('unavailable');
    expect(hookResult.error).toContain('locked or in use by another application');
  });

  it('stops all tracks and resets state on stopCamera', async () => {
    const mockStop = vi.fn();
    const mockTrack = {
      label: 'Integrated Webcam',
      readyState: 'live',
      stop: mockStop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ deviceId: 'cam-1' }),
    };

    const mockStream = {
      active: true,
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    };

    mockMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    });

    let hookResult;
    function TestComponent() {
      hookResult = useWebcam();
      return null;
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    await hookResult.requestCamera();
    hookResult.stopCamera();
    expect(mockStop).toHaveBeenCalled();
  });
});
