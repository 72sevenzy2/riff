const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const NAME = 'Riff';
const COMMENT = 'Riff - music player';
const APP_ID = '';

function winShortcutPath() {
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`);
}

function winDesktopShortcutPath() {
  return path.join(app.getPath('desktop'), `${NAME}.lnk`);
}

function linuxDesktopFolderPath() {
  try { return path.join(app.getPath('desktop'), 'riff.desktop'); } catch (e) { return ''; }
}

function linuxDesktopPath() {
  return path.join(os.homedir(), '.local', 'share', 'applications', 'riff.desktop');
}

function linuxIconPath() {
  return path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', 'riff.png');
}

function getLauncherInfo() {
  if (process.platform === 'win32') {
    if (!app.isPackaged) return { platform: 'win32', canInstall: false, installed: false, reason: 'Available in the installed app' };
    return { platform: 'win32', canInstall: true, installed: fs.existsSync(winShortcutPath()) && fs.existsSync(winDesktopShortcutPath()), reason: '' };
  }
  if (process.platform === 'linux') {
    if (!process.env.APPIMAGE) return { platform: 'linux', canInstall: false, installed: false, reason: 'Available when Riff runs as an AppImage' };
    return { platform: 'linux', canInstall: true, installed: fs.existsSync(linuxDesktopPath()), reason: '' };
  }
  return { platform: process.platform, canInstall: false, installed: false, reason: 'Not supported on this system' };
}

function writeWinShortcut(lnk, target) {
  fs.mkdirSync(path.dirname(lnk), { recursive: true });
  const options = { target, cwd: path.dirname(target), description: COMMENT, icon: target, iconIndex: 0 };
  if (APP_ID) options.appUserModelId = APP_ID;
  const operation = fs.existsSync(lnk) ? 'replace' : 'create';
  if (!shell.writeShortcutLink(lnk, operation, options)) {
    throw new Error(`could not write ${lnk}`);
  }
}

function installWindows() {
  const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const errors = [];
  let written = 0;
  for (const lnk of [winShortcutPath(), winDesktopShortcutPath()]) {
    try {
      writeWinShortcut(lnk, target);
      written++;
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  if (!written) return { ok: false, error: errors.join('; ') };
  return { ok: true, error: errors.join('; ') };
}

function quoteExec(file) {
  return '"' + file.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%') + '"';
}

function installLinux() {
  const image = process.env.APPIMAGE;
  if (!image) return { ok: false, error: 'Riff is not running as an AppImage' };
  try { fs.chmodSync(image, 0o755); } catch (e) {}
  const desktop = linuxDesktopPath();
  const iconDest = linuxIconPath();
  let icon = 'audio-x-generic';
  try {
    fs.mkdirSync(path.dirname(iconDest), { recursive: true });
    fs.writeFileSync(iconDest, fs.readFileSync(path.join(__dirname, '../../assets', 'icon.png')));
    icon = iconDest;
  } catch (e) {}
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${NAME}`,
    'GenericName=Music Player',
    `Comment=${COMMENT}`,
    `Exec=${quoteExec(image)} %U`,
    `TryExec=${image}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=AudioVideo;Audio;Player;Music;',
    `StartupWMClass=${app.getName()}`,
    'StartupNotify=true',
    ''
  ];
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  fs.writeFileSync(desktop, lines.join('\n'));
  fs.chmodSync(desktop, 0o755);
  const onDesktop = linuxDesktopFolderPath();
  if (onDesktop) {
    try {
      fs.mkdirSync(path.dirname(onDesktop), { recursive: true });
      fs.copyFileSync(desktop, onDesktop);
      fs.chmodSync(onDesktop, 0o755);
    } catch (e) {}
  }
  execFile('update-desktop-database', [path.dirname(desktop)], () => {});
  return { ok: true };
}

function refreshLauncherOnStartup() {
  if (process.platform === 'linux') {
    if (fs.existsSync(linuxDesktopPath())) {
      try {
        installLinux();
      } catch (e) {
        console.warn('[launcher] Failed to refresh linux launcher:', e.message);
      }
    }
  }
}

function installLauncher() {
  let result;
  try {
    const info = getLauncherInfo();
    if (!info.canInstall) {
      result = { ok: false, error: info.reason || 'Not supported on this system' };
    } else if (process.platform === 'win32') {
      result = installWindows();
    } else {
      result = installLinux();
    }
  } catch (e) {
    result = { ok: false, error: e && e.message ? e.message : String(e) };
  }
  return { ok: !!result.ok, success: !!result.ok, error: result.error || '' };
}

module.exports = { getLauncherInfo, installLauncher, refreshLauncherOnStartup };
