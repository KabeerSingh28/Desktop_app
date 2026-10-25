/**
 * Backend Configuration
 *
 * Centralized settings for server port, persistence directory, and defaults.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  // Configurable port: checks PORT or EXAM_BACKEND_PORT, defaulting to 6001
  port: Number(process.env.PORT || process.env.EXAM_BACKEND_PORT || 6001),

  // Configurable data storage directory (can be overridden in tests via DATA_DIR)
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),

  // Default MCQ questions used for initialization or fallback recovery
  defaultQuestions: [
    {
      id: 1,
      question: "Which Electron process is responsible for creating BrowserWindow?",
      options: [
        "Renderer Process",
        "Main Process",
        "React Process",
        "Preload Process"
      ],
      correctAnswer: 1
    },
    {
      id: 2,
      question: "Which Electron API is commonly used in the renderer to invoke a handler in the main process?",
      options: [
        "ipcRenderer.invoke",
        "BrowserWindow.loadURL",
        "fs.writeFileSync",
        "dialog.showMessageBox"
      ],
      correctAnswer: 0
    },
    {
      id: 3,
      question: "Why is a preload script commonly used in Electron?",
      options: [
        "To style the React application",
        "To expose controlled APIs safely to the renderer",
        "To create the Express server",
        "To replace the main process"
      ],
      correctAnswer: 1
    },
    {
      id: 4,
      question: "Which HTTP method is normally used to fetch exam questions?",
      options: [
        "GET",
        "DELETE",
        "PATCH",
        "CONNECT"
      ],
      correctAnswer: 0
    },
    {
      id: 5,
      question: "What does fs.writeFileSync() do?",
      options: [
        "Reads camera frames",
        "Writes data to a file and waits until it finishes",
        "Starts the Electron renderer",
        "Sends an IPC event"
      ],
      correctAnswer: 1
    }
  ]
};
