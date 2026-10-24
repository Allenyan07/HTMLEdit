const ICON_STATES = {
  DEFAULT: {
    16: 'icons/icon_default_16.png',
    32: 'icons/icon_default_32.png',
    48: 'icons/icon_default_48.png',
    128: 'icons/icon_default.png'
  },
  INACTIVE: {
    16: 'icons/icon_inactive_16.png',
    32: 'icons/icon_inactive_32.png',
    48: 'icons/icon_inactive_48.png',
    128: 'icons/icon_inactive.png'
  },
  ACTIVE: {
    16: 'icons/icon_active_16.png',
    32: 'icons/icon_active_32.png',
    48: 'icons/icon_active_48.png',
    128: 'icons/icon_active.png'
  },
  EDIT: {
    16: 'icons/icon_edit_16.png',
    32: 'icons/icon_edit_32.png',
    48: 'icons/icon_edit_48.png',
    128: 'icons/icon_edit.png'
  },
  ANNOTATE: {
    16: 'icons/icon_active_16.png',
    32: 'icons/icon_active_32.png',
    48: 'icons/icon_active_48.png',
    128: 'icons/icon_active.png'
  }
};

const CONTENT_SCRIPTS = [
  'content/storage.js',
  'content/selector.js',
  'content/messaging.js',
  'content/area-selector.js',
  'content/annotator.js',
  'content/raw-patch.js',
  'content/editor.js',
  'content/panel.js',
  'content/hud.js',
  'content/content.js'
];

const CONTENT_CSS = ['content/content.css'];
const FILE_OPERATION_TIMEOUT_MS = 20000;

const tabStates = {};

function getStorageKey(tabId) {
  return 'proto_mode_' + tabId;
}

// 读取某个 tab 的模式状态：内存优先，缺失时从 storage 捞回来并回填。
// service worker 空闲 30 秒会被回收，tabStates 随之清空；所有读状态的地方
// 都必须走这里，否则会出现「页面已恢复模式、图标却停在 DEFAULT」的不一致。
function getTabState(tabId) {
  if (!tabId) return Promise.resolve(null);
  if (tabStates[tabId]) return Promise.resolve(tabStates[tabId]);

  var key = getStorageKey(tabId);
  return new Promise(function(resolve) {
    chrome.storage.local.get([key], function(result) {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      var data = result && result[key];
      if (data) tabStates[tabId] = data;
      resolve(data || null);
    });
  });
}

// 把「某个 tab 切到某模式」收成唯一实现：消息路径、chrome.commands 路径、
// 授权完成后的自动接管，三条路径都调它，避免行为分叉。
// mode: 'paused' | 'edit' | 'annotate'
// 每次「切模式」意图的单调序号。applyMode 是异步的（要先取状态、必要时注入脚本），
// 期间可能又来一次按键。没有序号时，两次按键都会基于旧值算 next，且谁最后 resolve
// 谁覆盖——用户最后按的方向会被前一次吃掉。序号让过期请求直接作废。
var modeSeq = {};

