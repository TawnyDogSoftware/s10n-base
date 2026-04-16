import childProcess from "node:child_process";
import path from "node:path";

import { app, BrowserWindow } from "electron";

const SERVER_URL = process.env.S10N_BASE_SERVER_URL?.trim() || "http://127.0.0.1:4210";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL?.trim() || "http://127.0.0.1:5173";

let mainWindow: BrowserWindow | null = null;
let serverProcess: childProcess.ChildProcess | null = null;

function isDevelopment() {
  return !app.isPackaged;
}

function serverEntrypoint() {
  return path.resolve(__dirname, "../../server/dist/bin.mjs");
}

async function waitForHealthcheck(url: string, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}/health`);
}

async function ensureServer() {
  if (isDevelopment()) {
    await waitForHealthcheck(SERVER_URL);
    return;
  }

  serverProcess = childProcess.spawn(process.execPath, [serverEntrypoint()], {
    stdio: "inherit",
    env: {
      ...process.env,
      S10N_BASE_PORT: new URL(SERVER_URL).port,
      HOST: new URL(SERVER_URL).hostname,
    },
  });

  await waitForHealthcheck(SERVER_URL);
}

async function createWindow() {
  await ensureServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "S10N Base",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(isDevelopment() ? DEV_SERVER_URL : SERVER_URL);
}

app.whenReady().then(() => {
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  serverProcess?.kill();
});
