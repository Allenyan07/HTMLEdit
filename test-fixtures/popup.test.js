// 页改笔 HTMLEdit — 扩展弹窗（popup）回归测试
//
// 运行：node test-fixtures/popup.test.js
// 依赖：本机 Google Chrome（--headless=new --dump-dom）
//
// 覆盖弹窗自己的显示逻辑（键位格式化已在 mode-race.test.js 覆盖）：
//   · 编辑 / 标注态显示对应的键位徽标
//   · 暂停态不显示键位徽标
//   · 报错/受限状态不显示键位徽标
//   · 弹窗按 background 回传的原样显示，不再自己套 mac 符号
//     （回归：曾出现 Windows 上把 Ctrl 显示成 ⌃）

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail += 1; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}

// 在弹窗页面里注入 chrome 桩 + 结果汇总脚本，然后无头跑一次
function buildHarness(dir, opts) {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  fs.copyFileSync(path.join(ROOT, 'popup.css'), path.join(dir, 'popup.css'));
  fs.copyFileSync(path.join(ROOT, 'popup.js'), path.join(dir, 'popup.js'));

  const stub = `
  <script>
  (function () {
    var q = new URLSearchParams(location.search);
    var MODE = q.get('mode') || 'edit';
    var HINTS = JSON.parse(q.get('hints') || '{"edit":"\\\\u2325Q","annotate":"\\\\u2325W","export":"\\\\u2325E"}');
    var AUTHORIZED = q.get('authorized') !== '0';
    var FILE_ACCESS = q.get('fileaccess') !== '0';
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          if (msg.type === 'GET_MODE') return cb({ active: MODE !== 'paused', mode: MODE, topLevelUrl: 'file:///Users/x/index.html' });
          if (msg.type === 'GET_EDIT_STATE') return cb({ count: 0, authorized: AUTHORIZED, directoryName: AUTHORIZED ? '01 产品经理' : '' });
          if (msg.type === 'GET_SHORTCUTS') return cb(HINTS);
          return cb({ success: true });
        },
        onMessage: { addListener() {} }
      },
      tabs: { query(q2, cb) { cb([{ id: 1, url: 'file:///Users/x/index.html' }]); }, sendMessage() {}, onUpdated: { addListener() {} } },
      storage: { local: { get(k, cb) { cb({}); }, set(o, cb) { cb && cb(); }, remove(k, cb) { cb && cb(); } } },
      extension: { isAllowedFileSchemeAccess(cb) { cb(FILE_ACCESS); } }
    };
  })();
  </script>
  <script>
  // 等弹窗自己的异步初始化跑完，再把结果写进一个可解析的节点
  setTimeout(function () {
    var el = document.getElementById('statusShortcut');
    var pre = document.createElement('pre');
    pre.id = '__popup__';
    pre.textContent = JSON.stringify({
      shortcutHidden: !!el.hidden,
      shortcutText: el.textContent || '',
      label: document.getElementById('statusLabel').textContent || '',
      activeBtn: (function () {
        var b = document.querySelector('.mode-btn.active');
        return b ? b.dataset.mode : '';
      })()
    });
    document.body.appendChild(pre);
  }, 500);
  </script>
`;

  const out = html.replace('  <script src="popup.js"></script>', stub + '  <script src="popup.js"></script>');
  fs.writeFileSync(path.join(dir, 'harness.html'), out);
  return path.join(dir, 'harness.html');
}

// 传入完整 URL（不要在这里再拼一次 file://，否则会变成 file://file:///…
// 而被 Chrome 当成非法地址、静默落到新标签页，测试只会看到一份无关的 DOM）
function run(url, profile) {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--disable-crashpad', '--disable-breakpad',
    '--user-data-dir=' + profile,
    '--window-size=320,420',
    '--virtual-time-budget=4000',
    '--dump-dom',
    url
  ];
  try {
    return execFileSync(CHROME, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (e.stdout && e.stdout.length) return e.stdout;
    throw e;
  }
}

function readResult(dom) {
  const m = /<pre id="__popup__">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) return null;
  const decoded = m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  try { return JSON.parse(decoded); } catch (e) { return null; }
}

console.log('\n[扩展弹窗回归] 无头 Chrome 渲染真实 popup.html + popup.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmledit-popup-'));
try {
  const page = buildHarness(dir, {});
  const cases = [
    { mode: 'edit', hints: { edit: '⌥Q', annotate: '⌥W', export: '⌥E' }, expectHidden: false, expectText: '⌥Q', name: '编辑态显示 ⌥Q' },
    { mode: 'annotate', hints: { edit: '⌥Q', annotate: '⌥W', export: '⌥E' }, expectHidden: false, expectText: '⌥W', name: '标注态显示 ⌥W' },
    { mode: 'paused', hints: { edit: '⌥Q', annotate: '⌥W', export: '⌥E' }, expectHidden: true, expectText: '', name: '暂停态不显示键位徽标' },
    // 关键回归：弹窗必须原样显示 background 给的键位，不得自己套 mac 符号
    { mode: 'edit', hints: { edit: 'Alt+Q', annotate: 'Alt+W', export: 'Alt+E' }, expectHidden: false, expectText: 'Alt+Q', name: 'Windows 键位原样显示（不套成 ⌥Q）' },
    { mode: 'annotate', hints: { edit: 'Alt+Q', annotate: 'Ctrl+Shift+A', export: 'Alt+E' }, expectHidden: false, expectText: 'Ctrl+Shift+A', name: 'Windows 组合键原样显示' },
    { mode: 'edit', hints: { edit: '', annotate: '', export: '' }, expectHidden: true, expectText: '', name: '快捷键未分配时不显示空徽标' }
  ];

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const url = 'file://' + page + '?mode=' + encodeURIComponent(c.mode) + '&hints=' + encodeURIComponent(JSON.stringify(c.hints));
    const dom = run(url, path.join(dir, 'p' + i));
    const r = readResult(dom);
    if (!r) { check(c.name, false, '页面没有产出结果，DOM 长度 ' + dom.length); if (process.env.DEBUG_DOM) fs.writeFileSync('/tmp/dom-' + i + '.html', dom); continue; }
    check(c.name, r.shortcutHidden === c.expectHidden && r.shortcutText === c.expectText,
      'hidden=' + r.shortcutHidden + ' text=' + JSON.stringify(r.shortcutText) + ' 状态文字=' + JSON.stringify(r.label));
  }

  // 受限状态也不该挂着键位
  {
    const url = 'file://' + page + '?mode=edit&fileaccess=0';
    const r = readResult(run(url, path.join(dir, 'pfa')));
    check('未开启文件访问权限时不显示键位徽标', r && r.shortcutHidden === true && r.shortcutText === '',
      r ? 'hidden=' + r.shortcutHidden + ' 状态文字=' + JSON.stringify(r.label) : '无结果');
  }
} finally {
  if (!process.env.KEEP_DIR) fs.rmSync(dir, { recursive: true, force: true }); else console.log("临时目录保留于: " + dir);
}

console.log('\n' + '─'.repeat(56));
if (fail) {
  console.log('❌ ' + fail + ' / ' + (pass + fail) + ' 项失败');
  process.exit(1);
}
console.log('✅ ' + pass + ' / ' + pass + ' 项通过');
