import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isImageCaptureSupported,
  isStreamLive,
  captureFrame,
} from './cameraUtils.js';

describe('Camera & ImageCapture Utilities', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset global window mocks before each test
    global.window = { ...originalWindow };
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  describe('isImageCaptureSupported', () => {
    it('returns true when window.ImageCapture is a function', () => {
      global.window = { ImageCapture: function () {} };
      expect(isImageCaptureSupported()).toBe(true);
    });

    it('returns false when window.ImageCapture is undefined', () => {
      global.window = {};
      expect(isImageCaptureSupported()).toBe(false);
    });

    it('returns false when window is undefined', () => {
      delete global.window;
      expect(isImageCaptureSupported()).toBe(false);
    });
  });

  describe('isStreamLive', () => {
    it('returns false for null or undefined stream', () => {
      expect(isStreamLive(null)).toBe(false);
      expect(isStreamLive(undefined)).toBe(false);
    });

    it('returns false when stream is not active', () => {
      const mockStream = {
        active: false,
        getVideoTracks: () => [{ readyState: 'live' }],
      };
      expect(isStreamLive(mockStream)).toBe(false);
    });

    it('returns false when stream has no video tracks', () => {
      const mockStream = {
        active: true,
        getVideoTracks: () => [],
      };
      expect(isStreamLive(mockStream)).toBe(false);
    });

    it('returns false when all video tracks are ended', () => {
      const mockStream = {
        active: true,
        getVideoTracks: () => [{ readyState: 'ended' }, { readyState: 'ended' }],
      };
      expect(isStreamLive(mockStream)).toBe(false);
    });

    it('returns true when stream is active and has at least one live video track', () => {
      const mockStream = {
        active: true,
        getVideoTracks: () => [{ readyState: 'ended' }, { readyState: 'live' }],
      };
      expect(isStreamLive(mockStream)).toBe(true);
    });
  });

  describe('captureFrame', () => {
    it('uses ImageCapture API when supported and videoTrack is live', async () => {
      const mockClose = vi.fn();
      const mockBitmap = { close: mockClose };

      const mockGrabFrame = vi.fn().mockResolvedValue(mockBitmap);
      class MockImageCapture {
        constructor() {
          this.grabFrame = mockGrabFrame;
        }
      }

      const mockContext = {
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue(mockContext),
        toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,mockImageCaptureData'),
      };

      global.window = {
        ImageCapture: MockImageCapture,
      };
      global.document = {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      };

      const mockTrack = { readyState: 'live' };

      const result = await captureFrame({ videoTrack: mockTrack });
      expect(result.method).toBe('ImageCapture');
      expect(result.dataUrl).toBe('data:image/jpeg;base64,mockImageCaptureData');
      expect(mockGrabFrame).toHaveBeenCalled();
      expect(mockContext.drawImage).toHaveBeenCalledWith(mockBitmap, 0, 0, 640, 480);
      expect(mockClose).toHaveBeenCalled();
    });

    it('falls back to HTMLCanvasElement when ImageCapture is unsupported but videoElement is ready', async () => {
      global.window = {}; // No ImageCapture
      const mockContext = {
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue(mockContext),
        toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,mockCanvasFallbackData'),
      };
      global.document = {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      };

      const mockVideoElement = {
        readyState: 4, // HAVE_ENOUGH_DATA
      };

      const result = await captureFrame({ videoElement: mockVideoElement });
      expect(result.method).toBe('canvas');
      expect(result.dataUrl).toBe('data:image/jpeg;base64,mockCanvasFallbackData');
      expect(mockContext.drawImage).toHaveBeenCalledWith(mockVideoElement, 0, 0, 640, 480);
    });

    it('falls back to canvas when ImageCapture throws an error', async () => {
      class FailingImageCapture {
        constructor() {
          this.grabFrame = vi.fn().mockRejectedValue(new Error('Device busy'));
        }
      }

      const mockContext = {
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue(mockContext),
        toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,fallbackAfterError'),
      };

      global.window = { ImageCapture: FailingImageCapture };
      global.document = {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      };

      const mockTrack = { readyState: 'live' };
      const mockVideoElement = { readyState: 3 };

      const result = await captureFrame({
        videoTrack: mockTrack,
        videoElement: mockVideoElement,
      });

      expect(result.method).toBe('canvas');
      expect(result.dataUrl).toBe('data:image/jpeg;base64,fallbackAfterError');
    });

    it('throws when neither live ImageCapture nor ready videoElement is available', async () => {
      global.window = {};
      const mockVideoElement = { readyState: 1 }; // HAVE_METADATA only (not ready to draw)

      await expect(
        captureFrame({ videoElement: mockVideoElement })
      ).rejects.toThrow('Frame capture failed');
    });
  });
});
