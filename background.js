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
  'content/editor.js',
  'content/panel.js',
  'content/content.js'
];

const CONTENT_CSS = ['content/content.css'];
const FILE_OPERATION_TIMEOUT_MS = 20000;

const tabStates = {};

function getStorageKey(tabId) {
  return 'proto_mode_' + tabId;
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
      var mode = message.mode || (message.active ? 'annotate' : 'off');
      var active = mode !== 'off';
      var topLevelUrl = message.topLevelUrl;
      if (!tabId) {
        sendResponse({ success: false, error: { code: 'NO_TAB' } });
        break;
      }
      if (!active) {
        var offEditCount = tabStates[tabId] ? (tabStates[tabId].editCount || 0) : 0;
        tabStates[tabId] = { active: false, mode: mode, topLevelUrl: topLevelUrl, editCount: offEditCount };
        setIconState(tabId, getIconStateForMode(mode));
        var offStorageData = {};
        offStorageData[getStorageKey(tabId)] = tabStates[tabId];
        chrome.storage.local.set(offStorageData);
        sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: false, mode: mode });
        sendResponse({ success: true });
        break;
      }
      ensureContentScriptsInjected(tabId).then(function(injected) {
        if (!injected) {
          sendResponse({
            success: false,
            error: {
              code: 'INJECTION_FAILED',
              message: 'Could not inject content scripts into the current page'
            }
          });
          return;
        }
        var editCount = tabStates[tabId] ? (tabStates[tabId].editCount || 0) : 0;
        tabStates[tabId] = { active: true, mode: mode, topLevelUrl: topLevelUrl, editCount: editCount };
        setIconState(tabId, getIconStateForMode(mode));
        var storageData = {};
        storageData[getStorageKey(tabId)] = tabStates[tabId];
        chrome.storage.local.set(storageData);
        sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: true, mode: mode });
        sendResponse({ success: true });
      });
      return true;
    }

    case 'GET_MODE': {
      if (tabId && tabStates[tabId]) {
        sendResponse({
          active: tabStates[tabId].active,
          mode: tabStates[tabId].mode || (tabStates[tabId].active ? 'annotate' : 'off'),
          topLevelUrl: tabStates[tabId].topLevelUrl
        });
      } else if (tabId) {
        var sKey = getStorageKey(tabId);
        chrome.storage.local.get([sKey], function(result) {
          var data = result[sKey];
          if (data) {
            tabStates[tabId] = data;
            sendResponse({
              active: data.active,
              mode: data.mode || (data.active ? 'annotate' : 'off'),
              topLevelUrl: data.topLevelUrl
            });
          } else {
            sendResponse({ active: false, mode: 'off', topLevelUrl: '' });
          }
        });
        return true;
      } else {
        sendResponse({ active: false, mode: 'off', topLevelUrl: '' });
      }
      break;
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
      if (tabId) {
        if (!tabStates[tabId]) tabStates[tabId] = { active: false, mode: 'off', editCount: 0 };
        if (typeof message.delta === 'number') {
          tabStates[tabId].editCount = (tabStates[tabId].editCount || 0) + message.delta;
        } else {
          tabStates[tabId].editCount = message.count || 0;
        }
        var editStorageData = {};
        editStorageData[getStorageKey(tabId)] = tabStates[tabId];
        chrome.storage.local.set(editStorageData);
      }
      sendResponse({ success: true });
      break;
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
  delete tabStates[tabId];
  chrome.storage.local.remove([getStorageKey(tabId)]);
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    setIconState(tabId, 'DEFAULT');
  }
  if (changeInfo.status === 'complete') {
    if (tabStates[tabId] && tabStates[tabId].active) {
      setIconState(tabId, getIconStateForMode(tabStates[tabId].mode || 'annotate'));
      ensureContentScriptsInjected(tabId).then(function() {
        sendMessageToAllFrames(tabId, {
          type: 'MODE_CHANGED',
          active: true,
          mode: tabStates[tabId].mode || 'annotate'
        });
      });
    }
  }
});