function applyMode(tabId, mode, topLevelUrl, seq) {
  var normalized = (mode === 'edit' || mode === 'annotate') ? mode : 'paused';
  var active = normalized !== 'paused';

  if (!tabId) {
    return Promise.resolve({ success: false, error: { code: 'NO_TAB' } });
  }

  // 没带序号（例如弹窗/胶囊发来的 SET_MODE）就自己领一个最新的，
  // 这样它同样能作废掉更早、还没落地的快捷键请求。
  if (seq === undefined || seq === null) {
    modeSeq[tabId] = (modeSeq[tabId] || 0) + 1;
    seq = modeSeq[tabId];
  }
  var isStale = function() { return seq !== modeSeq[tabId]; };
  var SUPERSEDED = { success: false, error: { code: 'SUPERSEDED', message: '被更新的一次切换取代' } };

  // 必须先取「带持久化兜底」的旧状态：service worker 被回收后 tabStates 是空的，
  // 直接读内存会把 editCount 当成 0 写回存储（用户已改 N 处会平白清零）。
  return getTabState(tabId).then(function(prev) {
    if (isStale()) return SUPERSEDED;
    var prevCount = (prev && prev.editCount) || 0;
    var url = topLevelUrl || (prev && prev.topLevelUrl) || '';

    if (!active) {
      tabStates[tabId] = { active: false, mode: 'paused', topLevelUrl: url, editCount: prevCount };
      setIconState(tabId, getIconStateForMode(normalized));
      persistTabState(tabId);
      sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: false, mode: 'paused' });
      return { success: true };
    }

    return ensureContentScriptsInjected(tabId).then(function(injected) {
      // 注入是这条链里最慢的一步，回来时必须再确认一次没被新按键取代
      if (isStale()) return SUPERSEDED;
      if (!injected) {
        return {
          success: false,
          error: {
            code: 'INJECTION_FAILED',
            message: 'Could not inject content scripts into the current page'
          }
        };
      }
      tabStates[tabId] = { active: true, mode: normalized, topLevelUrl: url, editCount: prevCount };
      setIconState(tabId, getIconStateForMode(normalized));
      persistTabState(tabId);
      sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: true, mode: normalized });
      return { success: true };
    });
  });
}

function persistTabState(tabId) {
  if (!tabId || !tabStates[tabId]) return;
  var payload = {};
  payload[getStorageKey(tabId)] = tabStates[tabId];
  chrome.storage.local.set(payload);
}

// 编辑就绪体检：三查。任一不通过都返回具体原因与补救动作。
// remedy: 'confirm'（重新确认权限）/ 'choose'（重选目录）/ null（已就绪）
function getEditReadiness(fileUrl) {
  return getEditDirectoryData().then(function(data) {
    var dirName = (data && (data.name || (data.handle && data.handle.name))) || '';
    if (!data || !data.handle) {
      return { ready: false, code: 'NO_DIRECTORY', remedy: 'choose', directoryName: '' };
    }
    return queryEditPermission(data.handle).then(function(permission) {
      if (permission !== 'granted') {
        return {
          ready: false,
          code: permission === 'prompt' ? 'PERMISSION_PROMPT_REQUIRED' : 'PERMISSION_DENIED',
          remedy: 'confirm',
          directoryName: dirName
        };
      }
      if (!hasRootPathSegments(data)) {
        return { ready: false, code: 'DIRECTORY_REAUTH_REQUIRED', remedy: 'choose', directoryName: dirName };
      }
      var segments = getPathSegments(fileUrl);
      if (!fileUrl || !segments.length || !startsWithSegments(segments, data.rootPathSegments)) {
        return { ready: false, code: 'OUTSIDE_DIRECTORY', remedy: 'choose', directoryName: dirName };
      }
      return { ready: true, code: 'READY', remedy: null, directoryName: dirName };
    });
  });
}

// content script 的隔离世界里没有 chrome.commands（实测 keys 只有
// dom/extension/i18n/runtime/storage），所以键位必须由 background 代读回传，
// 否则胶囊上永远显示「未分配快捷键」——而实际上命令是分配成功的。
// 键位显示要按平台走：macOS 习惯用符号且不加加号（⌥Q / ⇧⌘Y），
// Windows/Linux 习惯用 Ctrl/Alt/Shift 这样的英文名（Alt+Q / Ctrl+Shift+Y）。
// 不能一律套 mac 符号——那会让 Windows 用户看到「⌃Q」而不是「Ctrl+Q」。
var platformIsMac = null;

function detectIsMac() {
  if (platformIsMac !== null) return Promise.resolve(platformIsMac);
  return new Promise(function(resolve) {
    if (!chrome.runtime || !chrome.runtime.getPlatformInfo) {
      platformIsMac = false;
      resolve(false);
      return;
    }
    try {
      chrome.runtime.getPlatformInfo(function(info) {
        platformIsMac = !!(info && info.os === 'mac');
        resolve(platformIsMac);
      });
    } catch (e) {
      platformIsMac = false;
      resolve(false);
    }
  });
}

