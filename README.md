# Athena Desktop Examination & Proctoring Platform

Athena is an enterprise-grade, ethically designed desktop examination and proctoring client built with **Electron**, **React 19**, **Vite**, and an authoritative **Express** backend service.

It provides a secure, sandboxed environment for candidate assessments, featuring hardware readiness checks, informed proctoring consent, non-leaking question delivery, observable proctoring telemetry, consent-gated evidence snapshots, and resilient offline-recovery submission workflows.

---

## 1. Prerequisites & System Requirements

- **Operating System**: macOS 12 Monterey or newer (tested on Apple Silicon arm64 & Intel x64), Windows 10/11, or modern Linux distributions.
- **Node.js**: v20.0.0 or higher (verified on Node.js v24.13.0).
- **npm**: v10.0.0 or higher.
- **Peripherals**: Physical or virtual video camera (webcam). Audio/microphone monitoring is explicitly disabled by design.
- **Display**: Minimum screen resolution of 1024x768 (standard 1920x1080 recommended for kiosk mode).

---

## 2. Installation & Quick Start

### 2.1 Clone and Install Dependencies
```bash
git clone https://github.com/KabeerSingh28/Desktop_app.git
cd Athena
npm install
```

### 2.2 Configure Environment
Copy the example environment template:
```bash
cp .env.example .env
```
*(Review `.env` to verify ports, storage directories, and exam durations. Defaults work out of the box).*

### 2.3 Running in Development

In development, Athena runs as two cooperating processes: the Express assessment backend service and the Electron/Vite desktop window.

**Option A: Dedicated Terminal Workflow (Recommended for debugging)**
1. **Terminal 1 – Start the Backend Service**:
   ```bash
   npm run backend
   # Listens on http://localhost:6001
   ```
2. **Terminal 2 – Start the Vite React Dev Server**:
   ```bash
   npm run dev
   # Serves frontend at http://localhost:5173
   ```
3. **Terminal 3 – Launch the Electron Desktop Application**:
   ```bash
   npm run dev:electron
   ```

**Option B: Quick Single-Command Launch**:
```bash
npm start
```

---

## 3. Production Build & Packaging

Athena utilizes `electron-builder` to package native desktop binaries, supporting macOS first (.app / .dmg / directory) and Windows/Linux where platform toolchains permit.

### 3.1 Build Frontend Production Assets
Compile optimized HTML, CSS, and JS bundles into `dist/`:
```bash
npm run build
```

### 3.2 Run Production Bundle Locally
Run Electron pointing directly to the compiled static assets in `dist/index.html` (simulating packaged behavior without DevTools):
```bash
npm run start:prod
```

### 3.3 Package Desktop Application
Package the application into an unpacked native directory for verification:
```bash
npm run package
# macOS: outputs unpacked bundle to release/mac-arm64/Athena.app
```

To build distribution installers (.dmg on macOS):
```bash
npm run dist:mac
# or
npm run dist
```

---

## 4. Architectural Boundaries & Security

Athena enforces strict process isolation between the native Node.js runtime, privileged main process APIs, and untrusted renderer contexts.

```
┌────────────────────────────────────────────────────────┐
│               Electron Main Process                    │
│   (Node.js runtime, window management, native IPC,     │
│    OS kiosk mode, filesystem writes to userData)       │
└──────────────────────────▲─────────────────────────────┘
                           │
             IPC Channel: athena:<domain>:<action>
             Payload Type & Origin Validation
                           │
┌──────────────────────────▼─────────────────────────────┐
│                 Preload Bridge Context                 │
│  (contextBridge.exposeInMainWorld('athena', ...))      │
└──────────────────────────▲─────────────────────────────┘
                           │
             Narrow, Frozen JavaScript Interface
                           │
┌──────────────────────────▼─────────────────────────────┐
│             Renderer Process (React 19)                │
│    (Sandboxed, nodeIntegration: false, webSecurity)    │
└──────────────────────────▲─────────────────────────────┘
                           │
                 HTTP REST API (Port 6001)
                           │
┌──────────────────────────▼─────────────────────────────┐
│             Authoritative Express Backend              │
│    (Sessions, MCQ question delivery, scoring, events)  │
└────────────────────────────────────────────────────────┘
```

