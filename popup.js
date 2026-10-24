document.addEventListener('DOMContentLoaded', () => {
  const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
  const authBtn = document.getElementById('authBtn');
  const statusText = document.getElementById('statusText');
  const statusLabel = document.getElementById('statusLabel');
  const statusShortcut = document.getElementById('statusShortcut');
  // 实际生效的快捷键（popup 是扩展页面，可以直接读 chrome.commands）
  let shortcutMap = { edit: '', annotate: '', export: '' };
  const hintText = document.getElementById('hintText');
  const editState = document.getElementById('editState');

  let tabId = null;
  let tabUrl = '';
  let currentMode = 'off';
  let editAuthorized = false;
  let showEditAuth = false;
  let authAction = 'choose';
  let fileSchemeAllowed = true;

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

  async function idbGet(key) {
    const db = await openEditDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const request = tx.objectStore('kv').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getPathSegments(fileUrl) {
    try {
      const url = new URL(fileUrl);
      if (url.protocol !== 'file:') return [];
      return url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    } catch (e) {
      return [];
    }
  }

  function getAuthorizedRootSegments(fileUrl, rootName) {
    const segments = getPathSegments(fileUrl);
    if (!segments.length || !rootName) return null;
    const index = segments.lastIndexOf(rootName);
    if (index === -1) return null;
    return segments.slice(0, index + 1);
  }

  // 统一的「改状态文字」入口：任何直接改状态的路径都要顺带撤掉键位徽标，
  // 否则会出现「状态是报错、右边却还挂着 ⌥Q」这种自相矛盾的界面。
  function setStatusText(text) {
    statusLabel.textContent = text;
    hideShortcut();
  }

  function hideShortcut() {
    statusShortcut.hidden = true;
    statusShortcut.textContent = '';
  }

  function showShortcut(text) {
    if (!text) {
      hideShortcut();
      return;
    }
    statusShortcut.textContent = text;
    statusShortcut.hidden = false;
  }

  // 键位的格式化统一由 background 负责（它同时知道平台是 mac 还是 win）。
  // 这里只取结果，不再自己判断平台——两处各写一份必然会跑偏。
  function loadShortcutMap() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_SHORTCUTS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve();
          return;
        }
        shortcutMap.edit = res.edit || '';
        shortcutMap.annotate = res.annotate || '';
        shortcutMap.export = res.export || '';
        resolve();
      });
    });
  }

  // 只有编辑/标注态才显示键位徽标。
  // 暂停态不显示：那时的重点是「页面已恢复原状」，挂两个键位反而像催促操作。
  function updateShortcutHint(mode) {
    if (mode === 'edit') {
      showShortcut(shortcutMap.edit || '');
    } else if (mode === 'annotate') {
      showShortcut(shortcutMap.annotate || '');
    } else {
      hideShortcut();
    }
  }

  function updateModeUI(mode) {
    // 归一化：background 现在统一写 'paused'，而按钮的 dataset 曾是 'off'，
    // 不归一会导致「从胶囊/快捷键暂停后打开弹窗，三段一个都不亮」。
    currentMode = (mode === 'edit' || mode === 'annotate') ? mode : 'paused';
    if (currentMode === 'edit') showEditAuth = true;
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === currentMode);
    });
    authBtn.hidden = !showEditAuth;
    editState.hidden = !showEditAuth;

    if (currentMode === 'edit') {
      setStatusText(editAuthorized ? '编辑模式已开启' : '编辑模式已开启（未授权目录）');
      statusText.classList.toggle('active', editAuthorized);
      statusText.classList.add('edit');
      hintText.textContent = editAuthorized
        ? '双击文本直接编辑，或 Shift+点击编辑'
        : '可以直接编辑；点「确认修改」时会提示授权目录，授权后自动完成这次保存';
    } else if (currentMode === 'annotate') {
      showEditAuth = false;
      authBtn.hidden = true;
      editState.hidden = true;
      setStatusText('标注模式已开启');
      statusText.classList.add('active');
      statusText.classList.remove('edit');
      hintText.textContent = '在页面上 Shift+点击 标注元素，Shift+拖拽 标注区域';
    } else {
      showEditAuth = false;
      authBtn.hidden = true;
      editState.hidden = true;
      setStatusText('已暂停 · 页面不受干扰');
      statusText.classList.remove('active', 'edit');
      hintText.textContent = '暂停后页面交互完全恢复；切回编辑或标注即可继续';
    }

    updateShortcutHint(currentMode);
  }

  function isFilePage() {
    return tabUrl.startsWith('file://');
  }

  function getFileSchemeAccessAllowed() {
    return new Promise((resolve) => {
      const api = chrome.extension && chrome.extension.isAllowedFileSchemeAccess;
      if (!api) {
        resolve(true);
        return;
      }

      let settled = false;
      const done = (allowed) => {
        if (settled) return;
        settled = true;
        resolve(!!allowed);
      };
      setTimeout(() => done(true), 1200);

      try {
        const result = api(done);
        if (result && typeof result.then === 'function') {
          result.then(done).catch(() => done(true));
        } else if (typeof result === 'boolean') {
          done(result);
        }
      } catch (e) {
        try {
          const result = api();
          if (result && typeof result.then === 'function') {
            result.then(done).catch(() => done(true));
          } else if (typeof result === 'boolean') {
            done(result);
          } else {
            done(true);
          }
        } catch (err) {
          done(true);
        }
      }
    });
  }

  function showFileAccessBlocked() {
    setStatusText('需要开启文件访问权限');
    statusText.classList.remove('active', 'edit');
    hintText.textContent = '请在 Chrome 扩展详情中开启“允许访问文件网址”，然后刷新当前 HTML 页面';
    showEditAuth = false;
    authBtn.hidden = true;
    editState.hidden = true;
    modeButtons.forEach((btn) => {
      btn.classList.remove('active');
    });
    setControlsDisabled(true);
  }

  function showInjectionFailed() {
    setStatusText('页面脚本注入失败');
    statusText.classList.remove('active', 'edit');
    hintText.textContent = isFilePage()
      ? '请确认已开启“允许访问文件网址”，然后刷新当前 HTML 页面'
      : '请刷新页面后重试，或确认当前页面允许扩展访问';
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
        authAction = 'choose';
        updateModeUI(currentMode);
        return;
      }
      editAuthorized = !!response.authorized;
      const dir = response.directoryName || '';
      if (editAuthorized) {
        editState.textContent = '目录已授权' + (dir ? '：' + dir : '') + ' · 已保存 ' + (response.count || 0) + ' 处';
        authBtn.textContent = '更换目录';
        authAction = 'choose';
      } else if (response.needsReauth && dir) {
        editState.textContent = response.permission === 'prompt'
          ? '目录权限需重新确认：' + dir
          : response.permission === 'root_path_unknown'
            ? '目录路径需重新授权：' + dir
            : '目录权限需重新授权：' + dir;
        authBtn.textContent = response.permission === 'root_path_unknown'
          ? '更换目录'
          : '重新确认权限';
        authAction = response.permission === 'root_path_unknown' ? 'choose' : 'confirm';
      } else {
        editState.textContent = '未授权目录';
        authBtn.textContent = '授权原型目录';
        authAction = 'choose';
      }
      updateModeUI(currentMode);
    });
  }

  function setMode(mode) {
    if (!tabId) return;
    if (isFilePage() && !fileSchemeAllowed) {
      showFileAccessBlocked();
      return;
    }
    chrome.runtime.sendMessage({
      type: 'SET_MODE',
      mode: mode,
      active: mode !== 'off',
      tabId: tabId,
      topLevelUrl: tabUrl
    }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        showInjectionFailed();
        return;
      }
      updateModeUI(mode);
      refreshEditState();
    });
  }

  async function authorizeDirectory() {
    if (authAction === 'confirm') {
      await confirmDirectoryPermission();
      return;
    }
    await chooseDirectory();
  }

  async function confirmDirectoryPermission() {
    try {
      const existing = await idbGet('editDirectory');
      if (!existing || !existing.handle) {
        authAction = 'choose';
        authBtn.textContent = '授权原型目录';
        await chooseDirectory();
        return;
      }
      if (!existing.rootPathSegments) {
        editState.textContent = '目录路径信息缺失，请更换目录';
        authAction = 'choose';
        authBtn.textContent = '更换目录';
        return;
      }

      const permission = await existing.handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        editAuthorized = false;
        editState.textContent = '未获得目录写入权限，可更换目录';
        authAction = 'choose';
        authBtn.textContent = '更换目录';
        updateModeUI(currentMode);
        return;
      }

      editAuthorized = true;
      refreshEditState();
      setMode('edit');
    } catch (e) {
      editState.textContent = '权限确认已取消，可更换目录';
      authAction = 'choose';
      authBtn.textContent = '更换目录';
    }
  }

  async function chooseDirectory() {
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
      const rootPathSegments = getAuthorizedRootSegments(tabUrl, handle.name);
      if (!rootPathSegments) {
        editState.textContent = '当前页面不在授权目录内，请打开目录内 HTML 后重新授权';
        return;
      }
      await idbSet('editDirectory', {
        handle: handle,
        name: handle.name,
        rootPathSegments: rootPathSegments
      });
      editAuthorized = true;
      refreshEditState();
      setMode('edit');
    } catch (e) {
      editState.textContent = '目录授权已取消';
    }
  }

  async function initForActiveTab(activeTab) {
    if (!activeTab) {
      setStatusText('未找到活动标签页');
      setControlsDisabled(true);
      return;
    }
    if (!activeTab.url) {
      setStatusText('未找到页面地址');
      setControlsDisabled(true);
      return;
    }
    tabUrl = activeTab.url;
    if (!tabUrl.startsWith('file://') && !tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
      setStatusText('请在网页或 file:// 页面上使用');
      setControlsDisabled(true);
      return;
    }

    tabId = activeTab.id;
    fileSchemeAllowed = !isFilePage() || await getFileSchemeAccessAllowed();
    if (!fileSchemeAllowed) {
      showFileAccessBlocked();
      return;
    }

    chrome.runtime.sendMessage({ type: 'GET_MODE', tabId: tabId }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setStatusText('未注入（请刷新页面后重试）');
        setControlsDisabled(true);
        return;
      }
      updateModeUI(response.mode || (response.active ? 'annotate' : 'off'));
      setControlsDisabled(false);
      refreshEditState();
    });
  }

  // 先读键位再初始化界面，否则第一次渲染时键位徽标是空的
  loadShortcutMap().then(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      initForActiveTab(tabs[0]);
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  authBtn.addEventListener('click', authorizeDirectory);
});
