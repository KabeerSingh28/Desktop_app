# Athena Desktop Examination & Proctoring Implementation Roadmap

**Target Repository:** [KabeerSingh28/Desktop_app](https://github.com/KabeerSingh28/Desktop_app)  
**Document Purpose:** Phased engineering plan to construct, harden, and verify the desktop examination and proctoring system.

---

## 1. Project Objectives & Quality Gates

The implementation roadmap transforms the prototype code and audited reference patterns into a secure, production-grade examination client. Every phase defines strict entry criteria, implementation tasks, and automated or manual verification gates.

```
+-----------+       +-----------+       +-----------+       +-----------+       +-----------+       +-----------+
|  Phase 0  |  ──►  |  Phase 1  |  ──►  |  Phase 2  |  ──►  |  Phase 3  |  ──►  |  Phase 4  |  ──►  |  Phase 5  |
| Baseline  |       | Backend   |       | Electron  |       | Camera &  |       | Exam UI   |       | Results   |
| Hygiene   |       | Service   |       | IPC Core  |       | Proctor   |       | & Engine  |       | & Exit    |
+-----------+       +-----------+       +-----------+       +-----------+       +-----------+       +-----------+
```

---

## 2. Phased Implementation Plan

### Phase 0: Baseline Hygiene & Environment Stabilization
**Goal:** Eliminate uncommitted syntax errors, establish automated unit testing, and standardize configuration.

- **Tasks:**
  1. Fix the invalid `import { ipcMain } from "electron"` in `app.jsx` or safely archive the experimental scratch file.
  2. Resolve the broken `dialog.showMessageBox(window, )` syntax error in `electron/main.cjs`.
  3. Add `"type": "module"` in `package.json` and adjust `electron/main.cjs` / `preload.cjs` loading conventions to eliminate Vite config warnings.
  4. Install `vitest` and `@testing-library/react` for unit and component testing.
  5. Add test scripts: `"test": "vitest run"` and `"test:watch": "vitest"`.
- **Quality Gate:** `npm run lint` passes with 0 errors and `npm run test` executes cleanly.

---

### Phase 1: Robust Backend & Data Service
**Goal:** Establish an authoritative, async Express exam backend operating on standardized Port 6001.

- **Tasks:**
  1. Import and integrate the backend service from `athena-backend/` into `backend/` or as an embedded local service.
  2. Standardize port assignment to `PORT = process.env.EXAM_BACKEND_PORT || 6001`.
  3. Convert synchronous file I/O (`fs.readFileSync`, `fs.writeFileSync`) to asynchronous `fs.promises` to prevent blocking the event loop.
  4. Harden endpoints:
     - `/exam/start`: Validate `name` and `userId`, generate collision-resistant IDs (`crypto.randomUUID()`).
     - `/exam/mcq`: Ensure `correctAnswer` is always omitted from public payloads.
     - `/exam/answer`: Conceal live `isCorrect` evaluation to prevent candidate cheating; update internal counters.
     - `/exam/submit`: Finalize session and calculate total score.
  5. Author unit tests covering question retrieval, duplicate answer rejection, and score computation.
- **Quality Gate:** Automated API tests confirm endpoints handle valid flows and return appropriate HTTP 400/404 errors for malformed requests.

---

### Phase 2: Hardened Electron Main Process & IPC Bridge
**Goal:** Implement context-isolated IPC channels, kiosk enforcement, and secure file storage.

- **Tasks:**
  1. Refactor `electron/main.cjs`:
     - Move all `ipcMain.handle` registrations outside `createWindow()` to prevent memory leaks on window recreation.
     - Enforce `contextIsolation: true` and `nodeIntegration: false` in `webPreferences`.
     - Disable DevTools in production builds (`if (app.isPackaged) win.webContents.closeDevTools()`).
  2. Implement IPC handlers:
     - `kiosk:enter`: Activates `win.setKiosk(true)` and `win.setAlwaysOnTop(true, 'screen-saver')`.
     - `kiosk:exit`: Releases kiosk state upon authorized exam completion.
     - `proctor:save-snapshot`: Writes JPEG buffers asynchronously to `path.join(app.getPath('userData'), 'snapshots', sessionId)`.
     - `exam:show-rules`: Launches native dialog with verified button indices (`defaultId: 0`, `cancelId: 1`).
  3. Intercept navigation shortcuts (Cmd+R, Ctrl+R, F5, F11, Alt+Tab, Cmd+Q) and window blur events.
  4. Refactor `electron/preload.cjs` to expose strictly typed methods on `window.electronAPI`.
- **Quality Gate:** Electron launches in kiosk mode; attempts to open DevTools or navigate away are blocked; snapshots save to `app.getPath('userData')`.

---

### Phase 3: Camera & Proctoring Subsystem
**Goal:** Construct an automated webcam snapshot pipeline with proper resource cleanup.

- **Tasks:**
  1. Build a `useWebcam` React hook:
     - Prompts for permissions via `navigator.mediaDevices.getUserMedia`.
     - Attaches stream to a `<video>` element for preview.
     - Exposes a `stopStream()` function that terminates all tracks (`track.stop()`).
  2. Implement offscreen `<canvas>` frame capture:
     - Renders current video frame to a 640x480 offscreen canvas.
     - Converts frame to compressed JPEG (`canvas.toDataURL('image/jpeg', 0.6)`).
     - Transmits frame to `window.electronAPI.saveSnapshot`.
  3. Implement snapshot interval controller:
     - Triggers capture every 20 seconds with random jitter.
     - Automatically ceases capture when exam status transitions out of `IN_PROGRESS`.
- **Quality Gate:** Webcam feed displays in pre-check; snapshots appear in the user data folder every 20s without dropped frames; webcam indicator LED shuts off immediately upon exam submission.

---

### Phase 4: Candidate Experience & Examination Engine
**Goal:** Build the complete examination interface with state preservation and timer sync.

- **Tasks:**
  1. Build Candidate Journey Flow:
     - **Screen 1 (Pre-Check)**: Camera access and fullscreen/kiosk permissions.
     - **Screen 2 (Rules Confirmation)**: Dialog or modal outlining rules before timer starts.
     - **Screen 3 (Active Exam)**: Split-pane question display, navigation palette, timer, and end test button.
     - **Screen 4 (Results)**: Completion banner, score summary, and exit button.
  2. Implement Question & Answer State Engine:
     - Maintain an answers map: `{ [questionId]: selectedOptionIndex }`.
     - Retain selected radio button when moving Previous / Next.
     - Autosave answer to backend `/exam/answer` on question change.
  3. Authoritative Timer:
     - Store `deadlineEpoch` received from session initialization.
     - Compute remaining time locally: `Math.max(0, deadlineEpoch - Date.now())`.
     - Trigger automatic `/exam/submit` when remaining time reaches 0.
- **Quality Gate:** Questions paginate smoothly; answered questions retain radio selection; timer counts down accurately and triggers auto-submit on expiration.

---

### Phase 5: Result Evaluation, Audit & Graceful Teardown
**Goal:** Complete the submission workflow, score calculation, and safe application termination.

- **Tasks:**
  1. Implement "End Exam" confirmation modal to prevent accidental submissions.
  2. Call `/exam/submit` to seal the session on the backend.
  3. Display the final score report (Attempted, Correct, Wrong, Final Score).
  4. Provide an "Exit Application" action that:
     - Releases kiosk mode via `kiosk:exit`.
     - Shuts down active media streams.
     - Calls `app:quit` to close Electron cleanly.
- **Quality Gate:** Exam can be ended manually or via timeout; score matches answered questions; application exits cleanly without orphaned background processes.

---

### Phase 6: Packaging, Hardening & End-to-End Verification
**Goal:** Package application and verify security boundaries across target platforms.

- **Tasks:**
  1. Configure `electron-builder` in `package.json` for macOS and Windows targets.
  2. Test production build (`npm run build && electron .`).
  3. Run comprehensive end-to-end verification checklist.
- **Quality Gate:** Standalone executable builds successfully and runs in locked kiosk mode with proctoring active.

---

## 3. Baseline Test Instructions & Verification Checklists

### 3.1 Unit & Non-Destructive Check Suite
Run these checks before and after each phase:
```bash
# 1. Check code style and syntax hygiene
npm run lint

# 2. Verify Vite production bundling
npm run build

# 3. Verify Vitest suite (once configured in Phase 0)
npm run test
```

### 3.2 Backend Service Test Checklist
```bash
# Verify backend health check
curl -X GET http://localhost:6001/

# Verify session start
curl -X POST http://localhost:6001/exam/start \
  -H "Content-Type: application/json" \
  -d '{"userId": "TEST-01", "name": "Candidate"}'

# Verify question sanitization (confirm correctAnswer is absent)
curl -X GET http://localhost:6001/exam/mcq/1

# Verify answer submission
curl -X POST http://localhost:6001/exam/answer \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "<SESSION_ID>", "questionId": 1, "selectedAnswer": 0}'

# Verify exam submission
curl -X POST http://localhost:6001/exam/submit \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "<SESSION_ID>"}'
```

### 3.3 Security & Proctoring Manual Verification
- [ ] **Kiosk Lock**: Pressing Escape, F11, or Alt+Tab does not expose the desktop or other apps.
- [ ] **DevTools Lock**: Pressing F12 or Cmd+Option+I does not open developer tools.
- [ ] **Hardware Privacy**: When exam ends, the webcam activity light turns off immediately.
- [ ] **Data Safety**: User data snapshots are written under `app.getPath('userData')/snapshots` and not in `node_modules` or `__dirname`.
- [ ] **Persistence**: Refreshing or reopening does not corrupt session JSON files.

---

## 4. Risk Register & Mitigation Strategy

| Risk ID | Identified Risk | Impact | Probability | Mitigation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **R-01** | Port 6001 collision with other local services | High | Medium | Support dynamic fallback or configurable port via environment variable `EXAM_BACKEND_PORT`. |
| **R-02** | Webcam permission denied by candidate OS | Critical | Low | Provide clear permission onboarding UI with retry button before exam start is allowed. |
| **R-03** | Main process blocking on heavy snapshot writes | High | Medium | Use `fs.promises.writeFile`, compress images to 60% JPEG, and limit capture frequency to 20s. |
| **R-04** | Accidental app closure during exam | Critical | Medium | Intercept `window.on('close')` in main process and require explicit exam submission confirmation. |
| **R-05** | Candidate network drop during exam | High | Medium | Cache questions locally upon session start; buffer answers in local state before posting. |

---

## 5. Recommended Order for the Next Task

To proceed efficiently without breaking current work:
1. **Immediate Task (Phase 0)**:
   - Clean up the untracked `app.jsx` lint error.
   - Fix the broken dialog syntax in `electron/main.cjs`.
   - Set up Vitest and create baseline tests for IPC contracts.
2. **Subsequent Task (Phase 1)**:
   - Integrate the backend Express service into the workspace on Port 6001 with asynchronous persistence.
