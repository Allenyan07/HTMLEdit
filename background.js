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
  }
};

const CONTENT_SCRIPTS = [
  'content/storage.js',
  'content/selector.js',
  'content/messaging.js',
  'content/area-selector.js',
  'content/annotator.js',
  'content/panel.js',
  'content/content.js'
];

const CONTENT_CSS = ['content/content.css'];

const tabStates = {};

function getStorageKey(tabId) {
  return 'proto_mode_' + tabId;
}

function setIconState(tabId, state) {
  chrome.action.setIcon({ tabId: tabId, path: ICON_STATES[state] }).catch(function() {});
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
      var active = message.active;
      var topLevelUrl = message.topLevelUrl;
      if (tabId) {
        tabStates[tabId] = { active: active, topLevelUrl: topLevelUrl };
        setIconState(tabId, active ? 'ACTIVE' : 'INACTIVE');
        var storageData = {};
        storageData[getStorageKey(tabId)] = { active: active, topLevelUrl: topLevelUrl };
        chrome.storage.local.set(storageData);

        ensureContentScriptsInjected(tabId).then(function() {
          sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: active });
        });
      }
      sendResponse({ success: true });
      break;
    }

    case 'GET_MODE': {
      if (tabId && tabStates[tabId]) {
        sendResponse({ active: tabStates[tabId].active, topLevelUrl: tabStates[tabId].topLevelUrl });
      } else if (tabId) {
        var sKey = getStorageKey(tabId);
        chrome.storage.local.get([sKey], function(result) {
          var data = result[sKey];
          if (data) {
            tabStates[tabId] = data;
            sendResponse({ active: data.active, topLevelUrl: data.topLevelUrl });
          } else {
            sendResponse({ active: false, topLevelUrl: '' });
          }
        });
        return true;
      } else {
        sendResponse({ active: false, topLevelUrl: '' });
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
  delete tabStates[tabId];
  chrome.storage.local.remove([getStorageKey(tabId)]);
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    setIconState(tabId, 'DEFAULT');
  }
  if (changeInfo.status === 'complete') {
    if (tabStates[tabId] && tabStates[tabId].active) {
      setIconState(tabId, 'ACTIVE');
      ensureContentScriptsInjected(tabId).then(function() {
        sendMessageToAllFrames(tabId, { type: 'MODE_CHANGED', active: true });
      });
    }
  }
});
