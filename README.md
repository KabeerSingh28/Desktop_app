# Athena Desktop Examination & Proctoring Platform

A secure, desktop-based examination and proctoring system built with Electron, React, Vite, and an authoritative Express backend service.

---

## 1. Quick Start

### Install Dependencies
```bash
npm install
```

### Run the Application Services

1. **Start the Examination Backend** (Listens on Port `6001` by default):
   ```bash
   npm run backend
   ```

2. **Start the Vite Frontend Development Server** (Runs on `http://localhost:5173`):
   ```bash
   npm run dev
   ```

3. **Start the Electron Desktop Application**:
   ```bash
   npm run dev:electron
   # or
   npm start
   ```

---

## 2. Testing and Validation

Run the automated test suite (includes IPC validation tests and Backend API integration tests):
```bash
npm test
```

Run ESLint and production build validation:
```bash
npm run lint
npm run build
```

---

## 3. Backend API Documentation

The backend service runs on `http://localhost:6001` (configured via `PORT` or `EXAM_BACKEND_PORT`).

### Endpoints Overview

| Method | Endpoint | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | None | Health check endpoint returning `{ status: "ok" }`. |
| `POST` | `/exam/start` | `{ "userId": string, "name": string }` | Initializes a new examination session with a collision-resistant ID. Returns `{ sessionId, totalQuestions }`. |
| `GET` | `/exam/mcq/total` | None | Returns `{ total: number }` count of active questions. |
| `GET` | `/exam/mcq` | None | Returns array of all active questions. `correctAnswer` is stripped to preserve exam integrity. |
| `GET` | `/exam/mcq/:id` | None | Returns single question by numeric ID, stripped of `correctAnswer`. Returns `404` if not found. |
| `POST` | `/exam/answer` | `{ "sessionId": string, "questionId": number, "selectedAnswer": number }` | Records an answer for the specified question. Rejects duplicates (`409`), invalid ranges (`400`), or submissions on finalized sessions (`409`). Does NOT leak answer correctness during active exam. |
| `GET` | `/exam/session/:sessionId` | None | Returns current session status. While `in-progress`, correctness flags and score tallies are masked. Once `submitted`, full results are provided. |
| `POST` | `/exam/submit` | `{ "sessionId": string }` | Finalizes the exam session and tallies attempted, correct, and wrong answers. Returns `{ result: { attempted, correct, wrong } }`. Rejects re-submissions (`409`). |

---

## 4. Data Persistence & Storage Architecture

- **Data Directory**: `backend/data/` (configurable via `DATA_DIR` environment variable).
- **Files**:
  - `backend/data/questions.json`: Master question bank. Re-initialized automatically if missing or corrupted.
  - `backend/data/sessions.json`: Candidate exam session records.
- **Safety Features**:
  - **Asynchronous Non-Blocking I/O**: Uses `fs/promises` throughout.
  - **Atomic Writes**: Writes to unique temporary files first, then performs atomic file renames to prevent partial write corruption.
  - **Serialized Writes**: Mutex queue guarantees concurrent HTTP submissions do not overwrite one another.

---

## 5. Environment Configuration

Copy `.env.example` to `.env` to customize settings:
```bash
cp .env.example .env
```

Key variables:
- `PORT` / `EXAM_BACKEND_PORT`: Backend port (default `6001`).
- `VITE_BACKEND_PORT`: Port used by frontend API client (default `6001`).
- `EXAM_DURATION_MINUTES`: Duration before exam auto-submit (default `45`).
- `DATA_DIR`: Custom path for `questions.json` and `sessions.json`.
