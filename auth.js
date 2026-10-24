/* 页改笔 HTMLEdit v2.1.0 —— 授权小窗
 *
 * 打开方式（background.js 调用）：
 *   chrome.windows.create({
 *     url: 'auth.html?tabId=123&tabUrl=' + encodeURIComponent(fileUrl),
 *     type: 'popup', width: 420, height: 260
 *   });
 *
 * 三条硬约束：
 *   1. requestPermission / showDirectoryPicker 只在按钮真实点击的调用栈里调，
 *      页面加载时绝不自动调（没有用户手势会直接失败）。
 *   2. rootPathSegments 必须用传入的 tabUrl 算，不能用本窗口自己的 location.href。
 *   3. 无外部依赖，纯原生 JS。
 */
(function () {
  'use strict';

  const DB_NAME = 'proto_annotator_edit';
  const STORE_NAME = 'kv';
  const DIRECTORY_KEY = 'editDirectory';

  const MSG_MISSING_URL = '无法获取当前文件地址，请从扩展弹窗重试';
  const MSG_NO_TAB_ID = '无法获取当前标签页信息，请从扩展弹窗重试';

  const els = {
    title: document.getElementById('title'),
    desc: document.getElementById('desc'),
    dirLabel: document.getElementById('dirLabel'),
    dirName: document.getElementById('dirName'),
    msg: document.getElementById('msg'),
    primaryBtn: document.getElementById('primaryBtn'),
    cancelBtn: document.getElementById('cancelBtn')
  };

  // 传入参数
  const params = { tabId: null, tabUrl: '', code: '' };

  // 已有的授权记录（只在 init 里读一次，点击时直接用缓存，避免在 API 调用前 await）
  let record = null;
  // 'choose'（无 handle，首次授权） | 'confirm'（有 handle，权限掉了）
  let formMode = 'choose';
  // 参数缺失等无法继续的状态
  let blocked = false;
  let blockedReason = '';
  let busy = false;

  /* ---------- 参数解析 ---------- */

  // 手动拆 query，保证只做一次 decodeURIComponent（URLSearchParams 也会解码一次）
  function readParam(name) {
    const search = location.search.replace(/^\?/, '');
    if (!search) return '';
    const pairs = search.split('&');
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i];
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      let key;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch (e) {
        key = rawKey;
      }
      if (key !== name) continue;
      const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
      try {
        return decodeURIComponent(rawValue.replace(/\+/g, ' '));
      } catch (e) {
        return rawValue;
      }
    }
    return '';
  }

  function parseTabId(raw) {
    if (!raw) return null;
    const id = parseInt(raw, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  /* ---------- 路径工具（照抄 popup.js:47-63，勿改） ---------- */

  function getPathSegments(fileUrl) {
    try {
      const url = new URL(fileUrl);
      if (url.protocol !== 'file:') return [];
      return url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    } catch (e) {
      return [];
    }
  }

  // 目录前缀判定：段数必须比前缀多（前缀本身不是文件）
  function isInsideDirectory(fileUrl, rootPathSegments) {
    const segments = getPathSegments(fileUrl);
    if (!segments.length || !Array.isArray(rootPathSegments) || !rootPathSegments.length) return false;
    if (segments.length <= rootPathSegments.length) return false;
    for (let i = 0; i < rootPathSegments.length; i += 1) {
      if (segments[i] !== rootPathSegments[i]) return false;
    }
    return true;
  }

  function getAuthorizedRootSegments(fileUrl, rootName) {
    const segments = getPathSegments(fileUrl);
    if (!segments.length || !rootName) return null;
    const index = segments.lastIndexOf(rootName);
    if (index === -1) return null;
    return segments.slice(0, index + 1);
  }

  // 仅用于展示：取路径末两段
  function getFilePathLabel(fileUrl) {
    const segments = getPathSegments(fileUrl);
    if (!segments.length) return '';
    return segments.slice(-2).join(' / ');
  }

  /* ---------- IndexedDB（照抄 popup.js:16-45） ---------- */

  function openEditDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openEditDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await openEditDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /* ---------- 渲染 ---------- */

  function directoryName() {
    if (record && record.name) return String(record.name);
    if (record && record.handle && record.handle.name) return String(record.handle.name);
    return '';
  }

  function setMessage(text, kind) {
    els.msg.textContent = text || '';
    els.msg.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function render() {
    if (blocked) {
      els.title.textContent = '需要授权原型目录';
      els.desc.textContent = blockedReason;
      els.dirLabel.textContent = '当前文件';
      els.dirName.textContent = '—';
      els.dirName.title = '';
      els.primaryBtn.textContent = '选择目录';
      els.primaryBtn.disabled = true;
      return;
    }

    if (formMode === 'confirm') {
      const name = directoryName();
      els.title.textContent = '需要重新确认目录权限';
      els.desc.textContent = '权限已过期，确认后即可把修改保存到';
      els.dirLabel.textContent = '授权目录';
      els.dirName.textContent = name || '已授权目录';
      els.dirName.title = name;
      els.primaryBtn.textContent = '重新授权';
    } else {
      const label = getFilePathLabel(params.tabUrl);
      els.title.textContent = '需要授权原型目录';
      els.desc.textContent = '才能把修改保存到所选文件夹';
      els.dirLabel.textContent = '当前文件';
      els.dirName.textContent = label || '—';
      els.dirName.title = params.tabUrl;
      els.primaryBtn.textContent = '选择目录';
    }

    els.primaryBtn.disabled = busy || blocked;
    els.cancelBtn.disabled = busy;
  }

  /* ---------- 消息与关窗 ---------- */

  function notifyParent(payload) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      // file:// 直接打开本页时 chrome.runtime 不可用，静默降级
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        finish();
        return;
      }
      try {
        chrome.runtime.sendMessage(payload, () => {
          // 读取 lastError，避免控制台出现未处理的 "Unchecked runtime.lastError"
          void (chrome.runtime && chrome.runtime.lastError);
          finish();
        });
      } catch (e) {
        finish();
      }
      setTimeout(finish, 1500);
    });
  }

  async function complete(name) {
    setMessage('目录已授权，正在返回页面…', 'ok');
    busy = true;
    els.primaryBtn.disabled = true;
    els.cancelBtn.disabled = true;
    await notifyParent({
      type: 'AUTH_COMPLETED',
      ok: true,
      tabId: params.tabId,
      directoryName: name
    });
    window.close();
    // 正常情况下窗口已经关掉；若被浏览器拦下（例如本页被当普通标签页打开），恢复界面而不是卡死
    setTimeout(() => {
      if (window.closed) return;
      busy = false;
      render();
      setMessage('已授权，可直接关闭此窗口', 'ok');
    }, 500);
  }

  function describeError(e) {
    if (!e) return '未知错误';
    if (e.name === 'AbortError') return '已取消选择';
    if (e.name === 'NotAllowedError') return '未获得授权，可重试';
    if (e.name === 'SecurityError') return '当前页面不允许调用目录选择器，请在扩展窗口中重试';
    if (e.name === 'InvalidStateError') return '目录选择器正忙，请稍后重试';
    return e.message ? String(e.message) : String(e);
  }

  /* ---------- 两条授权路径 ---------- */

  // 路径一：已有 handle，重新确认权限（handle.requestPermission 必须在点击栈里）
  async function confirmPermission() {
    const handle = record && record.handle;
    if (!handle || typeof handle.requestPermission !== 'function') {
      // 记录不完整：降级为重新选目录，用户再点一次才会调 API
      formMode = 'choose';
      render();
      setMessage('授权记录无效，请重新选择目录', 'warn');
      return;
    }

    busy = true;
    render();
    setMessage('正在等待浏览器确认权限…');

    try {
      const permission = await handle.requestPermission({ mode: 'readwrite' });

      if (permission !== 'granted') {
        busy = false;
        render();
        setMessage('未获得目录写入权限，可重试或重新选择目录', 'error');
        return;
      }

      const name = directoryName();

      // 旧记录若缺 rootPathSegments（v2.0 之前写入的），用 tabUrl 补算一次
      let rootPathSegments = record.rootPathSegments;
      if (!Array.isArray(rootPathSegments) || !rootPathSegments.length) {
        rootPathSegments = getAuthorizedRootSegments(params.tabUrl, name);
      }

      // 关键改动：无论新旧记录，都校验「当前文件是否真的在这个目录里」。
      // 只确认权限不校验路径，就会出现「授权成功但依旧存不了」的死循环：
      // 失败 → 弹窗 → 重新授权 → 依然失败 → 再弹窗……
      if (!isInsideDirectory(params.tabUrl, rootPathSegments)) {
        busy = false;
        formMode = 'choose';
        render();
        setMessage('这个文件不在「' + name + '」里，请改选一个包含它的文件夹', 'warn');
        return;
      }

      // 记录不完整时（上面补算过）才需要回写
      if (!Array.isArray(record.rootPathSegments) || !record.rootPathSegments.length) {
        await idbSet(DIRECTORY_KEY, {
          handle: handle,
          name: name,
          rootPathSegments: rootPathSegments
        });
      }

      busy = false;
      await complete(name);
    } catch (e) {
      busy = false;
      render();
      setMessage('权限确认未完成：' + describeError(e), 'error');
    }
  }

  // 路径二：首次/更换目录（showDirectoryPicker 必须在点击栈里，此前不 await 任何东西）
  async function chooseDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
      setMessage('当前浏览器不支持目录授权，请使用 Chrome 桌面版', 'error');
      return;
    }

    busy = true;
    render();
    setMessage('请在系统窗口中选择原型所在的文件夹…');

    try {
      const handle = await window.showDirectoryPicker({
        id: 'prototype-annotator-root',
        mode: 'readwrite'
      });

      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        busy = false;
        render();
        setMessage('未获得目录写入权限，请重新选择目录', 'error');
        return;
      }

      // 关键：用传入的 tabUrl 算，不用本窗口地址
      const rootPathSegments = getAuthorizedRootSegments(params.tabUrl, handle.name);
      if (!rootPathSegments) {
        busy = false;
        render();
        setMessage('当前页面不在所选目录内，请选择包含该文件的文件夹', 'error');
        return;
      }

      await idbSet(DIRECTORY_KEY, {
        handle: handle,
        name: handle.name,
        rootPathSegments: rootPathSegments
      });

      busy = false;
      await complete(handle.name);
    } catch (e) {
      busy = false;
      render();
      if (e && e.name === 'AbortError') {
        setMessage('已取消目录选择，可重新点击按钮授权', 'warn');
      } else {
        setMessage('目录授权失败：' + describeError(e), 'error');
      }
    }
  }

  function handlePrimary() {
    if (busy || blocked) return;
    // 注意：这里不能在调 API 之前 await 任何异步操作，否则会丢掉用户手势
    const task = formMode === 'confirm' ? confirmPermission() : chooseDirectory();
    if (task && typeof task.catch === 'function') task.catch(() => {});
  }

  function tryClose() {
    window.close();
    setTimeout(() => {
      if (!window.closed) {
        setMessage('已取消，可直接关闭此窗口', 'info');
      }
    }, 350);
  }

  /* ---------- 初始化（只读状态，绝不调授权 API） ---------- */

  function reveal() {
    document.body.classList.remove('booting');
  }

  async function init() {
    params.tabUrl = readParam('tabUrl');
    params.tabId = parseTabId(readParam('tabId'));
    // 保存失败的具体原因，决定这次该给什么动作（重新授权 vs 换目录）
    params.code = readParam('code');

    if (!params.tabUrl || params.tabUrl.indexOf('file://') !== 0) {
      blocked = true;
      blockedReason = MSG_MISSING_URL;
      render();
      reveal();
      return;
    }
    if (!params.tabId) {
      blocked = true;
      blockedReason = MSG_NO_TAB_ID;
      render();
      reveal();
      return;
    }

    render();

    try {
      const existing = await idbGet(DIRECTORY_KEY);
      if (existing && existing.handle) {
        record = existing;
        formMode = 'confirm';
        if (!Array.isArray(existing.rootPathSegments) || !existing.rootPathSegments.length) {
          // 与 popup.js 一致：路径信息缺失时降级为「换目录」
          formMode = 'choose';
          setMessage('目录路径信息缺失，请重新选择目录', 'warn');
        } else if (params.code === 'PERMISSION_PROMPT_REQUIRED' || params.code === 'PERMISSION_DENIED') {
          setMessage('目录写入权限已过期，确认一下即可恢复', 'warn');
        } else if (!isInsideDirectory(params.tabUrl, existing.rootPathSegments)) {
          // 关键：当前文件不在已授权目录内。此时「重新授权」永远修不好，
          // 只有「换目录」能解决 —— 这是 OUTSIDE_DIRECTORY 死循环的正解。
          formMode = 'choose';
          setMessage('这个文件不在「' + (existing.name || '已授权目录') + '」里，请改选一个包含它的文件夹', 'warn');
        }
        render();
      }
    } catch (e) {
      setMessage('读取本地授权状态失败：' + describeError(e), 'error');
    } finally {
      reveal();
    }
  }

  els.primaryBtn.addEventListener('click', handlePrimary);
  els.cancelBtn.addEventListener('click', tryClose);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      tryClose();
    }
  });

  // 兜底：IndexedDB 打开被阻塞时不要让窗口一直空白
  setTimeout(reveal, 800);

  init();
})();
