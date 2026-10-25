/**
 * Exam API Routes
 *
 * Implements:
 * - Session initialization (/exam/start)
 * - Sanitized question delivery without answer keys (/exam/mcq, /exam/mcq/total, /exam/mcq/:id)
 * - Secure answer submission with validation and cheat-prevention (/exam/answer)
 * - Session progress inspection with masked live correctness (/exam/session/:sessionId)
 * - Final exam submission and score tallying (/exam/submit)
 */

import { Router } from 'express';
import {
  readQuestions,
  readSessions,
  saveSessions,
  generateSessionId,
  sanitizeQuestion,
  sanitizeSession,
} from '../storage.js';

export const examRouter = Router();

/**
 * POST /exam/start
 * Initializes a new exam session for a candidate.
 */
examRouter.post('/start', async (req, res, next) => {
  try {
    const { userId, name } = req.body || {};

    if (
      !userId ||
      typeof userId !== 'string' ||
      userId.trim() === '' ||
      !name ||
      typeof name !== 'string' ||
      name.trim() === ''
    ) {
      return res.status(400).json({
        error: 'userId and name are required non-empty strings',
      });
    }

    const questions = await readQuestions();
    const sessions = await readSessions();

    const session = {
      sessionId: generateSessionId(),
      userId: userId.trim(),
      name: name.trim(),
      startedAt: new Date().toISOString(),
      submittedAt: null,
      status: 'in-progress',
      attempted: 0,
      correct: 0,
      wrong: 0,
      answers: [],
    };

    sessions.push(session);
    await saveSessions(sessions);

    return res.status(201).json({
      message: 'Exam session started',
      sessionId: session.sessionId,
      totalQuestions: questions.length,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /exam/mcq/total
 * Returns the total count of available questions.
 */
examRouter.get('/mcq/total', async (req, res, next) => {
  try {
    const questions = await readQuestions();
    return res.json({ total: questions.length });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /exam/mcq/:id
 * Retrieves one question by ID, stripped of the correctAnswer key.
 */
examRouter.get('/mcq/:id', async (req, res, next) => {
  try {
    const rawId = req.params.id;
    const id = Number(rawId);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Question ID must be an integer' });
    }

    const questions = await readQuestions();
    const question = questions.find((item) => item.id === id);

    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    return res.json(sanitizeQuestion(question));
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /exam/mcq
 * Retrieves all questions stripped of correctAnswer keys.
 */
examRouter.get('/mcq', async (req, res, next) => {
  try {
    const questions = await readQuestions();
    return res.json(questions.map(sanitizeQuestion));
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /exam/answer
 * Submits an answer for one question.
 *
 * Security: Does NOT expose isCorrect, correct count, or wrong count to the candidate
 * while the exam is active.
 */
examRouter.post('/answer', async (req, res, next) => {
  try {
    const { sessionId, questionId, selectedAnswer } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    if (
      questionId === undefined ||
      questionId === null ||
      !Number.isInteger(Number(questionId))
    ) {
      return res.status(400).json({ error: 'Valid integer questionId is required' });
    }

    if (
      selectedAnswer === undefined ||
      selectedAnswer === null ||
      !Number.isInteger(Number(selectedAnswer))
    ) {
      return res.status(400).json({ error: 'Valid integer selectedAnswer is required' });
    }

    const qId = Number(questionId);
    const sAns = Number(selectedAnswer);

    const questions = await readQuestions();
    const sessions = await readSessions();

    const session = sessions.find((item) => item.sessionId === sessionId.trim());
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'in-progress') {
      return res.status(409).json({ error: 'Exam is already submitted' });
    }

    const question = questions.find((item) => item.id === qId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    if (sAns < 0 || sAns >= question.options.length) {
      return res.status(400).json({
        error: `Invalid selectedAnswer index: out of range (must be between 0 and ${question.options.length - 1})`,
      });
    }

    const alreadyAnswered = session.answers.some((ans) => ans.questionId === qId);
    if (alreadyAnswered) {
      return res.status(409).json({ error: 'Question already answered' });
    }

    const isCorrect = sAns === question.correctAnswer;

    session.answers.push({
      questionId: question.id,
      selectedAnswer: sAns,
      isCorrect,
      answeredAt: new Date().toISOString(),
    });

    session.attempted += 1;
    if (isCorrect) {
      session.correct += 1;
    } else {
      session.wrong += 1;
    }

    await saveSessions(sessions);

    // Return safe confirmation without disclosing answer correctness
    return res.json({
      message: 'Answer saved',
      questionId: qId,
      attempted: session.attempted,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /exam/session/:sessionId
 * Retrieves candidate session status. While active, correctness flags are masked.
 */
examRouter.get('/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const sessions = await readSessions();
    const session = sessions.find((item) => item.sessionId === sessionId.trim());

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json(sanitizeSession(session));
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /exam/submit
 * Submits the completed exam and calculates the final score report.
 */
examRouter.post('/submit', async (req, res, next) => {
  try {
    const { sessionId } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const sessions = await readSessions();
    const questions = await readQuestions();

    const session = sessions.find((item) => item.sessionId === sessionId.trim());
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status === 'submitted') {
      return res.status(409).json({ error: 'Exam is already submitted' });
    }

    session.status = 'submitted';
    session.submittedAt = new Date().toISOString();

    await saveSessions(sessions);

    return res.json({
      message: 'Exam submitted successfully',
      result: {
        sessionId: session.sessionId,
        totalQuestions: questions.length,
        attempted: session.attempted,
        correct: session.correct,
        wrong: session.wrong,
      },
    });
  } catch (err) {
    return next(err);
  }
});