function formatShortcut(shortcut, isMac) {
  if (!shortcut) return '';
  var text = String(shortcut);
  if (isMac) {
    // 按 Apple HIG 的修饰键顺序重新排列：⌃ ⌥ ⇧ ⌘。
    // 不直接沿用 Chrome 返回的顺序——Chrome 给的是 Shift+Ctrl+Y 这类，
    // 拼出来会是 ⇧⌃Y，而 mac 用户习惯看到 ⌃⇧Y。
    var SYM = { MacCtrl: '⌃', Ctrl: '⌃', Alt: '⌥', Command: '⌘', Shift: '⇧' };
    var ORDER = ['⌃', '⌥', '⇧', '⌘'];
    var parts = text.split('+');
    var key = parts[parts.length - 1];
    var mods = [];
    parts.slice(0, -1).forEach(function(part) {
      var sym = SYM[part];
      if (sym && mods.indexOf(sym) === -1) mods.push(sym);
    });
    mods.sort(function(a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
    return mods.join('') + key;
  }
  // Windows / Linux：保留加号，用英文键名
  return text
    .replace(/\bMacCtrl\b/g, 'Ctrl')
    .replace(/\bCommand\b/g, 'Win')
    .replace(/\bCtrl\b/g, 'Ctrl')
    .replace(/\bAlt\b/g, 'Alt')
    .replace(/\bShift\b/g, 'Shift');
}

// 这是全局唯一的键位格式化入口：胶囊和扩展弹窗都从这里取，
// 避免两处各写一份、在平台判断上跑偏。
function getShortcutHints() {
  return detectIsMac().then(function(isMac) {
    return new Promise(function(resolve) {
      var empty = { edit: '', annotate: '', export: '', isMac: isMac };
      if (!chrome.commands || !chrome.commands.getAll) {
        resolve(empty);
        return;
      }
      try {
        chrome.commands.getAll(function(commands) {
          var map = { edit: '', annotate: '', export: '', isMac: isMac };
          (commands || []).forEach(function(cmd) {
            var text = formatShortcut(cmd.shortcut, isMac);
            if (cmd.name === 'mode-edit') map.edit = text;
            if (cmd.name === 'mode-annotate') map.annotate = text;
            if (cmd.name === 'export-annotations') map.export = text;
          });
          resolve(map);
        });
      } catch (e) {
        resolve(empty);
      }
    });
  });
}

// 打开授权小窗。授权 API 需要「扩展页面 + 真实点击」，
// 所以这里只负责把窗口送到用户面前，绝不代为调用。
function openAuthWindow(tabId, tabUrl, code) {
  // 把失败原因传给授权窗：不同的 code 对应不同动作
  // （OUTSIDE_DIRECTORY 要「换目录」，PERMISSION_* 才是「重新授权」）。
  var url = 'auth.html?tabId=' + encodeURIComponent(String(tabId || ''))
    + '&tabUrl=' + encodeURIComponent(String(tabUrl || ''))
    + '&code=' + encodeURIComponent(String(code || ''));
  return chrome.windows.create({
    url: url,
    type: 'popup',
    width: 420,
    height: 260
  });
}

function openEditDb() {
  return new Promise(function(resolve, reject) {
    const request = indexedDB.open('proto_annotator_edit', 1);
    request.onupgradeneeded = function() {
      request.result.createObjectStore('kv');
    };
    request.onsuccess = function() {
      resolve(request.result);
    };
    request.onerror = function() {
      reject(request.error);
    };
  });
}

async function idbGet(key) {
  const db = await openEditDb();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get(key);
    request.onsuccess = function() { resolve(request.result); };
    request.onerror = function() { reject(request.error); };
  });
}

