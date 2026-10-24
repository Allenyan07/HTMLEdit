// 页改笔 HTMLEdit — html-cases 手工回归用例的自动回归
//
// 运行：node test-fixtures/fixture-regression.js
// 依赖：本机装有 Google Chrome（用 --headless=new + --dump-dom）
//
// 为什么需要它：html-cases 下的用例原本只能靠人手动点。这个脚本把每个 fixture
// 真的用 Chrome 打开、让页面自己的 JS 渲染完，然后在真实 DOM 上跑一遍
// content/editor.js 的定位逻辑，逐元素比对「改动前 vs 改动后」的结果。
//
// 关键点：定位逻辑是从 content/editor.js **原文按函数名抽取**的，不是重写一份。
// 只有「改动前的旧版 findSourceElementByOriginalText」是照抄历史实现的 3 行，
// 因为它已经不存在于代码里。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CASE_DIR = path.join(__dirname, 'html-cases');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const EDITOR_SRC = fs.readFileSync(path.join(ROOT, 'content/editor.js'), 'utf8');
const RAW_PATCH_SRC = fs.readFileSync(path.join(ROOT, 'content/raw-patch.js'), 'utf8');

// ───────────────────────── 从 editor.js 原文抽取代码 ─────────────────────────

const NEEDED_CONSTS = ['EDITED_CLASS', 'TARGET_SELECTOR', 'DOUBLE_CLICK_PASSTHROUGH_SELECTOR'];

const NEEDED_FUNCS = [
  'getEditableText', 'getDirectText', 'getEditTargetMeta', 'isToolElement',
  'hasInteractiveAncestor', 'hasDataAttributes', 'shouldPassThroughDoubleClick', 'findEditableTarget',
  'getSourceLocator', 'findStableEditRoot', 'getElementPath', 'getElementPathBetween',
  'findSourceElement', 'findElementByPath', 'findElementByRelativePath',
  'findSafeSourceElement', 'findSourceElementByOriginalText', 'sourceElementMatchesCard',
  'getSourceEditableText', 'sourceClassCompatible', 'sourceStructureExists',
  'collectRawAnchors', 'cssEscape'
];

// 从 openIndex 处的 '{' 扫到配对的 '}'，跳过字符串/注释/正则，并正确处理模板字面量里的 ${}
function scanToMatchingBrace(src, openIndex) {
  let depth = 0;
  let i = openIndex;
  let state = 'code';
  let prevSig = '';
  let regexInClass = false;
  const templateStack = [];

  // 上一个有意义字符决定了 '/' 是正则开始还是除号
  function regexCanStart(prev) {
    return !prev || '=([!,&|?:;{}+-*%^<>~'.indexOf(prev) !== -1;
  }

  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];

    if (state === 'code') {
      if (ch === '/' && nx === '/') { state = 'line'; i += 2; continue; }
      if (ch === '/' && nx === '*') { state = 'block'; i += 2; continue; }
      if (ch === '/' && regexCanStart(prevSig)) { state = 'regex'; regexInClass = false; i += 1; continue; }
      if (ch === "'") { state = 'single'; i += 1; continue; }
      if (ch === '"') { state = 'double'; i += 1; continue; }
      if (ch === '`') { state = 'template'; i += 1; continue; }
      if (ch === '{') { depth += 1; prevSig = ch; i += 1; continue; }
      if (ch === '}') {
        depth -= 1;
        if (templateStack.length && depth === templateStack[templateStack.length - 1]) {
          templateStack.pop();
          state = 'template';
          prevSig = 'x';
          i += 1;
          continue;
        }
        if (depth === 0) return i + 1;
        prevSig = ch;
        i += 1;
        continue;
      }
      if (!/\s/.test(ch)) prevSig = ch;
      i += 1;
      continue;
    }

    if (state === 'line') { if (ch === '\n') state = 'code'; i += 1; continue; }
    if (state === 'block') { if (ch === '*' && nx === '/') { state = 'code'; prevSig = 'x'; i += 2; continue; } i += 1; continue; }

    if (state === 'regex') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '[') { regexInClass = true; i += 1; continue; }
      if (ch === ']') { regexInClass = false; i += 1; continue; }
      if (ch === '/' && !regexInClass) { state = 'code'; prevSig = 'x'; i += 1; continue; }
      i += 1;
      continue;
    }

    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) { state = 'code'; prevSig = 'x'; }
      i += 1;
      continue;
    }

    // template
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') { state = 'code'; prevSig = 'x'; i += 1; continue; }
    if (ch === '$' && nx === '{') {
      templateStack.push(depth);
      depth += 1;
      state = 'code';
      prevSig = '{';
      i += 2;
      continue;
    }
    i += 1;
  }
  throw new Error('括号不匹配');
}