### 4.1 Process Sandboxing & Content Isolation
- **`nodeIntegration: false`**: The renderer cannot access Node.js runtime globals (`require`, `process`, `fs`).
- **`contextIsolation: true`**: Preload scripts run in an isolated JavaScript realm; malicious page scripts cannot modify bridge prototypes.
- **`sandbox: true`**: Chromium renderer sandboxing enforces operating system-level process restrictions.
- **`webSecurity: true`**: Standard same-origin policies and CSP protections are strictly active.

### 4.2 Navigation Allowlist & Popup Blocking
- **Popup Denial**: All target `_blank` windows, popups, and auxiliary webContents are intercepted and rejected via `mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`.
- **Navigation Lockdown**: The window prevents navigating away from the local Vite dev server or production `dist/index.html` bundle. Unauthorized navigations log a `navigation:blocked` proctoring event.

### 4.3 Keyboard & Shortcut Interception
- **DevTools & Reload Lockdown**: `Cmd+R`, `Ctrl+R`, `F5`, `F12`, `Cmd+Alt+I`, `Ctrl+Shift+I`, `Cmd+P` (Print), and `Cmd+U` (View Source) are suppressed during active exams and in production.
- **Emergency OS Escape Preservation**: Emergency operating system shortcuts (`Cmd+Q` on macOS, `Alt+F4` and `Ctrl+Alt+Del` on Windows) are **never** blocked, guaranteeing the device owner can safely exit.

### 4.4 IPC Bridge Specification (`window.athena`)

| Channel / Method | Arguments | Return Value | Description |
| :--- | :--- | :--- | :--- |
| `athena.enterFullscreen` | `{ kiosk?: boolean }` | `Promise<{ ok: boolean }>` | Requests native fullscreen and optional kiosk presentation. |
| `athena.exitFullscreen` | None | `Promise<{ ok: boolean }>` | Exits fullscreen when permitted (guarded during active exam). |
| `athena.startExamSession` | `{ name: string, userId: string }` | `Promise<{ ok: boolean, data?: object }>` | Registers candidate session on backend; acquires active session lock. |
| `athena.submitExamSession` | `{ sessionId: string }` | `Promise<{ ok: boolean, data?: object }>` | Finalizes exam session, computes score report, and restores window state. |
| `athena.cancelExamSession` | None | `Promise<{ ok: boolean }>` | Cancels session, clears clocks, and restores normal window presentation. |
| `athena.getRemainingTime` | None | `Promise<{ ok: boolean, data?: number }>` | Returns non-negative integer of milliseconds remaining (clamped at 0). |
| `athena.saveSnapshot` | `{ sessionId: string, dataUrl: string, trigger?: string }` | `Promise<{ ok: boolean, path?: string }>` | Persists sanitized base64 snapshot to sandboxed userData storage. |
| `athena.recordProctorEvent`| `{ sessionId: string, eventType: string, severity: string, metadata?: object }` | `Promise<{ ok: boolean, data?: object }>` | Records observable event, deduplicates, and broadcasts timeline telemetry. |
| `athena.onProctorEvent` | `callback: (event: object) => void` | `() => void` (cleanup) | Subscribes to real-time proctoring telemetry broadcasts. |
| `athena.onWindowStateChanged` | `callback: (state: object) => void` | `() => void` (cleanup) | Subscribes to fullscreen and kiosk state changes. |

---

## 5. Authoritative Backend API Reference

The backend runs on port `6001` (configured via `PORT` or `EXAM_BACKEND_PORT`). All writes use atomic temporary-file renames and serialized mutex queues to eliminate concurrency corruption.

| Method | Endpoint | Payload | Response | Integrity & Privacy Guarantees |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | None | `{ status: "ok", message: string }` | Service liveness health check. |
| `POST` | `/exam/start` | `{ userId, name }` | `{ sessionId, totalQuestions }` | Generates collision-resistant session ID. |
| `GET` | `/exam/mcq/total` | None | `{ total: number }` | Returns total active questions count. |
| `GET` | `/exam/mcq` | None | `Question[]` | Sanitized questions list; **`correctAnswer` is stripped**. |
| `GET` | `/exam/mcq/:id` | None | `Question` | Single sanitized question; returns 404 if not found. |
| `POST` | `/exam/answer` | `{ sessionId, questionId, selectedAnswer }` | `{ message, questionId, attempted }` | Records answer; **masks `isCorrect`**. Rejects duplicate answers (`409`). |
| `GET` | `/exam/session/:sessionId` | None | `Session` | In-progress sessions mask correctness tallies; full report revealed after submit. |
| `POST` | `/exam/submit` | `{ sessionId }` | `{ message, result: { attempted, correct, wrong, totalQuestions } }` | Finalizes session and tallies score. Rejects duplicate submissions (`409`). |
| `POST` | `/exam/session/:sessionId/event` | `ProctoringEvent` | `{ ok: true, event }` | Records structured proctoring event telemetry. |
| `GET` | `/exam/session/:sessionId/events` | None | `{ events: ProctoringEvent[] }` | Retrieves chronological proctoring timeline. |
| `POST` | `/exam/session/:sessionId/snapshot` | `{ dataUrl, trigger }` | `{ ok: true, metadata }` | Records snapshot metadata (capped at 512KB payload). |

