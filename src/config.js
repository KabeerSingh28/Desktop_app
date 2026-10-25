/**
 * Frontend Configuration
 *
 * Configures API base URL and connection parameters for the examination client.
 */

export const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL ||
  `http://localhost:${import.meta.env.VITE_BACKEND_PORT || 6001}`;

export const MONITORING_POLICY = {
  SNAPSHOT_INTERVAL_SECONDS: 20,
  IMAGE_FORMAT: 'image/jpeg',
  JPEG_QUALITY: 0.6,
  AUDIO_MONITORING: false, // Audio/microphone monitoring is explicitly disabled
  RETENTION_DAYS: 30,
};