async function getEditDirectoryData() {
  return idbGet('editDirectory');
}

async function queryEditPermission(handle) {
  if (!handle || !handle.queryPermission) return 'denied';
  return handle.queryPermission({ mode: 'readwrite' });
}

function buildFileError(code, message, detail) {
  return { success: false, error: { code: code, message: message || code, detail: detail || '' } };
}

function buildCaughtFileError(defaultCode, defaultMessage, error) {
  return buildFileError(
    error && error.code ? error.code : defaultCode,
    error && error.userMessage ? error.userMessage : defaultMessage,
    error && error.message ? error.message : ''
  );
}

function withTimeout(promise, code, message, detail) {
  return Promise.race([
    promise,
    new Promise(function(resolve, reject) {
      setTimeout(function() {
        const error = new Error(detail || message || code);
        error.code = code;
        error.userMessage = message || code;
        reject(error);
      }, FILE_OPERATION_TIMEOUT_MS);
    })
  ]);
}

function getPathSegments(fileUrl) {
  try {
    const url = new URL(fileUrl);
    if (url.protocol !== 'file:') return [];
    return url.pathname.split('/').filter(Boolean).map(function(part) {
      return decodeURIComponent(part);
    });
  } catch (e) {
    return [];
  }
}

function hasRootPathSegments(data) {
  return !!(data && Array.isArray(data.rootPathSegments) && data.rootPathSegments.length);
}

function startsWithSegments(segments, prefix) {
  if (!segments || !prefix || segments.length <= prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (segments[i] !== prefix[i]) return false;
  }
  return true;
}

function getRelativeSegments(fileUrl, data) {
  const segments = getPathSegments(fileUrl);
  if (!segments.length) return null;
  if (!hasRootPathSegments(data)) throw new Error('DIRECTORY_REAUTH_REQUIRED');
  if (!startsWithSegments(segments, data.rootPathSegments)) return null;
  return segments.slice(data.rootPathSegments.length);
}

async function getFileHandleBySegments(rootHandle, segments) {
  if (!segments.length) return null;
  let dir = rootHandle;
  for (let i = 0; i < segments.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(segments[i]);
  }
  return dir.getFileHandle(segments[segments.length - 1]);
}

async function resolveFileHandle(rootHandle, data, fileUrl) {
  const relativeSegments = getRelativeSegments(fileUrl, data);
  if (!relativeSegments) {
    throw new Error('OUTSIDE_DIRECTORY');
  }
  try {
    const handle = await getFileHandleBySegments(rootHandle, relativeSegments);
    if (handle) return handle;
  } catch (e) {}
  return null;
}

function buildPermissionError(permission) {
  if (permission === 'prompt') {
    return buildFileError('PERMISSION_PROMPT_REQUIRED', 'Directory write permission needs to be confirmed again');
  }
  return buildFileError('PERMISSION_DENIED', 'Directory write permission is not granted');
}

async function getWritableFileHandle(fileUrl) {
  const data = await getEditDirectoryData();
  if (!data || !data.handle) {
    return { error: buildFileError('NO_DIRECTORY', 'No prototype directory has been authorized') };
  }

  const permission = await queryEditPermission(data.handle);
  if (permission !== 'granted') {
    return { error: buildPermissionError(permission) };
  }

  try {
    const fileHandle = await resolveFileHandle(data.handle, data, fileUrl);
    if (!fileHandle) {
      return { error: buildFileError('FILE_NOT_FOUND', 'Could not find the HTML file inside the authorized directory') };
    }
    return { fileHandle: fileHandle };
  } catch (e) {
    if (e.message === 'DIRECTORY_REAUTH_REQUIRED') {
      return { error: buildFileError('DIRECTORY_REAUTH_REQUIRED', 'Directory path needs to be authorized again') };
    }
    if (e.message === 'OUTSIDE_DIRECTORY') {
      return { error: buildFileError('OUTSIDE_DIRECTORY', 'The current file is outside the authorized directory') };
    }
    return { error: buildFileError('FILE_NOT_FOUND', e.message) };
  }
}

