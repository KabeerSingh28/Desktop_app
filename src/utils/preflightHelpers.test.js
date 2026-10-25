import { describe, it, expect, vi } from 'vitest';
import {
  evaluateCameraError,
  checkBackendHealth,
  canStartExam,
  PLATFORM_INSTRUCTIONS,
} from './preflightHelpers.js';

describe('Preflight Helpers', () => {
  describe('evaluateCameraError', () => {
    it('handles null or undefined error gracefully', () => {
      const result = evaluateCameraError(null);
      expect(result.status).toBe('unavailable');
      expect(result.message).toContain('Unknown camera error');
    });

    it('classifies NotAllowedError as denied', () => {
      const err = new Error('Permission denied by user');
      err.name = 'NotAllowedError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('denied');
      expect(result.message).toContain('denied');
      expect(result.remedy).toContain('operating system settings');
    });

    it('classifies PermissionDeniedError as denied', () => {
      const err = new Error('Permission denied');
      err.name = 'PermissionDeniedError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('denied');
    });

    it('classifies NotFoundError as unavailable', () => {
      const err = new Error('Requested device not found');
      err.name = 'NotFoundError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('unavailable');
      expect(result.message).toContain('No video input device');
    });

    it('classifies DevicesNotFoundError as unavailable', () => {
      const err = new Error('No devices');
      err.name = 'DevicesNotFoundError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('unavailable');
    });

    it('classifies NotReadableError as hardware in-use', () => {
      const err = new Error('Hardware error');
      err.name = 'NotReadableError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('unavailable');
      expect(result.remedy).toContain('Zoom');
    });

    it('classifies TrackStartError as hardware in-use', () => {
      const err = new Error('Could not start video source');
      err.name = 'TrackStartError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('unavailable');
    });

    it('classifies OverconstrainedError as unavailable', () => {
      const err = new Error('Constraints could not be satisfied');
      err.name = 'OverconstrainedError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('unavailable');
    });

    it('classifies unknown errors with fallback message', () => {
      const err = new Error('Custom weird device error');
      err.name = 'CustomDeviceError';
      const result = evaluateCameraError(err);
      expect(result.status).toBe('denied');
      expect(result.message).toBe('Custom weird device error');
    });
  });

  describe('checkBackendHealth', () => {
    it('returns ok: true with latency on successful 200 response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await checkBackendHealth('http://localhost:6001', mockFetch);
      expect(result.ok).toBe(true);
      expect(typeof result.latencyMs).toBe('number');
      expect(result.error).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:6001/', expect.any(Object));
    });

    it('returns ok: false on non-200 HTTP response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await checkBackendHealth('http://localhost:6001', mockFetch);
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeNull();
      expect(result.error).toContain('unexpected status 503');
    });

    it('handles connection refused error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

      const result = await checkBackendHealth('http://localhost:6001', mockFetch);
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeNull();
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('handles timeout AbortError', async () => {
      const abortErr = new Error('The user aborted a request.');
      abortErr.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(abortErr);

      const result = await checkBackendHealth('http://localhost:6001', mockFetch, 10);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('canStartExam', () => {
    const validParams = {
      name: 'Alice Johnson',
      userId: 'URN-10293',
      cameraStatus: 'granted',
      backendStatus: 'connected',
      isFullscreen: true,
      hasConsented: true,
    };

    it('returns ready: true when all requirements are satisfied', () => {
      const result = canStartExam(validParams);
      expect(result.ready).toBe(true);
      expect(result.missingRequirements).toHaveLength(0);
    });

    it('rejects empty or whitespace candidate name', () => {
      const result = canStartExam({ ...validParams, name: '   ' });
      expect(result.ready).toBe(false);
      expect(result.missingRequirements).toContain('Candidate full name is required');
    });

    it('rejects missing or empty student ID', () => {
      const result = canStartExam({ ...validParams, userId: '' });
      expect(result.ready).toBe(false);
      expect(result.missingRequirements).toContain('Student ID / URN is required');
    });

    it('rejects when camera permission is not granted', () => {
      const result = canStartExam({ ...validParams, cameraStatus: 'denied' });
      expect(result.ready).toBe(false);
      expect(result.missingRequirements).toContain(
        'Camera availability and permission check must be passed'
      );
    });

    it('rejects when camera is still idle or checking', () => {
      const result = canStartExam({ ...validParams, cameraStatus: 'idle' });
      expect(result.ready).toBe(false);
    });

    it('rejects when backend is disconnected', () => {
      const result = canStartExam({ ...validParams, backendStatus: 'disconnected' });
      expect(result.ready).toBe(false);
      expect(result.missingRequirements).toContain(
        'Examination backend service must be connected'
      );
    });

    it('rejects when fullscreen is inactive', () => {
      const result = canStartExam({ ...validParams, isFullscreen: false });
      expect(result.ready).toBe(false);
      expect(result.missingRequirements).toContain(
        'Application must be in full screen mode'
      );
    });

    it('rejects when explicit proctoring consent has not been checked', () => {
      const result = canStartExam({ ...validParams, hasConsented: false });
      expect(result.ready).toBe(false);
      expect(result.missingRequirements).toContain(
        'Explicit proctoring consent must be acknowledged'
      );
    });

    it('collects all missing requirements simultaneously', () => {
      const result = canStartExam({
        name: '',
        userId: '',
        cameraStatus: 'denied',
        backendStatus: 'disconnected',
        isFullscreen: false,
        hasConsented: false,
      });
      expect(result.ready).toBe(false);
      expect(result.missingRequirements).toHaveLength(6);
    });
  });

  describe('PLATFORM_INSTRUCTIONS', () => {
    it('contains guides for macos, windows, and linux', () => {
      expect(PLATFORM_INSTRUCTIONS).toHaveProperty('macos');
      expect(PLATFORM_INSTRUCTIONS).toHaveProperty('windows');
      expect(PLATFORM_INSTRUCTIONS).toHaveProperty('linux');

      expect(PLATFORM_INSTRUCTIONS.macos.steps.length).toBeGreaterThan(2);
      expect(PLATFORM_INSTRUCTIONS.windows.steps.length).toBeGreaterThan(2);
      expect(PLATFORM_INSTRUCTIONS.linux.steps.length).toBeGreaterThan(2);
    });
  });
});
