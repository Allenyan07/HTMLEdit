// 页改笔 HTMLEdit — v2.1.0 接线集成测试驱动
//
// 运行：node test-fixtures/wiring.test.js
// 依赖：本机 Google Chrome（用 --headless=new + --dump-dom）
//
// 为什么需要它：Chrome 155 已移除 --load-extension，无法用命令行真机加载扩展。
// 所以这里用「chrome API 桩 + 真实 content script」在无头浏览器里跑一遍接线，
// 验证的是 content 侧的真实代码（不是复制一份实现）：
//   - content.js 是否真的 mount 了胶囊
//   - 点胶囊三段是否真的发出 SET_MODE 并等 MODE_CHANGED 后生效
//   - chrome.commands.getAll 的键位是否真的显示到胶囊上
//   - ⌥E 的 EXPORT_ANNOTATIONS 是否转发到 Panel
//   - 编辑态未授权是否显示小黄点
//   - MODE_SWITCH_FAILED 是否弹出页面内 toast
//   - 暂停是否销毁面板；面板展开是否让胶囊左移
//
// background.js 的行为由 wiring.html 里的桩模拟，所以本测试不覆盖后台内部逻辑。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(__dirname, 'wiring.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function run() {
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'htmledit-wiring-'));
  const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--disable-crashpad', '--disable-breakpad',
      '--user-data-dir=' + profile,
      '--window-size=1200,800',
      '--virtual-time-budget=6000',
    '--dump-dom',
    'file://' + PAGE
  ];
  try {
    return execFileSync(CHROME, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // 该页面会在收尾阶段让 Chrome 的 teardown watchdog 超时（退出码非 0），
    // 但 --dump-dom 的内容此时已经完整产出。只要 DOM 在，就不算失败。
    if (e.stdout && e.stdout.length) return e.stdout;
    throw e;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

function decode(html) {
  return html
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

console.log('\n[接线集成测试] 真实 content script + chrome API 桩，无头 Chrome');

let dom;
try {
  dom = run();
} catch (e) {
  console.error('❌ 无法启动 Chrome: ' + e.message.split('\n')[0]);
  process.exit(1);
}

const m = /<pre id="__wiring__">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) {
  console.error('❌ 页面没有产出结果 —— 内容脚本可能在加载/初始化阶段就抛错了');
  console.error('   （Chrome 155 下无法用 --load-extension 复现，这里只能桩测）');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(decode(m[1]));
} catch (e) {
  console.error('❌ 结果不是合法 JSON: ' + e.message);
  process.exit(1);
}

let failed = 0;
data.results.forEach((r) => {
  console.log('  ' + (r.pass ? '✓' : '✗') + ' ' + r.name + (r.detail ? '  [' + r.detail + ']' : ''));
  if (!r.pass) failed += 1;
});

console.log('\n' + '─'.repeat(56));
if (failed) {
  console.log('❌ ' + failed + ' / ' + data.results.length + ' 项失败');
  const errs = (data.log || []).filter((l) => l.dir === 'listener-error');
  if (errs.length) {
    console.log('消息监听器抛错:');
    errs.forEach((e) => console.log('  - ' + e.msg));
  }
  process.exit(1);
}
console.log('✅ ' + data.results.length + ' / ' + data.results.length + ' 项通过');