async function readEditSource(fileUrl) {
  const result = await getWritableFileHandle(fileUrl);
  if (result.error) return result.error;

  try {
    const file = await withTimeout(
      result.fileHandle.getFile(),
      'READ_TIMEOUT',
      'Reading the HTML file timed out',
      'fileHandle.getFile() did not finish'
    );
    const html = await withTimeout(
      file.text(),
      'READ_TIMEOUT',
      'Reading the HTML file timed out',
      'file.text() did not finish'
    );
    return { success: true, html: html };
  } catch (e) {
    return buildCaughtFileError('READ_FAILED', 'Could not read the HTML file', e);
  }
}

async function saveEditedHtml(message) {
  const result = await getWritableFileHandle(message.fileUrl);
  if (result.error) return result.error;

  try {
    const writable = await withTimeout(
      result.fileHandle.createWritable(),
      'WRITE_TIMEOUT',
      'Opening the HTML file for writing timed out',
      'fileHandle.createWritable() did not finish'
    );
    await withTimeout(
      writable.write(message.html),
      'WRITE_TIMEOUT',
      'Writing the HTML file timed out',
      'writable.write() did not finish'
    );
    await withTimeout(
      writable.close(),
      'WRITE_TIMEOUT',
      'Closing the HTML file after writing timed out',
      'writable.close() did not finish'
    );
    return { success: true, pageName: message.pageName };
  } catch (e) {
    return buildCaughtFileError('WRITE_FAILED', 'Could not write the HTML file', e);
  }
}

async function getEditAuthState() {
  const data = await getEditDirectoryData();
  if (!data || !data.handle) {
    return { authorized: false, directoryName: '' };
  }
  const permission = await queryEditPermission(data.handle);
  const hasRootPath = hasRootPathSegments(data);
  return {
    authorized: permission === 'granted' && hasRootPath,
    needsReauth: permission !== 'granted' || !hasRootPath,
    permission: permission === 'granted' && !hasRootPath ? 'root_path_unknown' : permission,
    directoryName: data.name || data.handle.name || ''
  };
}

function setIconState(tabId, state) {
  chrome.action.setIcon({ tabId: tabId, path: ICON_STATES[state] }).catch(function() {});
}

function getIconStateForMode(mode) {
  if (mode === 'edit') return 'EDIT';
  if (mode === 'annotate') return 'ANNOTATE';
  return 'INACTIVE';
}

function ensureContentScriptsInjected(tabId) {
  return new Promise(function(resolve) {
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, function(response) {
      if (chrome.runtime.lastError || !response) {
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          files: CONTENT_SCRIPTS
        }, function() {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          chrome.scripting.insertCSS({
            target: { tabId: tabId, allFrames: true },
            files: CONTENT_CSS
          }, function() {
            setTimeout(function() {
              resolve(!chrome.runtime.lastError);
            }, 200);
          });
        });
      } else {
        resolve(true);
      }
    });
  });
}

