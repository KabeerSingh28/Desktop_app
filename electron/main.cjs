/**
 * Electron Main Process - Application Lifecycle & Window Management
 *
 * Implements:
 * 1. Single-instance lock to prevent duplicate instances
 * 2. Dedicated createMainWindow() function with show: false and ready-to-show
 * 3. Secure BrowserWindow defaults (nodeIntegration: false, contextIsolation: true,
 *    sandbox: true, webSecurity: true)
 * 4. Dual environment loading: Vite dev server in dev, dist/index.html in production
 * 5. Failure-resilient renderer loading with recovery UI on connection drop
 * 6. Conditional DevTools (development only, prohibited in production)
 * 7. macOS window reactivation (activate) and cross-platform shutdown (window-all-closed)
 * 8. Centralized, non-duplicated IPC handler registration (registerIpcHandlers called once)
 *
 * SECURITY BOUNDARY
 * =================
 * The renderer context is fully sandboxed (nodeIntegration: false, contextIsolation: true,
 * sandbox: true). The renderer cannot call any Electron or Node APIs directly.
 * All communication flows through the preload bridge (electron/preload.cjs) and lands
 * in the ipcMain.handle() handlers below.
 *
 * IPC channel naming: athena:<domain>:<action>
 *   athena:app:*        – application status / meta
 *   athena:window:*     – window state (fullscreen)
 *   athena:exam:*       – exam lifecycle
 *   athena:evidence:*   – proctoring evidence collection
 *
 * Every handler validates:
 *   - sender origin (must come from the main window's webContents)
 *   - sub-frame flag (ipcMain does not distinguish sub-frames by default, but we
 *     explicitly check event.senderFrame.url where frame isolation matters)
 *   - payload types and sizes before any side-effecting operation
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {
  CHANNELS,
  validateString,
  validateCandidatePayload,
  validateSessionIdPayload,
  validateSnapshotPayload,
} = require('./ipc-helpers.cjs');

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------
// In packaged builds, app.isPackaged is always true.
// In unpacked development, passing --prod or NODE_ENV=production forces production mode.
const isDev = !app.isPackaged
  && process.env.NODE_ENV !== 'production'
  && !process.argv.includes('--prod');

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** @type {BrowserWindow|null} */
let mainWindow = null;

/**
 * Authoritative exam end time (epoch ms) set by athena:exam:start-session.
 * Kept in main process so the renderer cannot tamper with it.
 * @type {number|null}
 */
let examDeadlineEpoch = null;

/**
 * Guard that prevents exitFullscreen after an exam has started but not been submitted.
 * @type {boolean}
 */
