// Desktop shell for PetBrace Studio. Serves the Vite build from dist/ over a
// privileged app:// scheme so the module web worker loads like on the web.
const { app, BrowserWindow, Menu, nativeTheme, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PetBrace Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0d12' : '#f4f6f9',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // The work order opens in a child window; external links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === '' || url === 'about:blank') return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://petbrace/index.html');
  if (process.env.PETBRACE_SMOKE) runSmokeTest(win);
}

/** `PETBRACE_SMOKE=1 electron .` loads a demo limb, waits for the brace and exits 0 on success. */
function runSmokeTest(win) {
  const timer = setTimeout(() => { console.log('SMOKE: timeout'); app.exit(1); }, 60000);
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('SMOKE: load failed', code, desc));
  win.webContents.once('did-finish-load', async () => {
    const script = `new Promise((resolve) => {
      const btn = document.querySelector('[data-demo]');
      if (!btn) return resolve('no UI: ' + document.body.innerText.slice(0, 200));
      btn.click();
      const t0 = Date.now();
      const tick = () => {
        const s = document.querySelector('.status-msg').textContent;
        if (/generated|failed/.test(s) || Date.now() - t0 > 30000) resolve(document.title + ' | ' + s);
        else setTimeout(tick, 200);
      };
      tick();
    })`;
    const result = await win.webContents.executeJavaScript(script).catch((e) => 'error: ' + e.message);
    clearTimeout(timer);
    console.log('SMOKE:', result);
    app.exit(/generated/.test(result) ? 0 : 1);
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
