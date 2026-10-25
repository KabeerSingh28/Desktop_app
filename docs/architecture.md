# Target System Architecture: Athena Desktop Examination & Proctoring Application

**Project Name:** Athena Desktop Exam System  
**Target Repository:** [KabeerSingh28/Desktop_app](https://github.com/KabeerSingh28/Desktop_app)  
**Primary Tech Stack:** Electron 41+, React 19, Vite 8, Tailwind CSS v4, Node.js / Express 5  

---

## 1. Architectural Overview & System Vision

The Athena Desktop Examination Application is designed as a secure, candidate-facing desktop client for high-integrity assessments. The architecture addresses the vulnerabilities and defects discovered in the reference repositories by decoupling responsibilities across a multi-process model:

1. **Hardened Main Process**: Acts as the security supervisor. Manages frameless kiosk windows, intercepts anti-tamper shortcuts, writes encrypted or organized proctoring snapshots to OS-approved user data directories, and supervises the embedded or local backend service.
2. **Context-Isolated Preload Bridge**: Exposes a minimal, typed, and schema-validated IPC surface via `contextBridge`. Prevents direct access to Node.js internals or arbitrary IPC messaging from the renderer.
3. **Reactive Renderer Process (React 19)**: Implements the candidate journey—camera verification, hardware checks, rules confirmation, paginated question palette, local answer preservation, authoritative countdown display, and exam submission.
4. **Authoritative Exam Backend Service**: Evaluates candidate answers server-side, withholds answer keys from the client, manages the session state machine, and persists audit trails asynchronously.

```
+-----------------------------------------------------------------------------------------+
|                                    ELECTRON HOST                                        |
|                                                                                         |
|  +------------------------+      Secure IPC      +-----------------------------------+  |
|  |    Renderer Process    |  (Context Bridge)    |            Main Process           |  |
|  |       (React 19)       |<====================>|           (Node.js Core)          |  |
|  |                        |                      |                                   |  |
|  | - Pre-check UI         |                      | - Kiosk & Anti-Tamper Lockdown    |  |
|  | - Camera Preview       |                      | - Async Snapshot Pipeline         |  |
|  | - Offscreen Canvas     |                      | - DevTools / Shortcut Interceptor |  |
|  | - Exam Question Engine |                      | - Lifecycle & Safe Teardown       |  |
|  | - Local Answer Cache   |                      | - userData Storage Resolver       |  |
|  +------------------------+                      +-----------------+-----------------+  |
|              |                                                     |                    |
+--------------|-----------------------------------------------------|--------------------+
               | HTTP / Fetch                                        | Local File I/O
               v                                                     v
+-------------------------------+                  +-----------------------------------+
|      Exam Backend Service     |                  |       OS userData Directory       |
|          (Port 6001)          |                  |  (app.getPath('userData'))        |
|                               |                  |                                   |
| - Session Lifecycle API       |                  | - snapshots/<sessionId>/*.jpg     |
| - MCQ Sanitized Distribution  |                  | - sessions/<sessionId>.json       |
| - Server-Side Evaluation      |                  | - exam-config.json                |
| - Non-blocking JSON/DB Engine |                  +-----------------------------------+
+-------------------------------+
```

---

## 2. Process Architecture & Boundaries

### 2.1 Electron Main Process (`electron/main.cjs`)
- **Window Management**:
  - Creates a single frameless `BrowserWindow`.
  - Configures `webPreferences`:
    ```javascript
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // set to false only if node APIs are strictly isolated in preload
    }
    ```
  - Enforces true Kiosk mode via `win.setKiosk(true)` and `win.setAlwaysOnTop(true, 'screen-saver')`.
- **Anti-Tamper & Security Supervision**:
  - Disables DevTools unconditionally in production builds (`win.webContents.closeDevTools()`).
  - Intercepts navigation attempts (`will-navigate`, `new-window`).
  - Filters global keyboard shortcuts (Alt+Tab, Cmd+Q, Ctrl+W, F11, Escape, DevTools shortcuts).
  - Monitors window blur events (`win.on('blur', ...)`), broadcasting violation warnings to the backend/audit log.
- **Proctoring Snapshot Service**:
  - Receives base64/binary image buffers over IPC.
  - Resolves target directory via `app.getPath('userData')/snapshots/<sessionId>`.
  - Performs non-blocking asynchronous file writes (`fs.promises.writeFile`).
- **Teardown & Cleanup Controller**:
  - Coordinates graceful session submission prior to window destruction.
  - Emits cleanup events to the renderer to terminate media devices.

### 2.2 Preload Security Bridge (`electron/preload.cjs`)
The preload script adheres to the Principle of Least Privilege. Only high-level domain functions are exposed to `window.electronAPI`. No raw `ipcRenderer.send` or `ipcRenderer.on` primitives are accessible in the DOM.

```javascript
// Pattern for exposed API
contextBridge.exposeInMainWorld('electronAPI', {
  enterKiosk: () => ipcRenderer.invoke('kiosk:enter'),
  exitKiosk: () => ipcRenderer.invoke('kiosk:exit'),
  saveSnapshot: (payload) => ipcRenderer.invoke('proctor:save-snapshot', payload),
  showRulesDialog: () => ipcRenderer.invoke('exam:show-rules'),
  syncTime: () => ipcRenderer.invoke('exam:sync-time'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  quitApp: () => ipcRenderer.invoke('app:quit')
});
```

### 2.3 Renderer Process (`src/`)
- Built with **React 19**, **Vite 8**, and styled with **Tailwind CSS v4**.
- **Candidate Journey State Machine**:
  - `PERMISSIONS`: Camera access confirmation and full-screen / kiosk engagement.
  - `RULES_CONFIRMATION`: Modal / dialog presenting exam policies with definitive acceptance.
  - `EXAM_ACTIVE`: Question presentation, palette navigation, live answers preservation, and background proctoring.
  - `EXAM_SUBMITTED`: Summary results view and confirmation of completion.
- **Camera & Snapshot Capture**:
  - Requests stream via `navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })`.
  - Captures frames periodically via an offscreen `<canvas>` without interrupting DOM rendering.
  - Halts all stream tracks (`track.stop()`) when navigating away from the exam view.

### 2.4 Authoritative Exam Backend Service
- Standalone or embedded Node.js/Express service running on standardized **Port 6001**.
- **Guaranteed Isolation of Answer Keys**:
  - `questions.json` contains `correctAnswer` indices.
  - API endpoints `/exam/mcq` and `/exam/mcq/:id` map questions through a sanitizer, guaranteeing the renderer cannot access correct answers via DevTools or network snooping.
- **Server-Side Grading**:
  - `/exam/answer` grades submissions internally.
  - Live API suppresses the `isCorrect` property during an active exam to prevent cheat cues, only releasing aggregate results upon `/exam/submit`.

---

## 3. Secure IPC Contract Specification

All communication between Renderer and Main follows standard request-response IPC patterns using `ipcRenderer.invoke` and `ipcMain.handle`.

| Channel Name | Direction | Request Payload Schema | Response Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `kiosk:enter` | Renderer -> Main | `void` | `{ success: boolean }` | Locks window into frameless kiosk mode. |
| `kiosk:exit` | Renderer -> Main | `void` | `{ success: boolean }` | Releases kiosk mode (only permitted after exam submission). |
| `exam:show-rules` | Renderer -> Main | `void` | `{ accepted: boolean }` | Displays native dialog or confirms rule acceptance. |
| `proctor:save-snapshot`| Renderer -> Main | `{ sessionId: string, dataUrl: string }` | `{ success: boolean, path: string }` | Asynchronously writes candidate snapshot to disk. |
| `proctor:log-event` | Renderer -> Main | `{ sessionId: string, eventType: string, detail: string }` | `{ logged: boolean }` | Logs audit events (blur, tab switch attempt, full screen exit). |
| `exam:sync-time` | Renderer -> Main | `void` | `{ serverEpoch: number }` | Returns current system epoch for drift correction. |
| `app:quit` | Renderer -> Main | `void` | `void` | Gracefully closes application and frees locks. |

---

## 4. Proctoring Subsystem Architecture

### 4.1 Offscreen Snapshot Pipeline
To eliminate UI freezing and avoid the bugs identified in Reference 2, the proctoring pipeline follows this sequence:

```
[Webcam Stream] 
       │ (MediaStreamTrack)
       ▼
[Offscreen Canvas (640x480)] ───► [JPEG DataURL / Blob (quality: 0.6)]
                                                │
                                                ▼ (IPC: proctor:save-snapshot)
                                  [Main Process Async Queue]
                                                │
                                                ▼ (fs.promises.writeFile)
                                  [OS UserData / snapshots / <sessionId> /]
```

### 4.2 Snapshot Optimization Parameters
- **Capture Interval**: Fixed 15–30 second interval with randomized jitter (±3s) to prevent predictable evasion.
- **Image Format**: JPEG format with 60% quality compression (typical size ~25–40 KB per image instead of 500 KB uncompressed PNG).
- **Disk Path Calculation**:
  ```javascript
  const snapshotDir = path.join(app.getPath('userData'), 'snapshots', sessionId);
  await fs.promises.mkdir(snapshotDir, { recursive: true });
  const filename = `snap-${Date.now()}.jpg`;
  await fs.promises.writeFile(path.join(snapshotDir, filename), buffer);
  ```

### 4.3 Hardware Lifecycle & Teardown
- Camera streams must never be orphaned.
- When an exam finishes or the candidate exits:
  ```javascript
  function stopMediaStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      track.stop();
      track.enabled = false;
    });
  }
  ```

---

## 5. Kiosk Security & Anti-Tamper Enforcement

```
+-----------------------------------------------------------------------------------+
|                              KIOSK ENFORCEMENT MATRIX                             |
+------------------------------------+----------------------------------------------+
| Attack Vector                      | Mitigation Strategy                          |
+------------------------------------+----------------------------------------------+
| DevTools Inspection                | webContents.closeDevTools(), disable shortcut|
| Window Switching (Alt+Tab / Cmd+Tab)| setKiosk(true), setAlwaysOnTop(true, 'modal')|
| Window Navigation (Ctrl+R / F5)    | webContents.on('will-navigate', e => e.preventDefault()) |
| Context Menu Right-Click           | window.addEventListener('contextmenu', e => e.preventDefault()) |
| Esc / Kiosk Exit                   | win.on('leave-full-screen', () => win.setKiosk(true)) |
| Focus Loss / Blur                  | win.on('blur', () => recordViolation('BLUR'))|
+------------------------------------+----------------------------------------------+
```

---

## 6. Authoritative Timer & Synchronization Engine

The broken timer implementation in Reference 2 (`Date.now() + 60*60*60`) is replaced with an authoritative epoch-based architecture:

1. **Session Start**:
   When the session is initialized at `/exam/start`, the server or main process returns:
   - `durationMinutes`: e.g., `45`
   - `startedAtEpoch`: e.g., `1790599000000`
   - `deadlineEpoch`: `1790599000000 + (45 * 60 * 1000)`
2. **Local Client Computation**:
   Instead of continuously polling IPC every second, the client computes remaining time locally using `performance.now()` and clock offsets:
   ```javascript
   const remainingMs = Math.max(0, deadlineEpoch - Date.now());
   ```
3. **Auto-Submit Guard**:
   When `remainingMs === 0`, the client automatically locks input, triggers `/exam/submit`, and transitions to the `EXAM_SUBMITTED` view.

---

## 7. Storage Layout & Data Schemas

All local runtime artifacts reside under Electron's dedicated `userData` directory:

```text
<userData>/
├── athena-data/
│   ├── config.json               # System configuration & backend port overrides
│   ├── audit-log.jsonl           # Local security audit events
│   └── sessions/
│       └── <sessionId>.json      # Cached session state for recovery
└── snapshots/
    └── <sessionId>/
        ├── snap-1790600100000.jpg
        └── snap-1790600130000.jpg
```

---

## 8. Network & Port Configuration Management

To resolve the port conflicts between Reference 1 (`6001`) and Reference 2 (`3000`), a unified configuration contract is established:

- **Default Backend Port**: `6001`
- **Environment Override**: `process.env.EXAM_BACKEND_PORT`
- **Client Configuration Contract**:
  ```javascript
  export const API_CONFIG = {
    PORT: import.meta.env.VITE_BACKEND_PORT || 6001,
    get BASE_URL() {
      return `http://localhost:${this.PORT}`;
    }
  };
  ```

---

## 9. Desktop Fullscreen, Kiosk Controls & Operating System Limitations

### 9.1 Desktop Fullscreen and Kiosk Architecture
The application coordinates presentation state using Electron's native `BrowserWindow` APIs:
- **Desktop Fullscreen (`win.setFullScreen(true)`)**: Expands the window to fill the monitor display, hiding OS dock/taskbar chrome where supported.
- **Optional Kiosk Mode (`win.setKiosk(true)`)**: Enforces kiosk presentation during high-stakes testing sessions.
- **State Synchronization (`athena:window:state-changed`)**: Listens to Electron native window events (`enter-full-screen`, `leave-full-screen`, `enter-html-full-screen`, `leave-html-full-screen`) and broadcasts real-time `{ isFullScreen, isKiosk }` state to the renderer context.
- **Safe State Recovery**: On exam submission, cancellation, or unexpected renderer termination (`render-process-gone`), the main process automatically releases kiosk mode and restores normal window dimensions.

### 9.2 Navigation & Shortcut Lockdown Boundary
To prevent candidates from navigating away from the assessment interface:
1. **Window Popup Prevention**: `webContents.setWindowOpenHandler` denies all unexpected popup or external window creation attempts (`action: 'deny'`).
2. **Exact Origin & Path Validation**: `will-navigate` and `will-redirect` reject all targets that do not match the exact Vite dev server origin in development or the exact normalized `dist/index.html` file path in production. Weak string-prefix checks are explicitly avoided.
3. **Application-Level Shortcut Filtering**: `webContents.on('before-input-event')` suppresses page reloads (`Cmd+R`, `Ctrl+R`, `F5`), printing (`Cmd+P`, `Ctrl+P`), source inspection (`Cmd+U`, `Ctrl+U`, `Cmd+S`), and production DevTools chords (`F12`, `Cmd+Alt+I`, `Ctrl+Shift+I`).

### 9.3 Operating System Limitations & Ethical Safety Boundaries
> [!IMPORTANT]
> **Electron Kiosk Mode is NOT an OS-Managed Secure Examination Environment:**
> Electron applications run in standard user space. While `win.setKiosk(true)` provides an effective barrier against casual multitasking, it does NOT provide the operating-system kernel-level lockdown of specialized enterprise solutions (such as Apple Assessment Mode / Automatic Assessment Configuration API on macOS or Assigned Access / Take a Test on Windows).

**Platform-Specific Behavioral Nuances:**
- **macOS**: System-level chords (such as Mission Control gestures, Spaces switching, `Cmd+Tab`, and Apple Menu interactions) cannot be completely blocked by Chromium/Electron without OS accessibility privileges or Apple Assessment Configuration MDM profiles.
- **Windows**: The Secure Attention Sequence (`Ctrl+Alt+Delete`), Windows Key shortcuts, and Task Manager cannot and should not be intercepted by userland Electron processes.
- **Linux**: Behavior varies across Wayland compositors (Mutter, KWin, Sway) and X11 display servers; some window managers allow switching workspaces even while kiosk mode is active.

**Preservation of Emergency Controls:**
In accordance with system safety principles, Athena never interferes with emergency system controls (`Cmd+Q` on macOS, OS task-switching/kill controls on Windows/Linux) or disables operating-system security mechanisms. Machine owners can always safely terminate the process if needed.
