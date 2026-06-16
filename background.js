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

function buildFileError(code, message) {
  return { success: false, error: { code: code, message: message || code } };
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

function getRelativeSegments(fileUrl, rootName) {
  const segments = getPathSegments(fileUrl);
  if (!segments.length) return [];
  const index = segments.lastIndexOf(rootName);
  if (index !== -1 && index < segments.length - 1) {
    return segments.slice(index + 1);
  }
  return [segments[segments.length - 1]];
}

async function getFileHandleBySegments(rootHandle, segments) {
  if (!segments.length) return null;
  let dir = rootHandle;
  for (let i = 0; i < segments.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(segments[i]);
  }
  return dir.getFileHandle(segments[segments.length - 1]);
}

async function findFileByName(rootHandle, fileName, matches) {
  matches = matches || [];
  if (matches.length > 1) return matches;
  for await (const entry of rootHandle.values()) {
    if (entry.kind === 'file' && entry.name === fileName) {
      matches.push(entry);
      if (matches.length > 1) return matches;
    } else if (entry.kind === 'directory') {
      await findFileByName(entry, fileName, matches);
      if (matches.length > 1) return matches;
    }
  }
  return matches;
}

async function resolveFileHandle(rootHandle, rootName, fileUrl) {
  const relativeSegments = getRelativeSegments(fileUrl, rootName);
  try {
    const handle = await getFileHandleBySegments(rootHandle, relativeSegments);
    if (handle) return handle;
  } catch (e) {}

  const allSegments = getPathSegments(fileUrl);
  const fileName = allSegments[allSegments.length - 1];
  if (!fileName) return null;
  const matches = await findFileByName(rootHandle, fileName);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('AMBIGUOUS_FILE');
  return null;
}

async function saveEditedHtml(message) {
  const data = await getEditDirectoryData();
  if (!data || !data.handle) {
    return buildFileError('NO_DIRECTORY', 'No prototype directory has been authorized');
  }

  const permission = await queryEditPermission(data.handle);
  if (permission !== 'granted') {
    return buildFileError('PERMISSION_DENIED', 'Directory write permission is not granted');
  }

  let fileHandle;
  try {
    fileHandle = await resolveFileHandle(data.handle, data.name, message.fileUrl);
  } catch (e) {
    if (e.message === 'AMBIGUOUS_FILE') {
      return buildFileError('OUTSIDE_DIRECTORY', 'Multiple files with the same name were found');
    }
    return buildFileError('FILE_NOT_FOUND', e.message);
  }

  if (!fileHandle) {
    return buildFileError('FILE_NOT_FOUND', 'Could not find the HTML file inside the authorized directory');
  }

  try {
    const writable = await fileHandle.createWritable();
    await writable.write(message.html);
    await writable.close();
    return { success: true, pageName: message.pageName };
  } catch (e) {
    return buildFileError('PERMISSION_DENIED', e.message);
  }
}

async function getEditAuthState() {
  const data = await getEditDirectoryData();
  if (!data || !data.handle) {
    return { authorized: false, directoryName: '' };
  }
  const permission = await queryEditPermission(data.handle);
  return {
    authorized: permission === 'granted',
    needsReauth: permission !== 'granted',
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
          chrome.scripting.insertCSS({
            target: { tabId: tabId, allFrames: true },
            files: CONTENT_CSS
          }, function() {
            setTimeout(resolve, 200);
          });
        });
      } else {
        resolve();
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
      if (tabId) {
        var editCount = tabStates[tabId] ? (tabStates[tabId].editCount || 0) : 0;
        tabStates[tabId] = { active: active, mode: mode, topLevelUrl: topLevelUrl, editCount: editCount };
        setIconState(tabId, getIconStateForMode(mode));
        var storageData = {};
        storageData[getStorageKey(tabId)] = { active: active, mode: mode, topLevelUrl: topLevelUrl, editCount: editCount };
        chrome.storage.local.set(storageData);

        ensureContentScriptsInjected(tabId).then(function() {
          sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: active, mode: mode });
        });
      }
      sendResponse({ success: true });
      break;
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
        tabStates[tabId].editCount = message.count || 0;
      }
      sendResponse({ success: true });
      break;
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