---

## 6. Informed Consent, Evidence & Retention Policies

Athena adheres to ethical proctoring guidelines: **telemetry represents observable system state for post-exam human review and never triggers automated penalties or algorithmic accusations**.

### 6.1 Explicit Consent Workflow
- **Preflight Disclosure Screen**: Explains assessment requirements before starting. Displays specific notices:
  - Video snapshots are captured at session start, configured intervals, and final submission.
  - No continuous audio or microphone recording is performed.
  - Observation logs track window blur, fullscreen exits, and device disconnections.
- **Explicit Opt-In**: The candidate must actively check the agreement box and click **"Accept & Begin Assessment"**. Consent is never assumed or pre-checked.

### 6.2 Evidence Storage Location
Snapshots are persisted under Electron's sandboxed user data directory:
```
<app.getPath('userData')>/snapshots/<sanitizedSessionId>/<sanitizedTrigger>_<timestamp>_<hash>.jpg
```
- **macOS**: `~/Library/Application Support/Athena/snapshots/<sessionId>/`
- **Windows**: `%APPDATA%\Athena\snapshots\<sessionId>\`
- **Linux**: `~/.config/Athena/snapshots/<sessionId>/`

Path segments are sanitized using `sanitizePathSegment()` to strip `..`, `/`, `\`, null bytes, and non-alphanumeric characters, preventing directory traversal vulnerabilities.

### 6.3 Retention Limits & Memory Safety
- **100 Snapshot Cap**: The system maintains a maximum of 100 snapshots per candidate session. When the cap is reached, the oldest snapshot is automatically pruned (FIFO).
- **Retention Period**: Files are eligible for administrative purge after 30 days (configured via `RETENTION_DAYS`).
- **Zero Content Logging**: Raw base64 image strings and binary buffers are never printed to console logs, terminal outputs, or audit files.
- **No Biometric Analysis**: Athena does not perform facial recognition, iris/gaze tracking, emotional inference, or automated cheating scores.

---

## 7. Testing & Verification

Run the complete 168-test automated regression suite:
```bash
npm test
```

Execute static code analysis:
```bash
npm run lint
```

Execute production bundle compilation:
```bash
npm run build
```

---

## 8. Troubleshooting & FAQ

### Port Conflict (`EADDRINUSE: port 6001 already in use`)
If port 6001 is occupied by another process:
```bash
# Find and kill the conflicting process
lsof -i :6001
kill -9 <PID>
# Or specify an alternate port in .env:
PORT=6005 npm run backend
```

### Camera Permission Denied (`NotAllowedError`)
- **macOS**: Open **System Settings $\rightarrow$ Privacy & Security $\rightarrow$ Camera**, and ensure **Athena** (or Terminal/Electron during development) has toggle permission enabled.
- **Windows**: Navigate to **Settings $\rightarrow$ Privacy $\rightarrow$ Camera** and enable desktop app access.
- Click **"Retry Access"** in Athena to re-evaluate without restarting the app.

### Camera Locked by Another Application (`NotReadableError`)
Ensure no other video software (Zoom, Teams, FaceTime, Google Meet, OBS) is holding exclusive access to the webcam hardware.

### Offline / Connection Interruption During Submission
If a Wi-Fi drop occurs while submitting the final exam:
1. Do not close or abort the application. Candidate session data remains buffered in memory.
2. Re-establish your network connection.
3. Click the red **"Retry Submission"** button. The request is idempotent and will complete successfully.

### DevTools Do Not Open in Production
By security design, DevTools are actively suppressed and locked out in production builds. In development mode, set `ELECTRON_OPEN_DEVTOOLS=true` in `.env` to enable detached DevTools.