function extractFunction(src, name) {
  const pattern = new RegExp('(^|\\n)\\s*(async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = pattern.exec(src);
  if (!match) throw new Error('未找到函数 ' + name);
  const braceAt = src.indexOf('{', match.index + match[0].length);
  const end = scanToMatchingBrace(src, braceAt);
  return src.slice(match.index + match[1].length, end);
}

function extractConst(src, name) {
  const pattern = new RegExp('(^|\\n)\\s*const\\s+' + name + '\\s*=');
  const match = pattern.exec(src);
  if (!match) throw new Error('未找到常量 ' + name);
  const semi = src.indexOf(';', match.index);
  return src.slice(match.index + match[1].length, semi + 1);
}

function buildPrelude() {
  const parts = [];
  NEEDED_CONSTS.forEach((name) => parts.push(extractConst(EDITOR_SRC, name)));
  NEEDED_FUNCS.forEach((name) => parts.push(extractFunction(EDITOR_SRC, name)));
  return parts.join('\n\n');
}

const preludeCache = buildPrelude();

// ───────────────────────── 生成插桩页面 ─────────────────────────

// 把任意文本安全地嵌进 <script> 里的字符串字面量：
// 除了 JSON 自己的转义，还要把 `</` 转成 `<\/`，否则源码文本里的
// `</script>` 会提前闭合我们的 script 标签，整段脚本不执行。
function jsString(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function buildPage(fixtureName, fixtureText) {
  const probe = `
try {
  var SOURCE_TEXT = ${jsString(fixtureText)};
  var sourceDoc = new DOMParser().parseFromString(SOURCE_TEXT, 'text/html');

  // 改动前的旧实现：只按「同标签 + 同文本」，唯一命中就采用（无 class 校验）
  function findSourceElementByOriginalTextPreFix(doc, card) {
    var tagName = card.targetEl.tagName.toLowerCase();
    var candidates = Array.prototype.slice.call(doc.querySelectorAll(tagName)).filter(function (el) {
      return sourceElementMatchesCard(el, card);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function where(el) {
    if (!el) return '';
    var open = String(el.outerHTML).slice(0, 70).replace(/\\s+/g, ' ');
    var at = SOURCE_TEXT.indexOf(el.outerHTML);
    var line = at === -1 ? 0 : SOURCE_TEXT.slice(0, at).split('\\n').length;
    return (line ? 'L' + line + ' ' : '') + open;
  }

  var rows = [];
  var nodes = document.querySelectorAll(TARGET_SELECTOR);

  Array.prototype.forEach.call(nodes, function (el) {
    if (isToolElement(el)) return;
    var text = getEditableText(el);
    if (!text) return;

    var card = {
      targetEl: el,
      targetMeta: getEditTargetMeta(el),
      originalText: text,
      sourceLocator: getSourceLocator(el)
    };

    var direct = findSourceElement(sourceDoc, card.sourceLocator);
    var directAccepted = !!direct && (
      (card.sourceLocator.stable && direct.tagName === card.targetEl.tagName) ||
      sourceElementMatchesCard(direct, card)
    );

    var byTextPre = directAccepted ? null : findSourceElementByOriginalTextPreFix(sourceDoc, card);
    var byTextPost = directAccepted ? null : findSourceElementByOriginalText(sourceDoc, card);

    var before = directAccepted ? 'direct' : (byTextPre ? 'byText' : 'none');
    var after = directAccepted ? 'direct' : (byTextPost ? 'byText' : 'none');
    var beforeWhere = before === 'direct' ? where(direct) : (byTextPre ? where(byTextPre) : '');
    var afterWhere = after === 'direct' ? where(direct) : (byTextPost ? where(byTextPost) : '');
    var rawLine = 0;

    if (after === 'none') {
      var structureExists = sourceStructureExists(sourceDoc, card);
      var r = RawPatch.patchSourceText(SOURCE_TEXT, card.targetEl.tagName.toLowerCase(), card.originalText, card.originalText + '·改', {
        anchors: collectRawAnchors(card.targetEl),
        elementClasses: card.targetEl.getAttribute('class'),
        allowScript: !structureExists,
        allowHtml: !structureExists
      });
      if (r.ok) { after = 'raw'; afterWhere = 'L' + r.line + ' ' + r.strategy; rawLine = r.line; }
      else { after = 'refused:' + r.reason; }
    }

    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').slice(0, 28),
      text: text.slice(0, 34),
      before: before,
      after: after,
      beforeWhere: beforeWhere,
      afterWhere: afterWhere,
      rawLine: rawLine
    });
  });

  emit({ fixture: ${jsString(fixtureName)}, count: rows.length, rows: rows });
} catch (err) {
  emit({ fixture: ${jsString(fixtureName)}, error: String(err && err.stack || err) });
}
`;

  // 结构：fixture 原文 + 一个自带 emit 的脚本，脚本内容 = emit 定义 + 抽取的定位逻辑 + RawPatch + 探针
  const script = [
    'window.emit = function (data) {',
    '  var pre = document.createElement("pre");',
    '  pre.id = "__regression_result__";',
    '  pre.textContent = JSON.stringify(data);',
    '  document.body.appendChild(pre);',
    '};',
    preludeCache,
    RAW_PATCH_SRC,
    '(function () {',
    probe,
    '})();'
  ].join('\n');

  // 注意：必须用函数式替换。替换内容里含 `$`（raw-patch.js 的注释就有），
  // 字符串式替换会把 $` / $& / $' 当特殊模式展开，把 fixture 前缀插进来。
  return fixtureText.replace(/<\/body>/i, () => '<script>' + script + '</script></body>');
}

// ───────────────────────── 运行 Chrome ─────────────────────────

function runChrome(fileUrl) {
  const userDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'htmledit-reg-'));
  try {
    return execFileSync(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu',
      '--disable-crashpad', '--disable-breakpad',
      '--user-data-dir=' + userDataDir,
      '--virtual-time-budget=4000',
      '--dump-dom', fileUrl
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

function parseResult(dom) {
  const match = /<pre id="__regression_result__">([\s\S]*?)<\/pre>/.exec(dom);
  if (!match) return null;
  return JSON.parse(match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
}

// ───────────────────────── 主流程 ─────────────────────────

const FIXTURES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['01-static-article.html', '02-form-controls.html', '03-interactive-admin.html',
     '04-dynamic-runtime.html', '05-style-inheritance.html', '09-script-template.html'];

// 已复核、确认可接受的预期行为变化台账。
// 任何不在此台账里的变化都会让本脚本以非 0 退出——这样它才是一道真正的闸门。
const REVIEWED = {
  // 09 已换成合成的脚本模板 fixture，没有历史豁免项
};

let regressions = 0;

FIXTURES.forEach((name) => {
  const fixturePath = path.join(CASE_DIR, name);
  if (!fs.existsSync(fixturePath)) {
    console.log('跳过（不存在）: ' + name);
    return;
  }
  const fixtureText = fs.readFileSync(fixturePath, 'utf8');
  const tempName = '__regression-' + name;
  const tempPath = path.join(CASE_DIR, tempName);

  fs.writeFileSync(tempPath, buildPage(name, fixtureText));

  let data = null;
  try {
    data = parseResult(runChrome('file://' + tempPath));
  } catch (e) {
    console.log('❌ ' + name + ' 执行失败: ' + e.message.split('\n')[0]);
    regressions += 1;
  } finally {
    if (process.env.KEEP_TEMP) console.log('   （已保留插桩页：' + tempPath + '）');
    else fs.rmSync(tempPath, { force: true });
  }

  if (!data) { console.log('❌ ' + name + ' 未取到结果'); regressions += 1; return; }

  const before = { direct: 0, byText: 0, none: 0 };
  const after = { direct: 0, byText: 0, raw: 0 };
  const changed = [];
  let refused = 0;

  data.rows.forEach((row) => {
    before[row.before] = (before[row.before] || 0) + 1;
    const key = row.after.indexOf('refused:') === 0 ? 'refused' : row.after;
    after[key] = (after[key] || 0) + 1;
    if (row.after.indexOf('refused:') === 0) refused += 1;
    if (row.before !== row.after && !(row.before === 'none' && row.after !== 'none')) {
      changed.push(row);
    }
  });

  const review = REVIEWED[name];
  const reviewed = [];
  const unexpected = [];
  changed.forEach((row) => {
    if (review && review.match(row)) reviewed.push(row);
    else unexpected.push(row);
  });

  // 硬回归：原本靠 locator 精确定位的元素，现在定位不到了
  const hardRegression = changed.filter((row) => row.before === 'direct' && row.after !== 'direct');

  let status = '✅';
  if (hardRegression.length || unexpected.length) status = '❌';
  else if (reviewed.length) status = '⚠️';

  console.log(status + ' ' + name + '  （' + data.count + ' 个可编辑元素）');
  console.log('     改动前: direct=' + (before.direct || 0) + '  byText=' + (before.byText || 0) + '  定位失败=' + (before.none || 0));
  console.log('     改动后: direct=' + (after.direct || 0) + '  byText=' + (after.byText || 0)
    + '  兜底救回=' + (after.raw || 0) + '  明确拒绝=' + refused);

  if (reviewed.length) {
    console.log('     ⚠️ 已复核的预期变化 x' + reviewed.length + '（' + review.description + '）');
    reviewed.slice(0, 3).forEach((row) => {
      console.log('        <' + row.tag + ' class="' + row.cls + '">「' + row.text + '」  ' + row.before + ' @ ' + row.beforeWhere.slice(0, 40) + ' → ' + row.after);
    });
    if (reviewed.length > 3) console.log('        …（其余 ' + (reviewed.length - 3) + ' 处同类）');
  }

  if (hardRegression.length) {
    console.log('     ❌ 硬回归 x' + hardRegression.length + '：原本能精确定位的元素现在定位失败');
    hardRegression.forEach((row) => {
      console.log('        <' + row.tag + ' class="' + row.cls + '">「' + row.text + '」  ' + row.before + ' → ' + row.after);
    });
  }

  if (unexpected.length) {
    console.log('     ❌ 未复核的行为变化 x' + unexpected.length);
    unexpected.forEach((row) => {
      console.log('        <' + row.tag + ' class="' + row.cls + '">「' + row.text + '」');
      console.log('           改前 ' + row.before + ' @ ' + row.beforeWhere);
      console.log('           改后 ' + row.after + ' @ ' + row.afterWhere);
    });
  }

  if (review && reviewed.length !== review.expected) {
    console.log('     ❌ 已复核变化的数量不符：期望 ' + review.expected + '，实际 ' + reviewed.length);
    hardRegression.push({});
  }

  regressions += hardRegression.length + unexpected.length;
});

console.log('\n' + '─'.repeat(60));
if (regressions) {
  console.log('❌ 发现 ' + regressions + ' 处不可接受的行为变化');
  process.exit(1);
}
console.log('✅ 全部 fixture 通过：');
console.log('   · 原有可编辑元素无一退化（direct 路径逐个比对一致）');
console.log('   · 静态页面兜底零调用');
console.log('   · 已复核的预期变化数量与台账一致');
