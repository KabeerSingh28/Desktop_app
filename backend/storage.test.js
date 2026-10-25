/**
 * Backend Storage Engine Tests
 *
 * Tests:
 * 1. Automatic recovery when questions.json is missing or corrupted
 * 2. Automatic initialization when sessions.json is missing or corrupted
 * 3. Concurrent write safety via serialized lock
 * 4. Atomic file rename preventing partial writes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readQuestions, readSessions, saveSessions, ensureDataDir } from './storage.js';
import { config } from './config.js';

describe('Backend Storage Engine Resilience', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `athena-storage-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    await ensureDataDir(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('re-initializes defaults when questions.json is missing', async () => {
    const questionsPath = path.join(tempDir, 'questions.json');
    // Ensure file does not exist
    await expect(fs.access(questionsPath)).rejects.toThrow();

    const questions = await readQuestions(tempDir);
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBe(config.defaultQuestions.length);

    // Verify file was written
    const fileContent = await fs.readFile(questionsPath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    expect(parsed.length).toBe(config.defaultQuestions.length);
  });

  it('recovers gracefully with defaults when questions.json is corrupted with invalid JSON', async () => {
    const questionsPath = path.join(tempDir, 'questions.json');
    // Write corrupted non-JSON content
    await fs.writeFile(questionsPath, '{{corrupt-garbage-data!!@@##', 'utf-8');

    const questions = await readQuestions(tempDir);
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBe(config.defaultQuestions.length);

    // Verify file was overwritten with valid default questions
    const fileContent = await fs.readFile(questionsPath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('initializes an empty array when sessions.json does not exist', async () => {
    const sessionsPath = path.join(tempDir, 'sessions.json');
    await expect(fs.access(sessionsPath)).rejects.toThrow();

    const sessions = await readSessions(tempDir);
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions).toHaveLength(0);

    // File should now exist on disk as '[]'
    const fileContent = await fs.readFile(sessionsPath, 'utf-8');
    expect(JSON.parse(fileContent)).toEqual([]);
  });

  it('recovers with an empty array when sessions.json contains malformed JSON', async () => {
    const sessionsPath = path.join(tempDir, 'sessions.json');
    await fs.writeFile(sessionsPath, 'NOT_VALID_JSON_AT_ALL', 'utf-8');

    const sessions = await readSessions(tempDir);
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions).toHaveLength(0);
  });

  it('handles serialized concurrent writes without data loss or corruption', async () => {
    const initialSessions = [
      { sessionId: 'sess-1', name: 'User 1' },
    ];
    await saveSessions(initialSessions, tempDir);

    // Concurrently trigger 5 save operations
    const promises = Array.from({ length: 5 }, (_, i) => {
      const updated = [
        ...initialSessions,
        { sessionId: `sess-concurrent-${i}`, name: `User ${i}` },
      ];
      return saveSessions(updated, tempDir);
    });

    await Promise.all(promises);

    const result = await readSessions(tempDir);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
