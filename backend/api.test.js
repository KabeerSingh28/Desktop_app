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
    });
  });
});