function sendMessageToAllFrames(tabId, message) {
  chrome.webNavigation.getAllFrames({ tabId: tabId }, function(frames) {
    if (!frames) return;
    frames.forEach(function(frame) {
      chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }, function() {
        if (chrome.runtime.lastError) {}
      });
    });
  });
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  var tabId = message.tabId || (sender.tab ? sender.tab.id : null);

  switch (message.type) {
    case 'SET_MODE': {
      var targetMode = message.mode || (message.active ? 'annotate' : 'paused');
      applyMode(tabId, targetMode, message.topLevelUrl).then(sendResponse);
      return true;
    }

    case 'GET_MODE': {
      if (!tabId) {
        sendResponse({ active: false, mode: 'paused', topLevelUrl: '' });
        break;
      }
      getTabState(tabId).then(function(state) {
        if (!state) {
          sendResponse({ active: false, mode: 'paused', topLevelUrl: '' });
          return;
        }
        sendResponse({
          active: state.active,
          mode: state.mode || (state.active ? 'annotate' : 'off'),
          topLevelUrl: state.topLevelUrl
        });
      }).catch(function() {
        sendResponse({ active: false, mode: 'paused', topLevelUrl: '' });
      });
      return true;
    }

    case 'GET_EDIT_AUTH_STATE': {
      getEditAuthState().then(sendResponse).catch(function() {
        sendResponse({ authorized: false, directoryName: '' });
      });
      return true;
    }

    case 'GET_EDIT_STATE': {
      var count = tabId && tabStates[tabId] ? (tabStates[tabId].editCount || 0) : 0;
      getEditAuthState().then(function(authState) {
        sendResponse(Object.assign({ count: count }, authState));
      }).catch(function() {
        sendResponse({ count: count, authorized: false, directoryName: '' });
      });
      return true;
    }

    case 'EDIT_STATE_CHANGED': {
      if (!tabId) {
        sendResponse({ success: true });
        break;
      }
      // 关键：不能凭空造 {active:false, mode:'off'} 整条覆盖存储。
      // 保存成功时 EDIT_STATE_CHANGED 往往是新 service worker 收到的第一条消息
      // （旧 SW 早已被回收），凭空造会把模式清成暂停、把计数清零。
      getTabState(tabId).then(function(state) {
        var next = state || { active: false, mode: 'paused', editCount: 0, topLevelUrl: '' };
        if (typeof message.delta === 'number') {
          next.editCount = (next.editCount || 0) + message.delta;
        } else {
          next.editCount = message.count || 0;
        }
        tabStates[tabId] = next;
        persistTabState(tabId);
        sendResponse({ success: true });
      }).catch(function() {
        sendResponse({ success: false });
      });
      return true;
    }

    case 'READ_EDIT_SOURCE': {
      readEditSource(message.fileUrl).then(sendResponse).catch(function(error) {
        sendResponse(buildFileError('READ_FAILED', error.message));
      });
      return true;
    }

    case 'SAVE_EDITED_HTML': {
      saveEditedHtml(message).then(sendResponse).catch(function(error) {
        sendResponse(buildFileError('FILE_NOT_FOUND', error.message));
      });
      return true;
    }

    case 'GET_SHORTCUTS': {
      getShortcutHints().then(sendResponse).catch(function() {
        sendResponse({ edit: '', annotate: '', export: '', isMac: false });
      });
      return true;
    }

    case 'GET_EDIT_READINESS': {
      getEditReadiness(message.fileUrl).then(sendResponse).catch(function() {
        sendResponse({ ready: false, code: 'READ_FAILED', remedy: 'choose', directoryName: '' });
      });
      return true;
    }

    case 'REQUEST_AUTH': {
      var authTabId = message.tabId || tabId;
      if (!authTabId) {
        sendResponse({ success: false, error: { code: 'NO_TAB' } });
        break;
      }
      // 关键：一律用「顶层标签页」的 URL 计算 rootPathSegments，不采用调用方传来的
      // frame URL。内容脚本在 iframe 里时 window.location.href 是 iframe 的路径，
      // 用它算前缀会把授权记录绑到子目录上，导致顶层页面反而存不了
      // （两个入口互相拆台）。顶层 URL 天然覆盖它下面的所有子目录。
      chrome.tabs.get(authTabId, function (tab) {
        var url = (tab && tab.url) || message.tabUrl || '';
        openAuthWindow(authTabId, url, message.code).then(function() {
          sendResponse({ success: true });
        }).catch(function(error) {
          sendResponse({ success: false, error: { code: 'AUTH_WINDOW_FAILED', message: String(error) } });
        });
      });
      return true;
    }

    case 'AUTH_COMPLETED': {
      // 授权小窗完成后：通知对应 tab 重试上次失败的保存
      if (tabId) {
        sendResponse({ success: true });
        chrome.tabs.sendMessage(tabId, { type: 'AUTH_COMPLETED', ok: !!message.ok }, function() {
          void chrome.runtime.lastError;
        });
      } else {
        sendResponse({ success: false, error: { code: 'NO_TAB' } });
      }
      break;
    }

    case 'PING': {
      sendResponse({ pong: true });
      break;
    }

    case 'ANNOTATION_CREATED':
    case 'ANNOTATION_DELETED':
    case 'ANNOTATION_UPDATED': {
      if (tabId) {
        sendMessageToAllFrames(tabId, message);
      }
      sendResponse({ success: true });
      break;
    }

    case 'NAVIGATE_TO_ANNOTATION': {
      if (tabId) {
        sendMessageToAllFrames(tabId, message);
      }
      sendResponse({ success: true });
      break;
    }

    case 'CLEAR_ALL_ANNOTATIONS': {
      if (tabId) {
        sendMessageToAllFrames(tabId, message);
      }
      sendResponse({ success: true });
      break;
    }

    default:
      break;
  }
  return false;
});

