const { app, BrowserWindow, ipcMain, Menu, dialog, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5180/";
let mainWindow = null;
let getDb;
let getDbPath;
let ensureSeed;
let auth;
let queries;
let upload;
let backup;
let maintenance;
let stockTxn;
let audit;

console.log("Electron starting... foreground-fix-v2", { isDev, devUrl: DEV_SERVER_URL });

function loadBackendModules() {
  console.log("loading backend modules");
  const sqlite = require("./db/sqlite.cjs");
  getDb = sqlite.getDb;
  getDbPath = sqlite.getDbPath;
  ensureSeed = require("./db/seed.cjs").ensureSeed;
  auth = require("./ipc/auth.cjs");
  queries = require("./ipc/queries.cjs");
  upload = require("./ipc/upload.cjs");
  backup = require("./ipc/backup.cjs");
  maintenance = require("./ipc/maintenance.cjs");
  stockTxn = require("./ipc/stockTransactions.cjs");
  audit = require("./ipc/audit.cjs");
}

function createWindow() {
  console.log("creating BrowserWindow");
  const preloadPath = path.join(__dirname, "preload.cjs");
  console.log("preload path:", preloadPath, "exists:", fs.existsSync(preloadPath));
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: "دواء - إدارة أرصدة المستشفى",
    show: true,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const showWindow = (reason) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    console.log(reason, {
      visible: mainWindow.isVisible(),
      minimized: mainWindow.isMinimized(),
      focused: mainWindow.isFocused(),
      bounds: mainWindow.getBounds(),
    });

    const { workArea } = screen.getPrimaryDisplay();
    mainWindow.setBounds({
      x: workArea.x + 20,
      y: workArea.y + 20,
      width: Math.min(1280, Math.max(900, workArea.width - 40)),
      height: Math.min(800, Math.max(650, workArea.height - 40)),
    });
    mainWindow.setSkipTaskbar(false);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.focus();
    try {
      app.focus({ steal: true });
    } catch (_) {}
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false);
    }, 3000);
  };
  let loadFailureReported = false;

  mainWindow.once("ready-to-show", () => showWindow("window ready-to-show"));
  showWindow("window shown immediately");
  setTimeout(() => showWindow("foreground retry after 1s"), 1000);
  setTimeout(() => showWindow("foreground retry after 3s"), 3000);
  setTimeout(() => showWindow("foreground retry after 5s"), 5000);

  mainWindow.webContents.on("dom-ready", () => {
    console.log("renderer dom-ready");
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("renderer did-finish-load:", mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("renderer console-message", { level, message, line, sourceId });
  });

  // Retry loading in dev if Vite isn't ready yet, and surface load failures.
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (code === -3) return; // aborted (normal during navigation)
    console.error("did-fail-load error details", { code, desc, url });
    if (isMainFrame !== false && !loadFailureReported) {
      loadFailureReported = true;
      dialog.showErrorBox(
        "تعذّر تحميل واجهة البرنامج",
        `فشل تحميل الرابط:\n${url || DEV_SERVER_URL}\n\nالكود: ${code}\nالسبب: ${desc}`
      );
    }
    if (isDev) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log("retrying dev URL:", DEV_SERVER_URL);
          mainWindow.loadURL(DEV_SERVER_URL).catch((e) => {
            console.error("retry loadURL failed:", e);
          });
        }
      }, 1000);
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("renderer-process-crashed details", details);
  });

  mainWindow.webContents.on("preload-error", (_event, preload, error) => {
    console.error("preload-error details", { preload, error });
  });

  if (typeof mainWindow.webContents.on === "function") {
    mainWindow.webContents.on("crashed", () => {
      console.error("renderer webContents crashed");
    });
  }

  if (isDev) {
    console.log("loading dev URL:", DEV_SERVER_URL);
    mainWindow.loadURL(DEV_SERVER_URL).catch((e) => {
      console.error("loadURL failed:", e);
    });
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    console.log("loading production file:", indexPath);
    mainWindow.loadFile(indexPath).catch((e) => {
      console.error("loadFile failed:", e);
    });
  }
}

