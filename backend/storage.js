/**
 * Backend Storage Engine
 *
 * Implements non-blocking, safe file-based JSON persistence:
 * - Asynchronous file I/O using fs.promises
 * - Atomic writes via temporary files and rename to prevent data corruption
 * - Graceful recovery for missing or corrupt files
 * - Sequential write serialization to avoid concurrency races
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

// Write serialization queue to prevent race conditions during concurrent requests
let writeLock = Promise.resolve();

function getQuestionsPath(dataDir = config.dataDir) {
  return path.join(dataDir, 'questions.json');
}

function getSessionsPath(dataDir = config.dataDir) {
  return path.join(dataDir, 'sessions.json');
}

/**
 * Ensures the target data directory exists.
 */
export async function ensureDataDir(dataDir = config.dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
}

/**
 * Safely writes data to a file atomically using a temporary file and rename.
 */
async function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const content = JSON.stringify(data, null, 2);

  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, filePath);
}

/**
 * Reads all MCQ questions asynchronously.
 * If the file is missing or corrupted, initializes it with defaults.
 */
export async function readQuestions(dataDir = config.dataDir) {
  const filePath = getQuestionsPath(dataDir);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[storage] Error reading questions file (${err.message}). Re-initializing defaults.`);
    }
  }

  // File is missing or invalid; write and return default questions
  const defaults = config.defaultQuestions;
  await atomicWriteJson(filePath, defaults);
  return defaults;
}

/**
 * Reads all exam sessions asynchronously.
 * If the file is missing or corrupted, returns an empty array.
 */
export async function readSessions(dataDir = config.dataDir) {
  const filePath = getSessionsPath(dataDir);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[storage] Error reading sessions file (${err.message}). Returning empty array.`);
    }
  }

  // File does not exist yet; initialize it safely
  await atomicWriteJson(filePath, []);
  return [];
}

/**
 * Persists sessions array atomically using the serialized queue.
 */
export function saveSessions(sessions, dataDir = config.dataDir) {
  const filePath = getSessionsPath(dataDir);
  writeLock = writeLock.then(async () => {
    await atomicWriteJson(filePath, sessions);
  }).catch((err) => {
    console.error(`[storage] Critical error saving sessions to ${filePath}:`, err);
    throw err;
  });
  return writeLock;
}

/**
 * Generates a unique, collision-resistant session identifier.
 */
export function generateSessionId() {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  return `session-${timestamp}-${randomSuffix}`;
}

/**
 * Sanitizes a question object for student delivery by stripping internal answer keys.
 */
export function sanitizeQuestion(question) {
  if (!question) return null;
  return {
    id: question.id,
    question: question.question,
    options: question.options,
  };
}

/**
 * Sanitizes a session object based on its lifecycle status:
 * - While in-progress: omits answer correctness flags (isCorrect) and score tallies
 * - When submitted: includes full results and answer analysis
 */
export function sanitizeSession(session) {
  if (!session) return null;

  const isSubmitted = session.status === 'submitted';

  if (!isSubmitted) {
    // Hide score tallies and per-question correctness while the exam is active
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      name: session.name,
      startedAt: session.startedAt,
      submittedAt: null,
      status: session.status,
      attempted: session.attempted,
      answers: (session.answers || []).map((ans) => ({
        questionId: ans.questionId,
        selectedAnswer: ans.selectedAnswer,
        answeredAt: ans.answeredAt,
      })),
    };
  }

  // Full detailed report when exam is completed
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    name: session.name,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    status: session.status,
    attempted: session.attempted,
    correct: session.correct,
    wrong: session.wrong,
    answers: session.answers,
  };
}