chrome.tabs.onRemoved.addListener(function(tabId) {
  delete modeSeq[tabId];
  delete tabStates[tabId];
  chrome.storage.local.remove([getStorageKey(tabId)]);
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    setIconState(tabId, 'DEFAULT');
  }
  if (changeInfo.status === 'complete') {
    // 必须走 getTabState（带 storage 兜底）：service worker 被回收后
    // tabStates 是空的，只看内存会导致「页面恢复了模式、图标却停在 DEFAULT」。
    getTabState(tabId).then(function(state) {
      if (!state || !state.active) return;
      var mode = state.mode || 'annotate';
      setIconState(tabId, getIconStateForMode(mode));
      ensureContentScriptsInjected(tabId).then(function() {
        sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: true, mode: mode });
      });
    });
  }
});

// ───────────────────────── 快捷键（chrome.commands）─────────────────────────
// ⌥Q 编辑 / ⌥W 标注（各自再按一次回暂停）/ ⌥E 导出标注（仅标注模式）
// 走 chrome.commands 而不是 content script 监听：页面抢不走键、iframe 内也生效、
// 且用户在 chrome://extensions/shortcuts 可自行改键。
function handleModeCommand(tabId, tabUrl, targetMode) {
  var seq = (modeSeq[tabId] || 0) + 1;
  modeSeq[tabId] = seq;

  getTabState(tabId).then(function(state) {
    if (seq !== modeSeq[tabId]) return null;   // 已被更晚的一次按键取代
    var current = (state && state.active) ? (state.mode || 'annotate') : 'paused';
    var next = current === targetMode ? 'paused' : targetMode;
    return applyMode(tabId, next, tabUrl, seq);
  }).then(function(result) {
    if (result === null || (result && result.success)) return;
    if (result.error && result.error.code === 'SUPERSEDED') return;   // 正常让位，不打扰用户
    chrome.tabs.sendMessage(tabId, {
      type: 'MODE_SWITCH_FAILED',
      error: result.error || { code: 'UNKNOWN' }
    }, function() { void chrome.runtime.lastError; });
  });
}

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(function(command) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.id) return;

      if (command === 'mode-edit' || command === 'mode-annotate') {
        handleModeCommand(tab.id, tab.url, command === 'mode-edit' ? 'edit' : 'annotate');
        return;
      }

      if (command === 'export-annotations') {
        getTabState(tab.id).then(function(state) {
          var inAnnotate = !!(state && state.active && (state.mode || 'annotate') === 'annotate');
          if (!inAnnotate) return;   // 仅标注模式生效
          chrome.tabs.sendMessage(tab.id, { type: 'EXPORT_ANNOTATIONS' }, function() {
            void chrome.runtime.lastError;
          });
        });
      }
    });
  });
}
