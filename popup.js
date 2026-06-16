document.addEventListener('DOMContentLoaded', () => {
  const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
  const authBtn = document.getElementById('authBtn');
  const statusText = document.getElementById('statusText');
  const hintText = document.getElementById('hintText');
  const editState = document.getElementById('editState');

  let tabId = null;
  let tabUrl = '';
  let currentMode = 'off';
  let editAuthorized = false;
  let showEditAuth = false;

  function openEditDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('proto_annotator_edit', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('kv');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openEditDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function updateModeUI(mode) {
    currentMode = mode || 'off';
    if (currentMode === 'edit') showEditAuth = true;
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === currentMode);
    });
    authBtn.hidden = !showEditAuth;
    editState.hidden = !showEditAuth;

    if (currentMode === 'edit') {
      statusText.textContent = editAuthorized ? '编辑模式已开启' : '编辑模式待授权';
      statusText.classList.toggle('active', editAuthorized);
      statusText.classList.add('edit');
      hintText.textContent = editAuthorized
        ? '双击文本直接编辑，或 Shift+点击编辑'
        : '先授权原型目录，再开启编辑模式';
    } else if (currentMode === 'annotate') {
      showEditAuth = false;
      authBtn.hidden = true;
      editState.hidden = true;
      statusText.textContent = '标注模式已开启';
      statusText.classList.add('active');
      statusText.classList.remove('edit');
      hintText.textContent = '在页面上 Shift+点击 标注元素，Shift+拖拽 标注区域';
    } else {
      showEditAuth = false;
      authBtn.hidden = true;
      editState.hidden = true;
      statusText.textContent = '模式已关闭';
      statusText.classList.remove('active', 'edit');
      hintText.textContent = '选择编辑或标注模式开始使用';
    }
  }

  function setControlsDisabled(disabled) {
    modeButtons.forEach((btn) => {
      btn.disabled = disabled;
    });
    authBtn.disabled = disabled;
  }

  function refreshEditState() {
    if (!tabId) return;
    chrome.runtime.sendMessage({ type: 'GET_EDIT_STATE', tabId: tabId }, (response) => {
      if (chrome.runtime.lastError || !response) {
        editAuthorized = false;
        editState.textContent = '未授权目录';
        authBtn.textContent = '授权原型目录';
        updateModeUI(currentMode);
        return;
      }
      editAuthorized = !!response.authorized;
      const dir = response.directoryName || '';
      if (editAuthorized) {
        editState.textContent = '目录已授权' + (dir ? '：' + dir : '') + ' · 已保存 ' + (response.count || 0) + ' 处';
        authBtn.textContent = '重新授权目录';
      } else if (response.needsReauth && dir) {
        editState.textContent = '目录权限需重新授权：' + dir;
        authBtn.textContent = '重新授权目录';
      } else {
        editState.textContent = '未授权目录';
        authBtn.textContent = '授权原型目录';
      }
      updateModeUI(currentMode);
    });
  }

  function setMode(mode) {
    if (!tabId) return;
    if (mode === 'edit' && !editAuthorized) {
      showEditAuth = true;
      updateModeUI('edit');
      return;
    }

    chrome.runtime.sendMessage({
      type: 'SET_MODE',
      mode: mode,
      active: mode !== 'off',
      tabId: tabId,
      topLevelUrl: tabUrl
    }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      updateModeUI(mode);
      refreshEditState();
    });
  }

  async function authorizeDirectory() {
    if (!window.showDirectoryPicker) {
      editState.textContent = '当前浏览器不支持目录授权';
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({
        id: 'prototype-annotator-root',
        mode: 'readwrite'
      });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        editState.textContent = '未获得目录写入权限';
        return;
      }
      await idbSet('editDirectory', { handle: handle, name: handle.name });
      editAuthorized = true;
      refreshEditState();
      setMode('edit');
    } catch (e) {
      editState.textContent = '目录授权已取消';
    }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      statusText.textContent = '未找到活动标签页';
      setControlsDisabled(true);
      return;
    }
    if (!tabs[0].url) {
      statusText.textContent = '未找到页面地址';
      setControlsDisabled(true);
      return;
    }
    tabUrl = tabs[0].url;
    if (!tabUrl.startsWith('file://') && !tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
      statusText.textContent = '请在网页或 file:// 页面上使用';
      setControlsDisabled(true);
      return;
    }

    tabId = tabs[0].id;
    chrome.runtime.sendMessage({ type: 'GET_MODE', tabId: tabId }, (response) => {
      if (chrome.runtime.lastError || !response) {
        statusText.textContent = '未注入（请刷新页面后重试）';
        setControlsDisabled(true);
        return;
      }
      updateModeUI(response.mode || (response.active ? 'annotate' : 'off'));
      setControlsDisabled(false);
      refreshEditState();
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  authBtn.addEventListener('click', authorizeDirectory);
});
