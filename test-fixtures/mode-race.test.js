// 页改笔 HTMLEdit — 后台逻辑回归测试（vm 直接驱动真实 background.js）
//
// 运行：node test-fixtures/mode-race.test.js
//
// 为什么需要它：wiring.test.js 用的是自己写的假后台，完全没覆盖 background.js
// 的真实逻辑（状态读写、竞态、授权就绪判定）。这里用 vm 加载真实 background.js，
// 只把它依赖的 chrome API 换成桩，于是可以精确控制时序。
//
// 覆盖：
//   · 快捷键竞态（连按 ⌥Q → ⌥W，最后一次意图必须胜出）
//   · 过期请求作废（SUPERSEDED），且不向用户报错
//   · 后台被回收后 editCount 不被清零（Blocker 1 回归）
//   · getEditReadiness 的三查（无目录 / 路径外 / 就绪）

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'background.js');
const TAB_ID = 1;
const TAB_URL = 'file:///Users/x/proto/index.html';

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : ''));
  } else {
    fail += 1;
    console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── 环境搭建 ─────────────────────────
function makeEnv(options) {
  const opts = options || {};
  const sent = [];              // 广播给页面的消息
  const store = {};             // chrome.storage.local
  const msgListeners = [];
  const cmdListeners = [];
  const icons = [];

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (f) => msgListeners.push(f) },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage() {},
      getPlatformInfo(cb) { cb({ os: opts.os || 'mac' }); }
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          (keys || []).forEach((k) => { if (k in store) out[k] = store[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
        remove(keys, cb) { (keys || []).forEach((k) => delete store[k]); if (cb) cb(); }
      }
    },
    action: { setIcon(o) { icons.push(o); return Promise.resolve(); } },
    tabs: {
      query(q, cb) { cb([{ id: TAB_ID, url: TAB_URL }]); },
      get(id, cb) { cb({ id: id, url: TAB_URL }); },
      // 两种签名：sendMessage(id, msg, cb) 与 sendMessage(id, msg, {frameId}, cb)
      sendMessage(id, msg, optsOrCb, maybeCb) {
        const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        if (msg && msg.type === 'PING') { if (cb) cb({ pong: true }); return; }
        if (msg && msg.type === 'MODE_CHANGED') sent.push(msg.mode);
        if (typeof cb === 'function') cb({});
      },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    webNavigation: {
      onCommitted: { addListener() {} },
      onHistoryStateUpdated: { addListener() {} },
      // sendMessageToAllFrames 靠它枚举帧；这里只给顶层帧
      getAllFrames(o, cb) { cb([{ frameId: 0, url: TAB_URL }]); }
    },
    commands: {
      onCommand: { addListener: (f) => cmdListeners.push(f) },
      // 默认返回 manifest 里的 suggested_key（与真实安装后一致）
      getAll(cb) {
        cb([
          { name: 'mode-edit', shortcut: 'Alt+Q' },
          { name: 'mode-annotate', shortcut: 'Alt+W' },
          { name: 'export-annotations', shortcut: 'Alt+E' }
        ]);
      }
    },
    windows: { create() { return Promise.resolve({ id: 99 }); } },
    scripting: {
      executeScript(o, cb) { if (cb) cb([]); },
      insertCSS(o, cb) { if (cb) cb(); }
    }
  };

  const ctx = {
    chrome, console, setTimeout, clearTimeout, setInterval, clearInterval,
    URL, Promise, Date, Math, JSON, btoa, atob, indexedDB: undefined
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);

  // 注入是整条链里最慢的一步，也是竞态窗口所在。
  // 关键：真实竞态来自「时序不对称」——第一次按键触发脚本注入（慢），
  // 第二次按键发现脚本已就绪（快）。于是第二次先写入，第一次再带着旧值覆盖它。
  // 若把两次都设成同样慢，靠时序会「恰好」得到正确结果，测试就变成假断言。
  let injCalls = 0;
  const delays = opts.injectionDelays || [60];
  ctx.ensureContentScriptsInjected = () =>
    new Promise((r) => {
      const d = delays[Math.min(injCalls, delays.length - 1)];
      injCalls += 1;
      setTimeout(() => r(opts.injectionFails ? false : true), d);
    });

  // 让 editCount 的初始状态可预置
  if (opts.preStorage) Object.assign(store, opts.preStorage);

  return { ctx, sent, store, msgListeners, cmdListeners, icons };
}

function fireCommand(env, name) {
  env.cmdListeners.forEach((f) => f(name));
}

function getMode(env) {
  return new Promise((resolve) => {
    env.msgListeners.forEach((f) =>
      f({ type: 'GET_MODE', tabId: TAB_ID }, { tab: { id: TAB_ID } }, resolve));
  });
}

function sendMessage(env, msg) {
  return new Promise((resolve) => {
    env.msgListeners.forEach((f) =>
      f(Object.assign({ tabId: TAB_ID }, msg), { tab: { id: TAB_ID } }, resolve));
  });
}

const MODE_KEY = 'proto_mode_' + TAB_ID;

// ───────────────────────── 用例 ─────────────────────────
(async function main() {
  console.log('\n[后台回归] vm 驱动真实 background.js');

  /* 1. 竞态：同一 tick 连按 ⌥Q 再 ⌥W —— 最后一次意图必须胜出
   * 注入延迟 [200, 5]：第一次慢（要注入脚本）、第二次快（已就绪），
   * 这正是「先写的被后写的旧值覆盖」的成因。 */
  {
    const env = makeEnv({ injectionDelays: [200, 5] });
    fireCommand(env, 'mode-edit');
    fireCommand(env, 'mode-annotate');
    await wait(400);
    const mode = await getMode(env);
    check('同 tick 连按 ⌥Q→⌥W，最终为标注（最后一次胜出）',
      mode.mode === 'annotate', '最终 ' + mode.mode);
    check('落盘的也是标注', env.store[MODE_KEY] && env.store[MODE_KEY].mode === 'annotate',
      env.store[MODE_KEY] && env.store[MODE_KEY].mode);
    const last = env.sent[env.sent.length - 1];
    check('最后一次模式广播是标注（不会先标注后编辑）', last === 'annotate',
      JSON.stringify(env.sent));
  }

  /* 2. 竞态：间隔 40ms（注入尚未返回）连按 ⌥Q → ⌥W */
  {
    const env = makeEnv({ injectionDelays: [200, 5] });
    fireCommand(env, 'mode-edit');
    await wait(40);
    fireCommand(env, 'mode-annotate');
    await wait(400);
    const mode = await getMode(env);
    check('注入窗口内连按（间隔 40ms），最终为标注', mode.mode === 'annotate', '最终 ' + mode.mode);
    check('没有过期的编辑广播盖在后面',
      env.sent.lastIndexOf('edit') < env.sent.lastIndexOf('annotate'),
      JSON.stringify(env.sent));
  }

  /* 3. 对照组：单按 ⌥Q 正常生效 */
  {
    const env = makeEnv();
    fireCommand(env, 'mode-edit');
    await wait(300);
    const mode = await getMode(env);
    check('单按 ⌥Q 切到编辑（对照组）', mode.mode === 'edit', '最终 ' + mode.mode);
  }

  /* 4. 再按一次回暂停 */
  {
    const env = makeEnv();
    fireCommand(env, 'mode-edit');
    await wait(300);
    fireCommand(env, 'mode-edit');
    await wait(300);
    const mode = await getMode(env);
    check('已在编辑时再按 ⌥Q 回到暂停', mode.mode === 'paused', '最终 ' + mode.mode);
  }

  /* 5. 过期请求不应给用户弹“切换失败” */
  {
    const env = makeEnv();
    fireCommand(env, 'mode-edit');
    fireCommand(env, 'mode-annotate');
    await wait(400);
    const failed = env.sent.filter((m) => m === 'MODE_SWITCH_FAILED').length;
    check('过期请求不向用户报“切换失败”', failed === 0, 'MODE_SWITCH_FAILED × ' + failed);
  }

  /* 6. Blocker 1 回归：后台被回收后 editCount 不被清零 */
  {
    const env = makeEnv();
    await sendMessage(env, { type: 'SET_MODE', mode: 'edit', active: true });
    await sendMessage(env, { type: 'EDIT_STATE_CHANGED', delta: 6 });
    await wait(120);
    check('编辑计数累加到 6', env.store[MODE_KEY].editCount === 6, String(env.store[MODE_KEY].editCount));

    // 模拟 service worker 被回收：清掉内存状态，storage 保留
    const env2 = makeEnv({ preStorage: JSON.parse(JSON.stringify(env.store)) });
    await sendMessage(env2, { type: 'EDIT_STATE_CHANGED', delta: 1 });
    await wait(120);
    const st = env2.store[MODE_KEY];
    check('后台回收后收到保存回执，模式仍是编辑', st.mode === 'edit' && st.active === true,
      JSON.stringify(st));
    check('后台回收后编辑计数不清零（6 → 7）', st.editCount === 7, String(st.editCount));
  }

  /* 7. 后台回收后暂停「不应」清零计数 */
  {
    const env = makeEnv();
    await sendMessage(env, { type: 'SET_MODE', mode: 'edit', active: true });
    await sendMessage(env, { type: 'EDIT_STATE_CHANGED', delta: 3 });
    await wait(120);
    const env2 = makeEnv({ preStorage: JSON.parse(JSON.stringify(env.store)) });
    await sendMessage(env2, { type: 'SET_MODE', mode: 'paused', active: false });
    await wait(150);
    check('后台回收后暂停，编辑计数保留（3）', env2.store[MODE_KEY].editCount === 3,
      String(env2.store[MODE_KEY].editCount));
    check('暂停后 mode 落盘为 paused（不是 off）', env2.store[MODE_KEY].mode === 'paused',
      env2.store[MODE_KEY].mode);
  }

  /* 8. getEditReadiness：三查 */
  {
    const env = makeEnv();
    ctxStubDirectory(env, null);
    let r = await sendMessage(env, { type: 'GET_EDIT_READINESS', fileUrl: TAB_URL });
    check('无目录记录 → NO_DIRECTORY / choose', r.code === 'NO_DIRECTORY' && r.remedy === 'choose',
      r.code + ' / ' + r.remedy);
  }
  {
    const env = makeEnv();
    ctxStubDirectory(env, {
      handle: { name: 'proto', queryPermission: async () => 'granted' },
      name: 'proto',
      rootPathSegments: ['Users', 'x', 'other']
    });
    const r = await sendMessage(env, { type: 'GET_EDIT_READINESS', fileUrl: TAB_URL });
    check('文件不在已授权目录内 → OUTSIDE_DIRECTORY', r.code === 'OUTSIDE_DIRECTORY', r.code);
  }
  {
    const env = makeEnv();
    ctxStubDirectory(env, {
      handle: { name: 'proto', queryPermission: async () => 'granted' },
      name: 'proto',
      rootPathSegments: ['Users', 'x', 'proto']
    });
    const r = await sendMessage(env, { type: 'GET_EDIT_READINESS', fileUrl: TAB_URL });
    check('权限有 + 路径在内 → READY', r.code === 'READY' && r.ready === true, r.code);
  }

  /* 9. 授权窗口一律用顶层标签页 URL（修 iframe 绑错路径） */
  {
    const env = makeEnv();
    let openedUrl = null;
    env.ctx.chrome.windows.create = (o) => { openedUrl = o.url; return Promise.resolve({ id: 9 }); };
    await sendMessage(env, {
      type: 'REQUEST_AUTH',
      tabUrl: 'file:///Users/x/proto/sub/detail.html',   // 假装来自 iframe
      code: 'OUTSIDE_DIRECTORY'
    });
    await wait(60);
    const hasTop = openedUrl && openedUrl.indexOf(encodeURIComponent(TAB_URL)) !== -1;
    const hasFrame = openedUrl && openedUrl.indexOf(encodeURIComponent('sub/detail.html')) !== -1;
    check('REQUEST_AUTH 忽略 frame URL，改用顶层 tab URL', hasTop && !hasFrame,
      openedUrl ? decodeURIComponent(openedUrl) : 'n/a');
    check('并把失败原因 code 带给授权窗',
      openedUrl && openedUrl.indexOf('OUTSIDE_DIRECTORY') !== -1, openedUrl || 'n/a');
  }

  /* 10. 键位按平台格式化 */
  {
    const mac = await sendMessage(makeEnv({ os: 'mac' }), { type: 'GET_SHORTCUTS' });
    check('macOS：Alt+Q → ⌥Q（符号、无加号）',
      mac.edit === '⌥Q' && mac.annotate === '⌥W' && mac.export === '⌥E' && mac.isMac === true,
      JSON.stringify(mac));

    const win = await sendMessage(makeEnv({ os: 'win' }), { type: 'GET_SHORTCUTS' });
    check('Windows：Alt+Q 保持 Alt+Q（英文名、带加号）',
      win.edit === 'Alt+Q' && win.annotate === 'Alt+W' && win.export === 'Alt+E' && win.isMac === false,
      JSON.stringify(win));
  }
  {
    const env = makeEnv({ os: 'win' });
    env.ctx.chrome.commands.getAll = (cb) => cb([
      { name: 'mode-edit', shortcut: 'Ctrl+Shift+Y' },
      { name: 'mode-annotate', shortcut: 'Ctrl+Alt+A' },
      { name: 'export-annotations', shortcut: 'Command+E' }
    ]);
    const r = await sendMessage(env, { type: 'GET_SHORTCUTS' });
    check('Windows：Ctrl+Shift 显示为英文名', r.edit === 'Ctrl+Shift+Y' && r.annotate === 'Ctrl+Alt+A',
      r.edit + ' / ' + r.annotate);
    check('Windows：Command 显示为 Win', r.export === 'Win+E', r.export);
  }
  {
    const env = makeEnv({ os: 'mac' });
    env.ctx.chrome.commands.getAll = (cb) => cb([
      { name: 'mode-edit', shortcut: 'Ctrl+Shift+Y' },
      { name: 'mode-annotate', shortcut: 'Ctrl+Alt+A' },
      { name: 'export-annotations', shortcut: 'Command+E' }
    ]);
    const r = await sendMessage(env, { type: 'GET_SHORTCUTS' });
    // Apple HIG 的修饰键顺序是 ⌃ ⌥ ⇧ ⌘，所以 Ctrl+Shift+Y 应显示为 ⌃⇧Y
    check('macOS：修饰键按 HIG 顺序排列（Ctrl+Shift+Y → ⌃⇧Y）', r.edit === '⌃⇧Y', r.edit);
    check('macOS：Ctrl+Alt+A → ⌃⌥A', r.annotate === '⌃⌥A', r.annotate);
    check('macOS：Command 显示为 ⌘', r.export === '⌘E', r.export);
  }
  {
    const env = makeEnv({ os: 'mac' });
    env.ctx.chrome.commands.getAll = (cb) => cb([
      { name: 'mode-edit', shortcut: '' },
      { name: 'mode-annotate', shortcut: '' },
      { name: 'export-annotations', shortcut: '' }
    ]);
    const r = await sendMessage(env, { type: 'GET_SHORTCUTS' });
    check('Chrome 未分配快捷键时回传空串（界面显示“未分配”而非假键位）',
      r.edit === '' && r.annotate === '' && r.export === '', JSON.stringify(r));
  }

  console.log('\n' + '─'.repeat(56));
  if (fail) {
    console.log('❌ ' + fail + ' / ' + (pass + fail) + ' 项失败');
    process.exit(1);
  }
  console.log('✅ ' + pass + ' / ' + pass + ' 项通过');

  // 把授权记录写进 storage 的辅助（走真实 openEditDb 太重，这里直接预置 storage 缓存）
  function ctxStubDirectory(env, record) {
    env.ctx.getEditDirectoryData = () => Promise.resolve(record);
  }
})().catch((e) => {
  console.error('❌ 测试自身出错: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
