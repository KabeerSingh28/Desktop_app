/**
 * Electron Main Process - Application Lifecycle & Window Management
 *
 * Implements:
 * 1. Single-instance lock to prevent duplicate instances
 * 2. Dedicated createMainWindow() function with show: false and ready-to-show
 * 3. Secure BrowserWindow defaults (nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true)
 * 4. Dual environment loading: Vite development server in development, dist/index.html in production
 * 5. Failure-resilient renderer loading with recovery UI on connection drop
 * 6. Conditional DevTools (development only, prohibited in production)
 * 7. macOS window reactivation (activate) and cross-platform shutdown (window-all-closed)
 * 8. Centralized, non-duplicated IPC handler registration
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');

// Determine execution environment.
// In packaged builds, app.isPackaged is always true.
// In unpacked development, passing --prod or setting NODE_ENV=production forces production mode.
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production' && !process.argv.includes('--prod');

// Keep a global reference to the main window to prevent garbage collection
let mainWindow = null;

// Enforce single-instance lock early before app initialization
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance of the application is already running; exit immediately
  console.log('Another instance of Athena is already running. Exiting...');
  app.quit();
} else {
  // When another instance attempts to launch, bring the primary instance to focus
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Main process entry point
  app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();

    // macOS standard behavior: re-create window when clicking dock icon if no windows open
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }).catch((error) => {
    console.error('Failed to initialize application:', error);
    dialog.showErrorBox('Initialization Error', `Failed to start Athena:\n${error.message}`);
  });
}

/**
 * Creates and configures the primary application window.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    // Prevent the window from appearing until the DOM and initial styles are ready,
    // avoiding the jarring white flash on startup.
    show: false,
    backgroundColor: '#f8fafc', // Matches Tailwind slate-50 background
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,     // Security: Prevent renderer from accessing Node.js runtime directly
      contextIsolation: true,     // Security: Run preload scripts in separate JavaScript context
      sandbox: true,              // Security: Enforce Chromium OS-level process sandboxing
      webSecurity: true           // Security: Enforce same-origin policy and secure protocols
    }
  });

  // Gracefully reveal window only once content is rendered
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Load the appropriate renderer bundle
  loadRenderer(mainWindow);

  // DevTools configuration:
  // Automatically open detached DevTools in development unless explicitly disabled.
  // In production, never expose DevTools to protect candidate session integrity.
  if (isDev) {
    if (process.env.ELECTRON_OPEN_DEVTOOLS !== 'false') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  // Handle renderer load failures gracefully
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // Only intercept top-level document failures
    if (!isMainFrame) return;

    console.error(`Renderer failed to load "${validatedURL}" [${errorCode}]: ${errorDescription}`);

    // If development server is unreachable, render an actionable troubleshooting view
    if (isDev && validatedURL.startsWith('http://localhost:5173')) {
      const errorHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Athena - Connection Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              background: #f8fafc;
              color: #1e293b;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 24px;
              box-sizing: border-box;
            }
            .card {
              background: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 32px;
              max-width: 520px;
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
            }
            .badge {
              display: inline-block;
              background: #fee2e2;
              color: #991b1b;
              padding: 4px 10px;
              border-radius: 9999px;
              font-size: 12px;
              font-weight: 600;
              margin-bottom: 16px;
            }
            h2 { color: #0f172a; margin: 0 0 12px 0; font-size: 20px; }
            p { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 16px 0; }
            code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; font-family: monospace; }
            .btn {
              display: inline-block;
              padding: 10px 20px;
              background: #2563eb;
              color: #ffffff;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 600;
              cursor: pointer;
            }
            .btn:hover { background: #1d4ed8; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">Connection Failed (${errorCode})</div>
            <h2>Vite Dev Server Not Reachable</h2>
            <p>The Electron application was unable to connect to <code>${validatedURL}</code>.</p>
            <p>Please ensure your Vite development server is running in a terminal:</p>
            <p><code>npm run dev</code></p>
            <button class="btn" onclick="window.location.href='${validatedURL}'">Retry Connection</button>
          </div>
        </body>
        </html>
      `;
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
      if (!mainWindow.isVisible()) mainWindow.show();
      return;
    }

    dialog.showErrorBox(
      'Application Load Error',
      `Failed to load application resource (${errorCode}):\n${errorDescription}\n\nPath: ${validatedURL}`
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Loads the renderer into the window depending on environment.
 */
async function loadRenderer(win) {
  if (isDev) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173/';
    try {
      await win.loadURL(devServerUrl);
    } catch (err) {
      console.error(`Failed to load development URL "${devServerUrl}":`, err.message);
    }
  } else {
    const productionPath = path.join(__dirname, '..', 'dist', 'index.html');
    try {
      await win.loadFile(productionPath);
    } catch (err) {
      console.error(`Failed to load production bundle "${productionPath}":`, err.message);
    }
  }
}

/**
 * Registers all IPC event handlers once during initialization.
 * Registering handlers outside createMainWindow prevents listener duplication on window recreation.
 */
function registerIpcHandlers() {
  ipcMain.on('save-event', (event, data) => {
    console.log(data, 'Data Saved');
  });

  ipcMain.on('delete-event', (event, data) => {
    console.log(data, 'Data Deleted');
  });

  ipcMain.on('update-event', (event, data) => {
    console.log(data, 'Data Updated');
  });

  ipcMain.on('create-event', (event, data) => {
    console.log(data, 'Data Created');
  });

  ipcMain.on('set-fullScreen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(true);
    }
  });

  ipcMain.handle('get-data', async (event, data) => {
    return data;
  });

  ipcMain.handle('show-exam-rules', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return -1;
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Exam Rules',
      message: 'Please review and accept the examination rules.',
      detail: '1. Maintain a clean test environment.\n2. Do not switch tabs or external applications.\n3. Keep your camera preview enabled.\n4. Ensure you remain in fullscreen during the examination.',
      buttons: ['Accept', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    });
    return res.response;
  });
}

// Cross-platform quit behavior:
// On macOS (darwin), applications and their menu bar stay active until Cmd + Q.
// On Windows / Linux, closing all windows quits the application.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Guard against unhandled exceptions crashing the process silently
process.on('uncaughtException', (error) => {
  console.error('Unhandled main process exception:', error);
  dialog.showErrorBox('Application Error', `An unexpected error occurred:\n${error.message}`);
});