function registerIpc() {
  ipcMain.handle("auth:login", (_e, a) => auth.login(a));
  ipcMain.handle("auth:logout", (_e, a) => auth.logout(a));
  ipcMain.handle("auth:me", (_e, a) => auth.getCurrentUser(a));
  ipcMain.handle("auth:changePassword", (_e, a) => auth.changePassword(a));
  ipcMain.handle("auth:listUsers", (_e, a) => auth.listUsers(a));
  ipcMain.handle("auth:createUser", (_e, a) => auth.createUser(a));
  ipcMain.handle("auth:setUserActive", (_e, a) => auth.setUserActive(a));

  ipcMain.handle("queries:latestBatch", (_e, a) => queries.getLatestSavedBatch(a));
  ipcMain.handle("queries:listBatches", (_e, a) => queries.listBatches(a));
  ipcMain.handle("queries:movementsByBatch", (_e, a) => queries.getMovementsByBatch(a));
  ipcMain.handle("queries:listBatchesContinuous", (_e, a) => queries.listBatchesContinuous(a));
  ipcMain.handle("queries:movementsByBatchIds", (_e, a) => queries.getMovementsByBatchIds(a));
  ipcMain.handle("queries:listLocations", (_e, a) => queries.listLocations(a));
  ipcMain.handle("queries:getSettings", () => queries.getSettings());
  ipcMain.handle("queries:setSetting", (_e, a) => queries.setSetting(a));

  ipcMain.handle("upload:parseExcel", (_e, a) => upload.parseExcel(a));
  ipcMain.handle("upload:saveBatch", (_e, a) => upload.saveBatch(a));

  ipcMain.handle("backup:export", (_e, a) => backup.exportBackup(a));
  ipcMain.handle("backup:restore", (_e, a) => backup.restoreBackup(a));

  ipcMain.handle("maintenance:wipeAll", (_e, a) => maintenance.wipeAllData(a));

  ipcMain.handle("stockTxn:list", (_e, a) => stockTxn.list(a));
  ipcMain.handle("stockTxn:insert", (_e, a) => stockTxn.insert(a));
  ipcMain.handle("stockTxn:delete", (_e, a) => stockTxn.remove(a));

  ipcMain.handle("audit:insert", (_e, a) => audit.insert(a));
  ipcMain.handle("audit:list", (_e, a) => audit.list(a));

  ipcMain.handle("app:version", () => ({ ok: true, version: app.getVersion() }));
  ipcMain.handle("app:dbPath", () => ({ ok: true, path: getDbPath() }));
}

app.whenReady().then(() => {
  console.log("app ready");
  Menu.setApplicationMenu(null);

  // Initialise the database first; if the native module or schema fails,
  // show the real error instead of leaving the app running with no window.
  try {
    loadBackendModules();
    getDb();
    ensureSeed();
    backup.autoWeeklyBackup();
  } catch (e) {
    console.error("Startup DB init failed:", e);
    dialog.showErrorBox(
      "خطأ في بدء التشغيل",
      "تعذّر تهيئة قاعدة البيانات.\n\n" +
        (e && e.message ? e.message : String(e)) +
        "\n\nجرّب تشغيل: npx electron-rebuild داخل مجلد desktop"
    );
    app.quit();
    return;
  }

  console.log("registering IPC handlers");
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error("app.whenReady failed:", err);
  try {
    dialog.showErrorBox("خطأ في بدء التشغيل", err && err.message ? err.message : String(err));
  } catch (_) {}
  app.quit();
});

// Catch any other uncaught errors in the main process so they are visible.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  try {
    dialog.showErrorBox("خطأ غير متوقع", err && err.message ? err.message : String(err));
  } catch (_) {}
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
  try {
    dialog.showErrorBox(
      "خطأ غير متوقع",
      reason && reason.message ? reason.message : String(reason)
    );
  } catch (_) {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