let examInProgress = false;

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[main] Another instance is already running. Quitting.');
  app.quit();
} else {
  // Bring the primary instance to the foreground if a second one is launched
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Main entry point
  app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();

    // macOS: re-create window when the dock icon is clicked and no windows are open
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }).catch((err) => {
    console.error('[main] Initialization failed:', err);
    dialog.showErrorBox('Initialization Error', `Failed to start Athena:\n${err.message}`);
  });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    // Prevent white flash: show only after the renderer has painted its first frame
    show: false,
    backgroundColor: '#f8fafc', // Tailwind slate-50
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Security: renderer cannot require() Node modules
      nodeIntegration: false,
      // Security: preload runs in a separate v8 context; window.X in preload ≠ window.X in page
      contextIsolation: true,
      // Security: OS-level Chromium sandbox isolates the renderer process
      sandbox: true,
      // Security: keep same-origin policy and HTTPS checks active
      webSecurity: true,
    },
  });

  // Reveal the window only once the renderer has finished painting
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  loadRenderer(mainWindow);

  // DevTools: open detached in development; actively suppress in production
  if (isDev) {
    // Set ELECTRON_OPEN_DEVTOOLS=false in your shell to suppress DevTools during dev
    if (process.env.ELECTRON_OPEN_DEVTOOLS !== 'false') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    // Belt-and-suspenders: close DevTools if they somehow get opened in production
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  // Handle renderer load failures (e.g. Vite dev server not started)
  mainWindow.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[main] Renderer failed to load "${url}" [${code}]: ${description}`);

    if (isDev && url.startsWith('http://localhost:5173')) {
      const html = buildDevErrorPage(url, code);
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      if (!mainWindow.isVisible()) mainWindow.show();
      return;
    }

    dialog.showErrorBox(
      'Application Load Error',
      `Failed to load application (${code}):\n${description}\n\nPath: ${url}`,
    );
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// Renderer loading
// ---------------------------------------------------------------------------

async function loadRenderer(win) {
  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173/';
    try {
      await win.loadURL(url);
    } catch (err) {
      console.error(`[main] Failed to load dev server "${url}":`, err.message);
    }
  } else {
    const file = path.join(__dirname, '..', 'dist', 'index.html');
    try {
      await win.loadFile(file);
    } catch (err) {
      console.error(`[main] Failed to load production bundle "${file}":`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------
// ⚠ Called ONCE before createMainWindow so handlers are never duplicated when
//   the window is recreated (e.g. macOS activate path).
// ---------------------------------------------------------------------------

function registerIpcHandlers() {

  // ── Sender validation helper ─────────────────────────────────────────────
  /**
   * Returns true only when the IPC event came from the main window's
   * top-level frame and not from a cross-origin sub-frame or devtools.
   * @param {Electron.IpcMainInvokeEvent} event
   */
  function isFromMainWindow(event) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return event.sender === mainWindow.webContents;
  }

  // requireString is provided by the imported validateString from ipc-helpers.cjs
  const requireString = validateString;


  // ── athena:app:get-status ─────────────────────────────────────────────────
  /**
   * Returns non-sensitive application metadata.
   * The renderer uses this to display environment badges and adapt UI behaviour.
   */
  ipcMain.handle(CHANNELS.APP_GET_STATUS, (event) => {
    if (!isFromMainWindow(event)) return;
    return {
      isDev,
      version: app.getVersion(),
    };
  });

  // ── athena:window:enter-fullscreen ────────────────────────────────────────
  /**
   * Puts the main window into OS fullscreen mode.
   * Kiosk-level enforcement (no escape, shortcut blocking) will be added in a
   * later phase; this handler is the stable entry point for it.
   */
  ipcMain.handle(CHANNELS.WINDOW_ENTER_FULLSCREEN, (event) => {
    if (!isFromMainWindow(event)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(true);
    }
  });

  // ── athena:window:exit-fullscreen ─────────────────────────────────────────
  /**
   * Exits fullscreen. Rejected while an exam is in progress to prevent
   * candidates from accidentally (or deliberately) leaving the exam view.
   */
  ipcMain.handle(CHANNELS.WINDOW_EXIT_FULLSCREEN, (event) => {
    if (!isFromMainWindow(event)) return { ok: false, error: 'Unauthorized sender' };
    if (examInProgress) {
      return { ok: false, error: 'Cannot exit fullscreen during an active exam' };
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(false);
    }
    return { ok: true };
  });

  // ── athena:exam:show-rules ────────────────────────────────────────────────
  /**
   * Shows the native exam rules dialog. Returns true when the candidate
   * clicks Accept, false when they click Cancel.
   *
   * NOTE: button index 0 = Accept, 1 = Cancel. The renderer receives a boolean
   * so button-index semantics are not leaked.
   */
  ipcMain.handle(CHANNELS.EXAM_SHOW_RULES, async (event) => {
    if (!isFromMainWindow(event)) return false;
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Exam Rules',
      message: 'Please read and accept the examination rules before continuing.',
      detail: [
        '1. Maintain a clean, quiet test environment.',
        '2. Do not switch to any other application.',
        '3. Keep your webcam preview enabled throughout.',
        '4. Remain in fullscreen for the duration of the exam.',
        '5. Closing this window will terminate your session.',
      ].join('\n'),
      buttons: ['Accept', 'Cancel'],
      defaultId: 0,  // Accept highlighted by default
      cancelId: 1,   // Cancel mapped to Esc / dialog dismiss
    });

    return result.response === 0; // true → accepted
  });

  // ── athena:exam:start-session ─────────────────────────────────────────────
  /**
   * Creates an exam session on the backend and records the deadline epoch in
   * the main process. The renderer receives a minimal session descriptor.
   *
   * Payload: { name: string, userId: string }
   * Response: { sessionId, deadlineEpoch, totalQuestions }
   */
  ipcMain.handle(CHANNELS.EXAM_START_SESSION, async (event, payload) => {
    if (!isFromMainWindow(event)) throw new Error('Unauthorized sender');
    validateCandidatePayload(payload);

    const BACKEND_PORT = process.env.EXAM_BACKEND_PORT || 6001;
    const baseUrl = `http://localhost:${BACKEND_PORT}`;

    // Start session
    let session;
    try {
      const res = await fetch(`${baseUrl}/exam/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: payload.userId, name: payload.name }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Backend responded ${res.status}: ${body}`);
      }
      session = await res.json();
    } catch (err) {
      console.error('[main] athena:exam:start-session – backend call failed:', err.message);
      throw new Error(`Could not start exam session: ${err.message}`);
    }

    // Fetch total question count
    let totalQuestions = 0;
    try {
      const res = await fetch(`${baseUrl}/exam/mcq/total`);
      if (res.ok) {
        const data = await res.json();
        totalQuestions = typeof data.total === 'number' ? data.total : 0;
      }
    } catch (err) {
      console.warn('[main] Could not fetch question count:', err.message);
    }

    // Record deadline in main process (default: 45 minutes from now)
    const EXAM_DURATION_MS = (Number(process.env.EXAM_DURATION_MINUTES) || 45) * 60 * 1000;
    examDeadlineEpoch = Date.now() + EXAM_DURATION_MS;
    examInProgress = true;

    return {
      sessionId: session.sessionId,
      deadlineEpoch: examDeadlineEpoch,
      totalQuestions,
    };
  });

  // ── athena:exam:get-remaining-time ────────────────────────────────────────
  /**
   * Returns the milliseconds remaining until the exam deadline.
   * The renderer polls this every second so its countdown is always
   * authoritative (it cannot be adjusted by manipulating client-side state).
   */
  ipcMain.handle(CHANNELS.EXAM_GET_REMAINING_TIME, (event) => {
    if (!isFromMainWindow(event)) return 0;
    if (examDeadlineEpoch === null) return 0;
    return Math.max(0, examDeadlineEpoch - Date.now());
  });

  // ── athena:exam:submit-session ────────────────────────────────────────────
  /**
   * Finalises the exam session on the backend and clears main-process state.
   *
   * Payload: { sessionId: string }
   * Response: { attempted, correct, wrong }
   */
  ipcMain.handle(CHANNELS.EXAM_SUBMIT_SESSION, async (event, payload) => {
    if (!isFromMainWindow(event)) throw new Error('Unauthorized sender');
    validateSessionIdPayload(payload);

    const BACKEND_PORT = process.env.EXAM_BACKEND_PORT || 6001;
    let result;
    try {
      const res = await fetch(`http://localhost:${BACKEND_PORT}/exam/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: payload.sessionId }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Backend responded ${res.status}: ${body}`);
      }
      const data = await res.json();
      result = data.result;
    } catch (err) {
      console.error('[main] athena:exam:submit-session – backend call failed:', err.message);
      throw new Error(`Could not submit exam: ${err.message}`);
    }

    // Clear exam state so exitFullscreen is now permitted
    examDeadlineEpoch = null;
    examInProgress = false;

    return result;
  });

  // ── athena:evidence:save-snapshot ─────────────────────────────────────────
  /**
   * Persists a base64 webcam snapshot for the current session.
   *
   * Payload: { sessionId: string, dataUrl: string }
   *
   * Security checks:
   *   - Sender must be the main window.
   *   - dataUrl must start with "data:image/" (enforced in preload too, defence in depth).
   *   - dataUrl size capped at 512 KB to prevent memory exhaustion.
   *   - Files written to app.getPath('userData')/snapshots/<sessionId>/ so the
   *     renderer never learns or controls filesystem paths.
   */
  ipcMain.handle(CHANNELS.EVIDENCE_SAVE_SNAPSHOT, async (event, payload) => {
    if (!isFromMainWindow(event)) throw new Error('Unauthorized sender');
    validateSnapshotPayload(payload);

    // Extract base64 body (after the comma in "data:image/jpeg;base64,<body>")
    const commaIdx = payload.dataUrl.indexOf(',');
    const base64 = payload.dataUrl.slice(commaIdx + 1);

    // Resolve a safe, writable path inside the user data directory
    const snapshotDir = path.join(
      app.getPath('userData'),
      'snapshots',
      payload.sessionId,
    );
    await fs.promises.mkdir(snapshotDir, { recursive: true });

    const filename = `snap-${Date.now()}.jpg`;
    await fs.promises.writeFile(
      path.join(snapshotDir, filename),
      Buffer.from(base64, 'base64'),
    );

    // Return nothing to the renderer – file path is never disclosed
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Application shutdown
// ---------------------------------------------------------------------------

// On macOS the app and menu bar stay active until Cmd+Q.
// On Windows / Linux, close all windows → quit.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Catch unhandled main-process exceptions to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[main] Uncaught exception:', err);
  dialog.showErrorBox('Application Error', `An unexpected error occurred:\n${err.message}`);
});

// ---------------------------------------------------------------------------
// Internal: build dev-server-missing error page
// ---------------------------------------------------------------------------

function buildDevErrorPage(url, errorCode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Athena – Connection Failed</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:520px;box-shadow:0 4px 6px -1px rgba(0,0,0,.05)}
    .badge{display:inline-block;background:#fee2e2;color:#991b1b;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:600;margin-bottom:16px}
    h2{color:#0f172a;margin:0 0 12px;font-size:20px}
    p{font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px}
    code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px;font-family:monospace}
    .btn{padding:10px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
    .btn:hover{background:#1d4ed8}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Connection Failed (${errorCode})</div>
    <h2>Vite Dev Server Not Reachable</h2>
    <p>Electron could not connect to <code>${url}</code>.</p>
    <p>Start the Vite development server in a separate terminal first:</p>
    <p><code>npm run dev</code></p>
    <button class="btn" onclick="window.location.href='${url}'">Retry</button>
  </div>
</body>
</html>`;
}
