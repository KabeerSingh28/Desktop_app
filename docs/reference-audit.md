# Comprehensive Reference Audit: Athena Examination & Proctoring Application

**Target Repository:** [KabeerSingh28/Desktop_app](https://github.com/KabeerSingh28/Desktop_app)  
**Local Workspace:** `/Users/kabeersingh/Desktop/Athena`  
**Reference Repositories Inspected:**
1. Reference 1: [JACOBIAN01/athena-exam](https://github.com/JACOBIAN01/athena-exam)
2. Reference 2: [onlyaditya/myAthena](https://github.com/onlyaditya/myAthena)

---

## 1. Executive Summary

This audit evaluates the codebase of the local repository alongside two reference implementations to guide the construction of a hardened, Electron-based desktop examination and proctoring application.

- **Current Local Repository (`Athena`)**: Contains a modern React 19 + Vite 8 + Tailwind CSS v4 foundation with an Electron wrapper (`electron/main.cjs`, `electron/preload.cjs`). However, the existing implementation is in an early scaffolding state with incomplete IPC event handlers, an invalid dialog invocation in the main process, an untracked scratch file (`app.jsx`) containing invalid renderer-side Electron imports, and no question fetching or examination engine.
- **Reference 1 (`JACOBIAN01/athena-exam`)**: Provides a working Express backend (`athena-backend/server.js`) on **Port 6001** that implements session creation, question sanitization (stripping correct answers), single-answer submission with server-side validation, and final exam submission. The frontend (`athena-frontend`), however, is minimal—only creating a session and querying total questions, without rendering exam questions, camera preview, or proctoring snapshots.
- **Reference 2 (`onlyaditya/myAthena`)**: Provides the candidate setup UI, camera access preview via `getUserMedia`, periodic webcam snapshots, fullscreen/kiosk invocation, exam rules dialog, and a multi-step question view (`MainExam.jsx`). However, it suffers from critical architectural defects:
  - **Port Mismatch**: `MainExam.jsx` hardcodes `http://localhost:3000/exam/mcq/${id}`, failing when connecting to the Reference 1 backend (which runs on **Port 6001**).
  - **Broken Timer**: End time is computed as `Date.now() + 60 * 60 * 60` (216,000 ms = 3.6 minutes instead of 1 hour).
  - **Crashing Snapshot Storage**: Saves photos synchronously via `fs.writeFileSync` to a non-existent relative folder `path.join(__dirname, 'camera_feed')`, which crashes with `ENOENT` in development and fails completely inside packaged ASAR archives.
  - **Missing Exam Lifecycle**: Answers are never submitted to the backend (`/exam/answer` is never called), question selections are wiped on navigation, and "End Test" only prints to `console.log`.
  - **Major Security Exposures**: DevTools are explicitly opened in detached mode, frameless windows lack safe exit mechanisms, and no keyboard shortcuts or navigation locks are installed.

---

## 2. Source Code Inventory & Repository Structure

### 2.1 Current Local Repository (`/Users/kabeersingh/Desktop/Athena`)
```text
Athena/
├── app.jsx                       # Untracked scratch component (has invalid electron import)
├── dist/
│   └── preload.cjs               # Untracked build artifact with minimal IPC wrapper
├── electron/
│   ├── main.cjs                  # Electron main process (uncommitted edits, invalid dialog call)
│   └── preload.cjs               # Preload script exposing window.electronAPI
├── eslint.config.js              # Flat ESLint configuration (flags app.jsx unused ipcMain)
├── package.json                  # React 19.2.8, Electron 41.10.7, Vite 8.3.0, Tailwind 4.3.3
├── package-lock.json
├── public/                       # Favicons and SVG assets
├── README.md                     # Setup instructions mentioning JACOBIAN01/Athena
├── src/
│   ├── App.jsx                   # Initial setup UI: camera preview and fullscreen request
│   ├── assets/                   # Images and icons
│   ├── index.css                 # Tailwind CSS v4 import
│   └── main.jsx                  # React DOM mount point
└── vite.config.js                # Vite build config with React & Tailwind plugins
```

### 2.2 Reference 1 (`JACOBIAN01/athena-exam`)
```text
athena-exam/
├── athena-backend/
│   ├── data/
│   │   ├── questions.json        # 5 MCQ questions with options and correctAnswer indices
│   │   └── sessions.json         # Array of exam session records
│   ├── package.json              # Express 5.1.0, CORS 2.8.5, nodemon 3.1.14
│   ├── README.md                 # API documentation (erroneously states port 3000)
│   └── server.js                 # Express server listening on PORT 6001
└── athena-frontend/
    ├── electron/
    │   ├── main.cjs              # Electron window (800x500), IPC for startExam & get-mcq-number
    │   └── preload.cjs           # contextBridge exposing startExam and getTotalMCQ
    ├── package.json              # React 19.2.8, Electron 44.4.5, Vite 8.3.0
    └── src/
        └── App.jsx               # Form for Name + URN, starts session, displays total MCQ count
```

### 2.3 Reference 2 (`onlyaditya/myAthena`)
```text
myAthena/
├── Archive.zip                   # Early snapshot archive
├── electron.zip                  # Full snapshot archive containing MainExam component
├── electron/
│   ├── main.cjs                  # Frameless window, kiosk toggle, timer, dialog, savePhoto
│   └── preload.cjs               # contextBridge exposing fullScreen, timer, rules, photo
├── package.json                  # React 19.2.8, Electron 44.4.5, Vite 8.3.0
├── src/
│   ├── App.css                   # Custom stylesheets for permissions card & exam layout
│   ├── App.jsx                   # Setup view: camera stream, canvas capture interval, timer
│   └── components/
│       └── MainExam.jsx          # (Inside electron.zip) 5-question paginated exam view
└── vite.config.js
```

---

## 3. Deep-Dive Feature Analysis

### 3.1 Exam APIs & Backend Routes
**Primary Source:** `athena-exam/athena-backend/server.js`

| Method | Endpoint | Request Payload | Response Payload | Analysis & Defects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | None | `{ message: "Exam backend is running" }` | Health check endpoint. |
| `POST` | `/exam/start` | `{ userId, name }` | `{ message, sessionId }` | Creates session in `sessions.json` with timestamped ID (`session-${Date.now()}`). Fails to validate ID format; vulnerable to replay attacks. |
| `GET` | `/exam/mcq/total` | None | `{ total: number }` | Returns question count. Useful for pagination bounds. |
| `GET` | `/exam/mcq/:id` | None (URL Param) | `{ id, question, options }` | Returns single question. **Security Positive:** `correctAnswer` is stripped via `questionForStudent()`. |
| `GET` | `/exam/mcq` | None | `Array<{ id, question, options }>` | Returns all sanitized questions. |
| `POST` | `/exam/answer` | `{ sessionId, questionId, selectedAnswer }` | `{ message, isCorrect, attempted, correct, wrong }` | Validates session is `in-progress`. Prevents duplicate submission for same question. Computes score server-side. **Defect:** Immediately returns `isCorrect` to candidate, leaking correctness during a live exam! |
| `GET` | `/exam/session/:sessionId` | None (URL Param) | Full session JSON object | Returns candidate history. **Defect:** No authentication; any candidate can view another's session data. |
| `POST` | `/exam/submit` | `{ sessionId }` | `{ message, result: { attempted, correct, wrong } }` | Sets `session.status = "submitted"` and timestamps `submittedAt`. |

### 3.2 Session Lifecycle & State Management
- **Reference 1 Implementation (`server.js` Lines 44–75, 193–223):**
  - Session lifecycle starts with state `"in-progress"`.
  - Answering increments counters (`attempted`, `correct`, `wrong`).
  - Terminal state is `"submitted"`. Subsequent answer attempts reject with `HTTP 400 "Exam is already submitted"`.
  - **Defect:** No timeout state. If a student disconnects or closes the application, the session remains permanently `"in-progress"`.
- **Reference 2 Implementation:**
  - Entirely client-side state in `App.jsx` (`started: boolean`).
  - Completely detached from backend sessions; does not call `/exam/start` or `/exam/submit`.
- **Target Application Requirement:**
  - Synchronize local Electron session with backend lifecycle: `PRE_CHECK -> READY -> IN_PROGRESS -> SUBMITTED | TIMED_OUT`.

### 3.3 Question Retrieval & Client Caching
- **Reference 1:** Exposes IPC handler `get-mcq-number` in `electron/main.cjs:34`, but no IPC handler exists to fetch actual questions.
- **Reference 2:** `MainExam.jsx:13` calls `fetch('http://localhost:3000/exam/mcq/${id}')` directly from the renderer process.
- **Defects & Risks:**
  - **Bypassing Preload / Main Process:** Renderer calls backend directly over HTTP instead of through a controlled IPC channel or centralized API client.
  - **Port Desynchronization:** Backend listens on `6001`, but `MainExam.jsx` calls `3000`.
  - **No Cache:** Navigating back and forth refetches the question from the network each time.
  - **Hardcoded Limit:** `MainExam.jsx:10` hardcodes `const totalQuestions = 5`.

### 3.4 Answer Submission & Evaluation Engine
- **Reference 1:** Server-side evaluation in `server.js:148`:
  ```javascript
  const isCorrect = Number(selectedAnswer) === question.correctAnswer;
  ```
  This is the correct pattern (evaluation on backend). However, leaking `isCorrect` in the response allows a student to know if they were right before finishing the exam.
- **Reference 2:** `MainExam.jsx:8` has `const [selectedOption, setSelectedOption] = useState(null)`.
  - **Critical Defect:** When a candidate clicks "Next", `selectedOption` is reset to `null` (`MainExam.jsx:36`). The answer is **never transmitted to the server**, and navigating back resets the candidate's choice.

### 3.5 Camera Snapshots & Proctoring Pipeline
- **Reference 2 (`App.jsx` & `extracted_electron/src/App.jsx`):**
  - Camera setup: `navigator.mediaDevices.getUserMedia({ video: true })` bound to a `<video>` ref.
  - Keeps video alive in background: Uses CSS class `hidden-video` (`opacity: 0, position: fixed, pointer-events: none`).
  - Snapshot Capture Methods found:
    1. *ImageCapture API* (`App.jsx:35`): `new ImageCapture(track).takePhoto()` -> `arrayBuffer()` -> IPC `savePhoto`.
    2. *Hidden Canvas* (`extracted_electron/src/App.jsx:53-71`): Offscreen canvas `ctx.drawImage(video, 0, 0)` -> `canva.toDataURL("image/png")` -> IPC `savePhoto`.
  - Snapshot Storage (`electron/main.cjs:60-71`):
    ```javascript
    ipcMain.handle("save-photo", (event, image) => {
      const imageData = image.split(",")[1];
      const filePath = path.join(__dirname, "camera_feed", `photo-${Date.now()}.png`);
      fs.writeFileSync(filePath, Buffer.from(imageData, "base64"));
      return filePath;
    });
    ```
  - **Critical Defects:**
    - `camera_feed` directory is never created with `fs.mkdirSync`. Calling `fs.writeFileSync` throws `ENOENT` and crashes the handler.
    - Synchronous `fs.writeFileSync` blocks the main thread every 1000ms.
    - Using `__dirname` resolves inside the read-only application package (`app.asar`) in production.
    - **Resource Leak:** Camera tracks are never stopped (`track.stop()`) on unmount or exam completion.

### 3.6 Fullscreen, Kiosk Mode & Window Behavior
- **Local Repo (`Athena`):**
  - `src/App.jsx:14`: `document.documentElement.requestFullscreen()` (standard DOM API).
  - `electron/main.cjs:28`: `win.setFullScreen(true)`.
- **Reference 2 (`myAthena`):**
  - `electron/main.cjs:8-15`:
    ```javascript
    win = new BrowserWindow({
      width: 1000,
      height: 700,
      frame: false,
      webPreferences: { preload: path.join(__dirname, "preload.cjs") }
    });
    ```
  - `electron/main.cjs:21`: `ipcMain.handle("full-screen", () => { win.kiosk = true; });`
- **Defects & Risks:**
  - Setting `win.kiosk = true` directly instead of calling the Electron method `win.setKiosk(true)`.
  - `frame: false` removes the title bar and window controls. Without kiosk mode or window drag regions, candidates on macOS cannot move or close the window if stuck.
  - Kiosk mode does not trap system key combinations (Alt+Tab, Cmd+Tab, Mission Control) unless configured with keyboard event filtering and `win.setAlwaysOnTop(true, "screen-saver")`.

### 3.7 Timer Architecture & Correctness
- **Reference 2 (`electron/main.cjs:25-39`):**
  ```javascript
  let end_time = null;
  ipcMain.handle("start-test", () => {
    end_time = Date.now() + 60 * 60 * 60; // BUG: 216,000 ms = 216 seconds = 3.6 minutes!
  });
  ipcMain.handle("get-time", () => {
    return end_time - Date.now();
  });
  ```
- **Renderer Polling (`App.jsx:20-25`):**
  - Sets up `setInterval(..., 1000)` invoking `getRemainingTime()` over IPC every second.
- **Defects & Risks:**
  - **Calculation Bug:** To compute 1 hour (3600 seconds), milliseconds must be `60 * 60 * 1000 = 3,600,000`. Multiplying `60 * 60 * 60` yields only 216 seconds.
  - **Negative Values:** Once `end_time` passes, `get-time` returns negative values. The UI format function formats negative numbers into nonsensical strings like `-1:59:45`.
  - **No Expiration Action:** Timer reaching 0 triggers no auto-submit or freeze.

### 3.8 Rule Acceptance Dialog
- **Local Repo (`electron/main.cjs:35-37`):**
  ```javascript
  ipcMain.handle('show-exam-rules', async () => {
    const res = await dialog.showMessageBox(window, ) // BUG: syntax error, dialog unimported, window undefined
  });
  ```
- **Reference 2 (`myAthena/electron/main.cjs:41-58`):**
  ```javascript
  ipcMain.handle("show-rules", async () => {
    const result = await dialog.showMessageBox(win, {
      type: "info",
      title: "Exam Rules",
      message: "Please read the exam rules carefully.",
      detail: "...",
      buttons: ["Accept", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    return result.response;
  });
  ```
- **Inversion Bug:**
  - In root `myAthena/electron/main.cjs`, `buttons` was `["Cancel", "Accept"]` where index 1 was Accept.
  - In `extracted_electron/electron/main.cjs`, `buttons` was `["Accept", "Cancel"]` where index 0 was Accept.
  - In `App.jsx`, code checks `if (res === 0)`. If paired with the wrong main process version, clicking "Cancel" starts the exam!

### 3.9 Preload & IPC Security Model
- **Local Repo (`electron/preload.cjs`):**
  - Uses `contextBridge.exposeInMainWorld('electronAPI', { ... })`.
  - Exposes `save`, `delete`, `update`, `create`, `setFullScreen`, `getData`, `showExamRules`.
  - Mismatch: `showExamRules` calls `ipcRenderer.send`, but main registered `ipcMain.handle`.
- **Reference 1 (`athena-frontend/electron/preload.cjs`):**
  - Exposes `startExam` and `getTotalMCQ`.
- **Reference 2 (`myAthena/electron/preload.cjs`):**
  - Exposes `setFullScreen`, `getRemainingTime`, `startTest`, `showRules`, `savePhoto`.
- **Security Vulnerabilities:**
  - `webPreferences` in all repositories omit explicit `contextIsolation: true` and `nodeIntegration: false`. Modern Electron defaults to these, but omitting them invites regression.
  - Untyped payloads: `savePhoto` accepts arbitrary strings without size limits, enabling memory exhaustion attacks.
  - Handlers registered inside `createWindow`: in local repo `electron/main.cjs:16`, `ipcMain.on` calls are placed inside `createWindow()`. If `createWindow()` is invoked again (e.g. on macOS `app.on('activate')`), duplicate listeners are registered, leaking memory and producing double-actions.

### 3.10 DevTools & Proctoring Integrity
- **Reference 1 (`athena-frontend/electron/main.cjs:15`):**
  `window.webContents.openDevTools()` is unconditionally executed.
- **Reference 2 (`myAthena/electron/main.cjs:24`):**
  `win.webContents.openDevTools({ mode: "detach" })` is unconditionally executed.
- **Proctoring Risk:** In a desktop exam proctoring application, opening DevTools allows candidates to inspect questions, tamper with local state, alter timer variables, simulate responses, and terminate the camera stream. DevTools must be strictly disabled or locked behind an administrative flag.

### 3.11 Application Shutdown & Resource Cleanup
- Neither reference handles application shutdown cleanly.
- `MainExam.jsx:54`:
  ```javascript
  async function endTest() {
    console.log("End Test clicked");
  }
  ```
  The exam cannot be finished from the UI.
- Closing the window leaves active camera streams and leaves the session in the backend permanently marked `"in-progress"`.

### 3.12 Data Persistence & Storage Paths
- **Reference 1:** Uses synchronous `fs.readFileSync` and `fs.writeFileSync` in `athena-backend/server.js` against relative paths `data/questions.json` and `data/sessions.json`.
- **Reference 2:** Uses `fs.writeFileSync(path.join(__dirname, 'camera_feed', ...))` in Electron main.
- **Production Pitfall:**
  - `__dirname` resolves into `app.asar` when packaged with `electron-builder`. ASAR is read-only.
  - All desktop-side persistence (snapshots, local audit logs, cached session credentials) must use `app.getPath('userData')`.

### 3.13 Network & Backend Port Inconsistencies
- Backend is configured to listen on **Port 6001** (`athena-backend/server.js:7`).
- Backend README claims it runs on **Port 3000** (`athena-backend/README.md:29`).
- Reference 1 Electron main targets **Port 6001** (`athena-frontend/electron/main.cjs:22`).
- Reference 2 React frontend targets **Port 3000** (`MainExam.jsx:13`).
- **Consequence:** Running Reference 1's backend and Reference 2's frontend together causes all question fetches to fail with `ERR_CONNECTION_REFUSED`.

---

## 4. Cross-Repository Feature Comparison Matrix

| Feature / Capability | Local Repo (`Athena`) | Reference 1 (`athena-exam`) | Reference 2 (`myAthena`) | Target State (`Desktop_app`) |
| :--- | :--- | :--- | :--- | :--- |
| **Framework & Tooling** | React 19 + Vite 8 + Tailwind v4 + Electron 41 | React 19 + Vite 8 + Express 5 + Electron 44 | React 19 + Vite 8 + Electron 44 | React 19 + Vite + Tailwind + Electron + Vitest |
| **Backend Exam Service** | None | Express (Port 6001, JSON files) | None | Robust local/embedded Express or Node service |
| **Session Lifecycle (`/start`, `/submit`)** | None | Implemented in backend | Missing | Fully integrated with client state machine |
| **MCQ Question Retrieval** | None | Sanitized API on backend | Hardcoded fetch to port 3000 | Sanitized IPC/HTTP client with caching |
| **Answer Submission** | None | Backend endpoint exists | Not implemented in UI | Live auto-save + final bundle validation |
| **Server-Side Scoring** | None | Implemented in backend | Missing | Authoritative backend evaluation |
| **Camera Access & Preview** | Basic `getUserMedia` | None | Working `<video>` preview | Validated camera feed with device selection |
| **Proctoring Snapshots** | None | None | 1s canvas snapshot to IPC | Async offscreen canvas capture to `userData` |
| **Fullscreen / Kiosk Mode** | `requestFullscreen` | None | `win.kiosk = true`, `frame: false` | True Kiosk mode (`setKiosk(true)`), locked keys |
| **Exam Rules Dialog** | Broken syntax call | None | `dialog.showMessageBox` | Modal dialog in React or native Electron dialog |
| **Countdown Timer** | Static text placeholder | None | IPC polling, formula bug (216s) | Server-synchronized epoch timer with auto-submit |
| **Preload / IPC Security** | `contextBridge` with mismatches | `contextBridge` (2 channels) | `contextBridge` (5 channels) | Typed IPC invoke/handle contract, sanitized input |
| **DevTools Lockdown** | Commented out | Explicitly opened | Explicitly opened (detached) | Disabled in production; shortcut blocked |
| **Resource Cleanup** | None | None | None | Camera track stop, interval cleanup, safe exit |
| **Snapshot Storage Path** | None | None | `__dirname/camera_feed` (crashes) | `app.getPath('userData')/snapshots` |

---

## 5. Defect & Security Risk Inventory

### Critical Defects (Crashes & Breaking Errors)
1. **Uncaught ENOENT in `save-photo` (Ref 2):**
   `path.join(__dirname, 'camera_feed')` is never created. Electron crashes or throws unhandled promise rejections on every snapshot.
2. **ASAR Immutability Crash (Ref 2):**
   Writing to `__dirname` in packaged Electron apps fails because the directory is inside the read-only ASAR archive.
3. **Backend Port Mismatch (Ref 1 vs Ref 2):**
   Backend listens on `6001`, frontend calls `3000`. Network requests fail immediately.
4. **Main Process Syntax Error (Local Repo):**
   `electron/main.cjs:36`: `await dialog.showMessageBox(window, )` references unimported `dialog`, undefined `window`, and contains a trailing comma without arguments.
5. **Lint Failure on `app.jsx` (Local Repo):**
   Untracked `app.jsx` imports `ipcMain` in renderer code, causing ESLint to fail and risking bundle failure.

### High-Risk Security Exposures
1. **Unrestricted DevTools:**
   Both reference implementations explicitly launch DevTools. Candidates can alter client variables, read question schemas, and tamper with timers.
2. **Instant Correctness Leak (Ref 1):**
   `/exam/answer` returns `isCorrect` immediately upon submission.
3. **Unauthenticated Session Access (Ref 1):**
   `/exam/session/:sessionId` and `/exam/submit` accept raw IDs without authorization tokens or machine signatures.
4. **Missing Navigation and Keyboard Interception:**
   Candidates can press standard OS shortcuts (Alt+Tab, Cmd+Q, Ctrl+W, F11, Escape) to exit kiosk mode or close the application.

### Functional & Algorithmic Bugs
1. **Timer Formula Bug (Ref 2):**
   `60 * 60 * 60` = 216 seconds instead of 3,600 seconds (1 hour).
2. **Question State Loss (Ref 2):**
   `selectedOption` is not persisted in candidate state across question navigation.
3. **IPC Registration Leak (Local Repo):**
   `ipcMain.on` handlers placed inside `createWindow()` result in duplicate listeners if the window is recreated.
4. **Uncontrolled Snapshot Frequency:**
   Capturing full-resolution PNG data URLs every 1000ms creates extreme CPU and memory overhead, resulting in hundreds of megabytes within minutes.

---

## 6. Reusable Ideas & What to Avoid

### Reusable Concepts to Adopt
- **Separation of Concerns for MCQs:** Sanitizing questions on the server so the renderer never has access to `correctAnswer`.
- **Pre-Exam Permission Checklist UI:** Clean user experience verifying camera access and fullscreen before entering the exam room (found in `myAthena/src/App.css` and local `src/App.jsx`).
- **Offscreen Canvas Snapshot Technique:** Using a hidden `<canvas>` to grab frames from the active camera stream without interrupting the candidate's view.
- **Server-Side Session Record:** Storing session start time, attempted questions, and final submission timestamp in a persistent data store.

### Anti-Patterns to Strictly Avoid
- Never use synchronous file operations (`fs.writeFileSync`, `fs.readFileSync`) in the main process or backend request paths.
- Never hardcode filesystem paths relative to `__dirname` for user data or uploads.
- Never poll IPC over intervals for static time countdowns; transmit an epoch deadline once and calculate remaining time locally.
- Never import Electron main process modules (`ipcMain`, `dialog`, `BrowserWindow`) inside Vite renderer components.
- Never leave DevTools enabled in production exam builds.
