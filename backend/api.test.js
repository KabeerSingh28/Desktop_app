/**
 * Backend API Integration Tests
 *
 * Exercises all exam routes using an ephemeral test server and isolated data directory.
 * Tests success cases, malformed payloads, non-existent sessions, duplicate answers,
 * and post-submission rejections.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { config } from './config.js';

describe('Athena Backend Exam API', () => {
  let server;
  let baseUrl;
  let testDataDir;

  beforeAll(async () => {
    // Isolate test data storage
    testDataDir = path.join(os.tmpdir(), `athena-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    process.env.DATA_DIR = testDataDir;
    config.dataDir = testDataDir;
    await fs.mkdir(testDataDir, { recursive: true });

    // Seed test questions
    await fs.writeFile(
      path.join(testDataDir, 'questions.json'),
      JSON.stringify(config.defaultQuestions, null, 2),
      'utf-8'
    );
    await fs.writeFile(path.join(testDataDir, 'sessions.json'), '[]', 'utf-8');

    // Start ephemeral server
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. Health check
  // -------------------------------------------------------------------------
  it('GET / returns health status', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.message).toContain('Exam backend is running');
  });

  // -------------------------------------------------------------------------
  // 2. Session creation (/exam/start)
  // -------------------------------------------------------------------------
  describe('POST /exam/start', () => {
    it('creates a session with valid userId and name', async () => {
      const res = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-101', name: 'Alice' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.sessionId).toMatch(/^session-\d+-[a-f0-9]+$/);
      expect(data.totalQuestions).toBe(5);
    });

    it('rejects when userId or name is missing', async () => {
      const res1 = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      });
      expect(res1.status).toBe(400);

      const res2 = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-101' }),
      });
      expect(res2.status).toBe(400);

      const res3 = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '   ', name: '' }),
      });
      expect(res3.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Question retrieval (/exam/mcq)
  // -------------------------------------------------------------------------
  describe('Question endpoints', () => {
    it('GET /exam/mcq/total returns total question count', async () => {
      const res = await fetch(`${baseUrl}/exam/mcq/total`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(5);
    });

    it('GET /exam/mcq returns questions stripped of correctAnswer', async () => {
      const res = await fetch(`${baseUrl}/exam/mcq`);
      expect(res.status).toBe(200);
      const questions = await res.json();
      expect(Array.isArray(questions)).toBe(true);
      expect(questions.length).toBe(5);

      for (const q of questions) {
        expect(q.id).toBeDefined();
        expect(q.question).toBeDefined();
        expect(Array.isArray(q.options)).toBe(true);
        expect(q.correctAnswer).toBeUndefined(); // Answer key is NOT leaked
      }
    });

    it('GET /exam/mcq/:id returns one sanitized question', async () => {
      const res = await fetch(`${baseUrl}/exam/mcq/1`);
      expect(res.status).toBe(200);
      const q = await res.json();
      expect(q.id).toBe(1);
      expect(q.question).toContain('BrowserWindow');
      expect(q.correctAnswer).toBeUndefined();
    });

    it('GET /exam/mcq/:id returns 404 for non-existent question', async () => {
      const res = await fetch(`${baseUrl}/exam/mcq/999`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Question not found');
    });

    it('GET /exam/mcq/:id returns 400 for non-integer question ID', async () => {
      const res = await fetch(`${baseUrl}/exam/mcq/abc`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('integer');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Answer submission & evaluation (/exam/answer)
  // -------------------------------------------------------------------------
  describe('POST /exam/answer', () => {
    let testSessionId;

    beforeAll(async () => {
      const res = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-202', name: 'Bob' }),
      });
      const data = await res.json();
      testSessionId = data.sessionId;
    });

    it('saves a valid answer without leaking isCorrect to candidate', async () => {
      const res = await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          questionId: 1,
          selectedAnswer: 1, // Correct answer for Q1
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toBe('Answer saved');
      expect(data.attempted).toBe(1);
      expect(data.isCorrect).toBeUndefined(); // Must NOT leak live correctness!
      expect(data.correct).toBeUndefined();
      expect(data.wrong).toBeUndefined();
    });

    it('rejects duplicate submission for the same question', async () => {
      const res = await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          questionId: 1,
          selectedAnswer: 0,
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Question already answered');
    });

    it('rejects invalid or out-of-bounds selectedAnswer', async () => {
      const res = await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          questionId: 2,
          selectedAnswer: 99, // Question 2 only has 4 options (0..3)
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('out of range');
    });

    it('rejects non-existent questionId', async () => {
      const res = await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          questionId: 999,
          selectedAnswer: 0,
        }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Question not found');
    });

    it('rejects non-existent sessionId', async () => {
      const res = await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-invalid-id',
          questionId: 2,
          selectedAnswer: 0,
        }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
    });

    it('rejects missing payload fields', async () => {
      const res = await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: testSessionId }),
      });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Session progress inspection (/exam/session/:sessionId)
  // -------------------------------------------------------------------------
  describe('GET /exam/session/:sessionId', () => {
    let activeSessionId;

    beforeAll(async () => {
      const startRes = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-303', name: 'Charlie' }),
      });
      const startData = await startRes.json();
      activeSessionId = startData.sessionId;

      await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          questionId: 1,
          selectedAnswer: 1,
        }),
      });
    });

    it('masks isCorrect and score tallies while session is in-progress', async () => {
      const res = await fetch(`${baseUrl}/exam/session/${activeSessionId}`);
      expect(res.status).toBe(200);
      const session = await res.json();

      expect(session.status).toBe('in-progress');
      expect(session.attempted).toBe(1);
      expect(session.correct).toBeUndefined(); // Masked!
      expect(session.wrong).toBeUndefined();   // Masked!
      expect(session.answers[0].isCorrect).toBeUndefined(); // Masked!
      expect(session.answers[0].questionId).toBe(1);
      expect(session.answers[0].selectedAnswer).toBe(1);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/unknown-session-xyz`);
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Exam final submission (/exam/submit)
  // -------------------------------------------------------------------------
  describe('POST /exam/submit and post-submission lockdown', () => {
    let submitSessionId;

    beforeAll(async () => {
      const startRes = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-404', name: 'Dana' }),
      });
      const startData = await startRes.json();
      submitSessionId = startData.sessionId;

      // Answer Q1 correctly
      await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: submitSessionId,
          questionId: 1,
          selectedAnswer: 1, // Correct
        }),
      });

      // Answer Q2 incorrectly
      await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: submitSessionId,
          questionId: 2,
          selectedAnswer: 2, // Wrong (correctAnswer is 0)
        }),
      });
    });

    it('submits exam and calculates score correctly', async () => {
      const res = await fetch(`${baseUrl}/exam/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: submitSessionId }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toBe('Exam submitted successfully');
      expect(data.result.attempted).toBe(2);
      expect(data.result.correct).toBe(1);
      expect(data.result.wrong).toBe(1);
      expect(data.result.totalQuestions).toBe(5);
    });

    it('rejects further answer submissions on submitted exam', async () => {
      const res = await fetch(`${baseUrl}/exam/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: submitSessionId,
          questionId: 3,
          selectedAnswer: 1,
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Exam is already submitted');
    });

    it('rejects duplicate exam submission', async () => {
      const res = await fetch(`${baseUrl}/exam/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: submitSessionId }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Exam is already submitted');
    });

    it('reveals full results when inspecting a submitted session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/${submitSessionId}`);
      expect(res.status).toBe(200);
      const session = await res.json();

      expect(session.status).toBe('submitted');
      expect(session.submittedAt).toBeDefined();
      expect(session.correct).toBe(1);
      expect(session.wrong).toBe(1);
      expect(session.answers[0].isCorrect).toBe(true);
      expect(session.answers[1].isCorrect).toBe(false);
      expect(Array.isArray(session.events)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Proctoring Event Ingestion and Timeline (/exam/session/:sessionId/event[s])
  // -------------------------------------------------------------------------
  describe('Proctoring Events System', () => {
    let proctorSessionId;

    beforeAll(async () => {
      const startRes = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-proctor-1', name: 'Bob' }),
      });
      const data = await startRes.json();
      proctorSessionId = data.sessionId;
    });

    it('records a valid proctoring event on an active session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/${proctorSessionId}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'fullscreen:exit',
          severity: 'warning',
          source: 'main-process',
          metadata: { reason: 'User toggled space' },
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.event).toBeDefined();
      expect(data.event.sessionId).toBe(proctorSessionId);
      expect(data.event.eventType).toBe('fullscreen:exit');
      expect(data.event.severity).toBe('warning');
      expect(data.event.source).toBe('main-process');
      expect(data.event.eventId).toMatch(/^evt-\d+-[a-z0-9]+$/);
      expect(data.event.timestamp).toBeDefined();
    });

    it('retrieves recorded events for a session', async () => {
      // Record a second event
      await fetch(`${baseUrl}/exam/session/${proctorSessionId}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'window:blur',
          severity: 'warning',
          source: 'main-process',
        }),
      });

      const res = await fetch(`${baseUrl}/exam/session/${proctorSessionId}/events`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.events)).toBe(true);
      expect(data.events.length).toBe(2);
      expect(data.events[0].eventType).toBe('fullscreen:exit');
      expect(data.events[1].eventType).toBe('window:blur');
    });

    it('rejects recording with invalid eventType', async () => {
      const res = await fetch(`${baseUrl}/exam/session/${proctorSessionId}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'illegal:cheat:event',
          severity: 'warning',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid eventType');
    });

    it('rejects recording with invalid severity', async () => {
      const res = await fetch(`${baseUrl}/exam/session/${proctorSessionId}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'window:blur',
          severity: 'apocalyptic',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid severity');
    });

    it('returns 404 when recording an event on a nonexistent session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/session-nonexistent/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'window:blur',
          severity: 'info',
        }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when retrieving events on a nonexistent session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/session-nonexistent/events`);
      expect(res.status).toBe(404);
    });

    it('rejects event recording on an already submitted session', async () => {
      // Submit the proctor session
      await fetch(`${baseUrl}/exam/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: proctorSessionId }),
      });

      const res = await fetch(`${baseUrl}/exam/session/${proctorSessionId}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'window:blur',
          severity: 'info',
        }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('already submitted');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Evidence Snapshot Ingestion (/exam/session/:sessionId/snapshot[s])
  // -------------------------------------------------------------------------
  describe('Evidence Snapshot API', () => {
    let snapshotSessionId;
    const validDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD==';

    beforeAll(async () => {
      const startRes = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-snap-1', name: 'Carol' }),
      });
      const data = await startRes.json();
      snapshotSessionId = data.sessionId;
    });

    it('records snapshot metadata on an active session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/${snapshotSessionId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: validDataUrl,
          trigger: 'session:start',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.snapshotId).toMatch(/^snap-\d+-[a-z0-9]+$/);
      expect(data.count).toBe(1);
    });

    it('retrieves recorded snapshot metadata for the session', async () => {
      // Record a second periodic snapshot
      await fetch(`${baseUrl}/exam/session/${snapshotSessionId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: validDataUrl,
          trigger: 'interval',
        }),
      });

      const res = await fetch(`${baseUrl}/exam/session/${snapshotSessionId}/snapshots`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(2);
      expect(data.snapshots[0].trigger).toBe('session_start'); // sanitized
      expect(data.snapshots[1].trigger).toBe('interval');
      expect(data.snapshots[0].sizeBytes).toBeGreaterThan(0);
    });

    it('rejects recording snapshot with invalid dataUrl', async () => {
      const res = await fetch(`${baseUrl}/exam/session/${snapshotSessionId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: 'not-an-image-url',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('dataUrl must be an image data URL');
    });

    it('rejects oversized snapshot (>512KB)', async () => {
      const huge = 'data:image/jpeg;base64,' + 'B'.repeat(512 * 1024 + 1);
      const res = await fetch(`${baseUrl}/exam/session/${snapshotSessionId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: huge,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('exceeds maximum size');
    });

    it('returns 404 when recording snapshot on non-existent session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/session-nonexistent/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: validDataUrl,
        }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when retrieving snapshots on non-existent session', async () => {
      const res = await fetch(`${baseUrl}/exam/session/session-nonexistent/snapshots`);
      expect(res.status).toBe(404);
    });

    it('rejects snapshot on an already submitted session', async () => {
      // Submit session
      await fetch(`${baseUrl}/exam/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: snapshotSessionId }),
      });

      const res = await fetch(`${baseUrl}/exam/session/${snapshotSessionId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: validDataUrl,
        }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('already submitted');
    });
  });
});

