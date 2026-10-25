/**
 * Camera & ImageCapture Utilities
 *
 * Provides feature-detection for ImageCapture API and fallback to HTMLCanvasElement.
 * Pure utility functions for frame acquisition and hardware capabilities.
 */

/**
 * Checks whether the ImageCapture API is supported in the current environment.
 * ImageCapture is supported in standard Chromium/Electron environments but may be
 * omitted in older runtimes or other browser engines.
 *
 * @returns {boolean}
 */
export function isImageCaptureSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.ImageCapture === 'function'
  );
}

/**
 * Captures a single image frame from an active video track or HTMLVideoElement.
 * - Prioritizes ImageCapture.grabFrame() if supported and track is live.
 * - Falls back to offscreen HTMLCanvasElement drawing when ImageCapture is unsupported.
 *
 * @param {object} params
 * @param {HTMLVideoElement} [params.videoElement] - Active preview video element
 * @param {MediaStreamTrack} [params.videoTrack] - Live video track from MediaStream
 * @param {number} [params.width=640] - Output image width
 * @param {number} [params.height=480] - Output image height
 * @param {number} [params.quality=0.6] - JPEG compression quality (0.0 to 1.0)
 * @param {string} [params.format='image/jpeg'] - Output image format
 * @returns {Promise<{ dataUrl: string, method: 'ImageCapture' | 'canvas' }>}
 */
export async function captureFrame({
  videoElement,
  videoTrack,
  width = 640,
  height = 480,
  quality = 0.6,
  format = 'image/jpeg',
} = {}) {
  // 1. Attempt ImageCapture if supported and track is live
  if (isImageCaptureSupported() && videoTrack && videoTrack.readyState === 'live') {
    try {
      const capturer = new window.ImageCapture(videoTrack);
      if (typeof capturer.grabFrame === 'function') {
        const imageBitmap = await capturer.grabFrame();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(imageBitmap, 0, 0, width, height);
          if (typeof imageBitmap.close === 'function') {
            imageBitmap.close(); // Clean up GPU/RAM allocation
          }
          const dataUrl = canvas.toDataURL(format, quality);
          return { dataUrl, method: 'ImageCapture' };
        }
      }
    } catch (err) {
      console.warn('[cameraUtils] ImageCapture failed, trying canvas fallback:', err?.message || err);
    }
  }

  // 2. Fallback: Draw directly from HTMLVideoElement onto an offscreen canvas
  if (videoElement && videoElement.readyState >= 2) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not acquire 2D canvas context for frame capture.');
    }
    ctx.drawImage(videoElement, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(format, quality);
    return { dataUrl, method: 'canvas' };
  }

  throw new Error(
    'Frame capture failed: Neither a live ImageCapture track nor a ready HTMLVideoElement is available.'
  );
}

/**
 * Safely verifies if a MediaStream has at least one active, live video track.
 *
 * @param {MediaStream} [stream]
 * @returns {boolean}
 */
export function isStreamLive(stream) {
  if (!stream || !stream.active) return false;
  const tracks = stream.getVideoTracks();
  return tracks.length > 0 && tracks.some((t) => t.readyState === 'live');
}

/**
 * Checks whether the MediaRecorder API is supported in the current environment.
 *
 * @returns {boolean}
 */
export function isMediaRecorderSupported() {
  return (
    typeof window !== 'undefined' &&
    (typeof window.MediaRecorder === 'function' || typeof window.MediaRecorder === 'object') &&
    window.MediaRecorder !== null
  );
}

/**
 * Returns the best supported video container/codec MIME type for MediaRecorder,
 * prioritizing VP9/VP8 in WebM, then MP4, or null if unsupported.
 *
 * @returns {string | null}
 */
export function getSupportedVideoMimeType() {
  if (!isMediaRecorderSupported()) return null;

  const candidateTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ];

  for (const type of candidateTypes) {
    try {
      if (
        typeof window.MediaRecorder.isTypeSupported === 'function' &&
        window.MediaRecorder.isTypeSupported(type)
      ) {
        return type;
      }
    } catch {
      // Ignore evaluation errors in testing mocks or older browser engines
    }
  }

  return null;
}
