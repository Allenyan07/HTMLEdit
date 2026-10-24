// 页改笔 HTMLEdit — 源文件字面量回填（RawPatch）单元测试
//
// 运行：node test-fixtures/raw-patch.test.js
//
// 与 path-resolution.test.js 不同，这里不复制实现：直接加载真实的
// content/raw-patch.js，并用真实的 fixture 文件做断言。
//
// 覆盖：安全闸门 / 真实命中 / 平局裁决 / 正确拒绝 / P0-02 不回归 / 静态页面不受影响

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RawPatch = new Function(
  fs.readFileSync(path.join(ROOT, 'content/raw-patch.js'), 'utf8') + '\nreturn RawPatch;'
)();

const CASE_DIR = path.join(__dirname, 'html-cases');
const FIXTURE_09 = fs.readFileSync(path.join(CASE_DIR, '09-script-template.html'), 'utf8');
const FIXTURE_04 = fs.readFileSync(path.join(CASE_DIR, '04-dynamic-runtime.html'), 'utf8');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (e) {
    failures.push({ name: name, error: e });
    console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]);
  }
}

function scriptBlocks(html) {
  return Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)).map((m) => m[1]);
}

function countOf(html, re) {
  return (html.match(re) || []).length;
}

console.log('\n[1] 安全闸门');
check('空新文本被拒（EMPTY）', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', '   ');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'EMPTY');
});

check('含单引号的新文本被拒（UNSAFE_CHAR）', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', "it's");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'UNSAFE_CHAR');
});

check('含反引号/反斜杠/尖括号的新文本一律被拒', () => {
  ['a`b', 'a\\b', 'a<b', 'a>b', 'a"b'].forEach((bad) => {
    const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', bad);
    assert.strictEqual(r.ok, false, '应拒绝: ' + bad);
    assert.strictEqual(r.reason, 'UNSAFE_CHAR', '应拒绝: ' + bad);
  });
});

check('非法标签名被拒（BAD_TAG）', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button"onload', '停用', '新文案');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'BAD_TAG');
});

check('低信息量文本被拒（LOW_INFORMATION）', () => {
  ['—', '0', '1', '0/0', '33.73', '2026-10-13'].forEach((low) => {
    const r = RawPatch.patchSourceText(FIXTURE_09, 'td', low, '新文案');
    assert.strictEqual(r.ok, false, '应拒绝: ' + low);
    assert.strictEqual(r.reason, 'LOW_INFORMATION', '应拒绝: ' + low);
  });
});

check('单字符文本被拒（LOW_INFORMATION）', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'span', '新', '最新');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'LOW_INFORMATION');
});

console.log('\n[2] 脚本模板 fixture 命中（09-script-template.html）');

// 这些文案在源文件里是 <script> 内的模板字面量，与实测行号一一对应
const HITS = [
  { tag: 'button', text: '停用', line: 72, strategy: 'literal-script' },
  { tag: 'button', text: '详情', line: 67, strategy: 'literal-script' },
  { tag: 'button', text: '费用明细', line: 68, strategy: 'literal-script' },
  { tag: 'button', text: '查看日志', line: 69, strategy: 'literal-script' },
  { tag: 'button', text: '认领记录', line: 70, strategy: 'literal-script' },
  { tag: 'button', text: '启用', line: 71, strategy: 'literal-script' },
  { tag: 'button', text: '删除', line: 85, strategy: 'literal-script' },
  { tag: 'button', text: '复制', line: 84, strategy: 'literal-script' },
  { tag: 'button', text: '发布', line: 86, strategy: 'literal-script' },
  { tag: 'button', text: '撤销', line: 87, strategy: 'literal-script' }
];

HITS.forEach((hit) => {
  check('命中「' + hit.text + '」→ 第 ' + hit.line + ' 行', () => {
    const r = RawPatch.patchSourceText(FIXTURE_09, hit.tag, hit.text, hit.text + '改');
    assert.strictEqual(r.ok, true, '应命中，实际: ' + r.reason);
    assert.strictEqual(r.line, hit.line);
    assert.strictEqual(r.strategy, hit.strategy);
  });
});

check('静态 HTML 元素文本走模式 A，strategy=literal-tag', () => {
  const src = '<html><body><p>静态段落文本</p></body></html>';
  const r = RawPatch.patchSourceText(src, 'p', '静态段落文本', '改后的段落');
  assert.strictEqual(r.ok, true, '应命中，实际: ' + r.reason);
  assert.strictEqual(r.strategy, 'literal-tag');
  assert.strictEqual(r.html, '<html><body><p>改后的段落</p></body></html>');
});

check('回填结果只改一行，且内容正确', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', '停用该项');
  assert.strictEqual(r.ok, true);
  const before = FIXTURE_09.split('\n');
  const after = r.html.split('\n');
  assert.strictEqual(before.length, after.length, '不应增删行');
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  assert.strictEqual(changed, 1, '只能改 1 行，实际 ' + changed);
  assert.ok(after[71].indexOf('>停用该项</button>') !== -1, '替换结果应正确');
});

check('回填后 <script> 数量不变且语法仍可执行', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', '停用该项');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(countOf(r.html, /<script\b/gi), countOf(FIXTURE_09, /<script\b/gi));
  assert.strictEqual(countOf(r.html, /<\/script\s*>/gi), countOf(FIXTURE_09, /<\/script\s*>/gi));
  scriptBlocks(r.html).forEach((code) => {
    new Function(code); // 语法错误会抛
  });
});

console.log('\n[3] 平局裁决（同文案多候选时用 onclick 等属性值区分）');

check('「编辑」无 anchors 时拒绝（AMBIGUOUS），候选为 82 / 83', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '编辑', '编辑X');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'AMBIGUOUS');
  assert.deepStrictEqual(r.diagnostics.candidates.map((c) => c.line), [82, 83]);
});

check('anchors=模板行 onclick → 命中 82', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '编辑', '编辑X', {
    anchors: ["openEdit('标准流程模板')"]
  });
  assert.strictEqual(r.ok, true, '应命中，实际: ' + r.reason);
  assert.strictEqual(r.line, 82);
});

check('anchors=审批行 onclick → 命中 83（跨 JS 转义比对）', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '编辑', '编辑X', {
    anchors: ["toast('打开审批编辑（演示）')"]
  });
  assert.strictEqual(r.ok, true, '应命中，实际: ' + r.reason);
  assert.strictEqual(r.line, 83);
});

check('anchors 无法区分时仍拒绝，不猜', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '编辑', '编辑X', {
    anchors: ['btn-link']
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'AMBIGUOUS');
});

check('anchors 绝不会把唯一候选判失败', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', '停用该项', {
    anchors: ['完全不存在的属性值']
  });
  assert.strictEqual(r.ok, true, '唯一候选不应因 anchors 不匹配而失败');
  assert.strictEqual(r.line, 72);
});

console.log('\n[4] 正确拒绝（数据插值渲染的文案）');

check('「审批通过」来自 ${r.status} 插值 → 拒绝并给出脚本行号', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'span', '审批通过', '审批已完成');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'NOT_FOUND');
  assert.strictEqual(r.diagnostics.candidates.length, 0);
  const inScript = r.diagnostics.occurrences.filter((o) => o.inScript);
  assert.ok(inScript.length > 0, '应报告脚本内的出现位置');
  assert.strictEqual(inScript[0].line, 50);
});

check('诊断信息能区分 文本 / 注释 / 脚本 三种藏身处', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '编辑', '编辑X');
  const occ = r.diagnostics.occurrences;
  assert.ok(occ.some((o) => o.kind === 'text'), '应识别出静态文本区的出现');
  assert.ok(occ.some((o) => o.kind === 'comment'), '应识别出 HTML 注释内的出现');
  assert.ok(occ.some((o) => o.kind === 'script'), '应识别出脚本内的出现');
  assert.ok(occ.every((o) => o.inComment === (o.kind === 'comment' || o.kind === 'jscomment')));
  assert.deepStrictEqual(r.diagnostics.scriptRanges, [{ startLine: 48, endLine: 93 }]);
});

check('「审批通过」的出现分类：静态 option 在文本区，数据在脚本区', () => {
  const occ = RawPatch.classifyOccurrences(FIXTURE_09, '审批通过');
  assert.deepStrictEqual(occ.map((o) => [o.line, o.kind]), [[32, 'text'], [50, 'script'], [51, 'script']]);
});

console.log('\n[5] 注释区剔除');

check('注释里的同形结构不参与匹配', () => {
  const src = [
    '<html><body>',
    '<!-- <button>提交</button> -->',
    '<script>const t = `<button>提交</button>`;</script>',
    '</body></html>'
  ].join('\n');
  const r = RawPatch.patchSourceText(src, 'button', '提交', '确认提交');
  assert.strictEqual(r.ok, true, '应命中脚本里那个，实际: ' + r.reason);
  assert.ok(r.html.indexOf('<!-- <button>提交</button> -->') !== -1, '注释内容必须原样保留');
  assert.ok(r.html.indexOf('`<button>确认提交</button>`') !== -1, '脚本内应被替换');
});

check('只出现在注释里时拒绝，并指出只在注释中', () => {
  const src = '<html><body><!-- <button>提交</button> --></body></html>';
  const r = RawPatch.patchSourceText(src, 'button', '提交', '确认提交');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'NOT_FOUND');
  assert.ok(r.diagnostics.occurrences.every((o) => o.inComment));
});

console.log('\n[6] P0-02 不回归（运行时 DOM 不得被固化进源文件）');

check('插值渲染的运行时文本（运行时渲染卡片 N）拒绝回填', () => {
  const r = RawPatch.patchSourceText(FIXTURE_04, 'strong', '运行时渲染卡片 1', '固定标题');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'NOT_FOUND');
});

check('回填只可能改模板字面量，不可能写入 class="card runtime-only" 这类运行时结构', () => {
  // 04 fixture 的模板里那段 <p> 是字面量，回填它是正确的「改模板」行为，
  // 但运行时容器属性/计数状态都不含可回填的字面量。
  const r = RawPatch.patchSourceText(FIXTURE_04, 'div', 'runtime-only', 'fixed');
  assert.strictEqual(r.ok, false, '容器属性不应被当作文本回填');
  const r2 = RawPatch.patchSourceText(FIXTURE_04, 'strong', '运行时渲染卡片 3', '固定标题');
  assert.strictEqual(r2.ok, false);
});

check('04 fixture 的回填结果与源文件只差一处文本，运行时结构原样不动', () => {
  const pText = '这段内容由 JavaScript 在页面加载后生成，不应该被固化到源 HTML。';
  const r = RawPatch.patchSourceText(FIXTURE_04, 'p', pText, '这段说明已改为静态文案');
  assert.strictEqual(r.ok, true, '模板里的字面量文本应当可以改，实际: ' + r.reason);

  // P0-02 的要求是「不得把运行时 DOM 写回源文件」。
  // 回填只能是一处等长替换，运行时容器与插值必须逐字节保持原样。
  const before = FIXTURE_04.split('\n');
  const after = r.html.split('\n');
  assert.strictEqual(before.length, after.length, '不得增删行');
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  assert.strictEqual(changed, 1, '只能改 1 行，实际 ' + changed);
  assert.ok(r.html.indexOf('<div class="card runtime-only">') !== -1, '模板里的容器标记本就在源文件中，应原样保留');
  assert.ok(r.html.indexOf('${counter}') !== -1, '插值必须原样保留');
  assert.ok(r.html.indexOf('运行时渲染卡片 ${counter}') !== -1, '带插值的标题必须原样保留');
});

console.log('\n[7] 结构扫描防误伤（独立审计反例，全部来自真实可复现片段）');

// 早期版本用「文本紧贴 > 和 </tag>」当锚点是错的：`>` 只是普通字符。
// 以下 8 条是审计给出的可复现误伤，改成源码结构扫描后必须全部拒绝。

check('R1 脚本内 JS 块注释里的死模板不被当作来源', () => {
  const src = "<div id=host></div><script>var L='删除';/* 旧版: '<button>删除</button>' */"
    + "document.getElementById('host').innerHTML='<button>'+L+'</button>';</script>";
  const r = RawPatch.patchSourceText(src, 'button', '删除', '移除');
  assert.strictEqual(r.ok, false, '不得写进 JS 注释');
});

check('R2 开标签属性值内部的标签形状不被当作来源', () => {
  const src = "<div id=row></div>"
    + "<button onclick=\"document.getElementById('row').innerHTML='<button class=del>删除</button>'\">添加一行</button>";
  const r = RawPatch.patchSourceText(src, 'button', '删除', '移除');
  assert.strictEqual(r.ok, false, '不得篡改属性值内的 JS 片段');
});

check('R3 <style> 内 CSS 注释不被当作来源', () => {
  const src = '<style>/* 设计稿示例：<button>查询</button> 的样式 */</style><div id=h></div>';
  const r = RawPatch.patchSourceText(src, 'button', '查询', '搜索');
  assert.strictEqual(r.ok, false, '不得写进 CSS');
});

check('R4 JS 字符串里的 <!-- / --> 不能伪造注释区间', () => {
  const src = "<button class=static-only>提交</button><div id=h></div>"
    + "<script>var O='<!--';document.getElementById('h').innerHTML='<button>提交</button>';var C='-->';</script>";
  const r = RawPatch.patchSourceText(src, 'button', '提交', '确认提交');
  // 静态按钮与脚本模板都是合法候选，正确行为是判歧义而不是被伪注释区间误导
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'AMBIGUOUS', '实际: ' + r.reason);
  assert.deepStrictEqual(r.diagnostics.candidates.map((c) => c.line).sort(), [1, 1]);
});

check('R4b 带 anchors 时能把 R4 的场景正确区分', () => {
  const src = "<button class=static-only>提交</button><div id=h></div>"
    + "<script>var O='<!--';document.getElementById('h').innerHTML='<button>提交</button>';var C='-->';</script>";
  const r = RawPatch.patchSourceText(src, 'button', '提交', '确认提交', { anchors: ['static-only'] });
  assert.strictEqual(r.ok, true, '实际: ' + r.reason);
  assert.ok(r.html.indexOf('<button class=static-only>确认提交</button>') !== -1);
});

check('R5 文本节点里自带的字面量 > 不是标签边界', () => {
  const src = "<div id=h></div><button class=price>价格 > 详情</button>"
    + "<script>document.getElementById('h').innerHTML='<button>'+LBL+'</button>';</script>";
  const r = RawPatch.patchSourceText(src, 'button', '详情', '明细');
  assert.strictEqual(r.ok, false, '不得把「价格 > 详情」当成元素边界而改错元素');
});

check('R5b 完整文本自身仍可正常编辑（原文本含 > 时不误判）', () => {
  const src = '<html><body><button class=price>价格 > 详情</button></body></html>';
  const r = RawPatch.patchSourceText(src, 'button', '价格 > 详情', '价格与明细');
  assert.strictEqual(r.ok, true, '实际: ' + r.reason);
  assert.strictEqual(r.strategy, 'literal-tag');
});

check('E1 新文本含换行 / 制表符 / 控制字符一律拒绝', () => {
  const src = "<script>var t='<button>删除</button>';</script>";
  ['第一行\n第二行', '第一行\r\n第二行', '第一行\t第二行', 'a\u0000b', 'a\u2028b'].forEach((bad) => {
    const r = RawPatch.patchSourceText(src, 'button', '删除', bad);
    assert.strictEqual(r.ok, false, '应拒绝: ' + JSON.stringify(bad));
    assert.strictEqual(r.reason, 'UNSAFE_CHAR', '应拒绝: ' + JSON.stringify(bad));
  });
});

check('E1b 允许写入的文本不会破坏 <script> 语法', () => {
  const src = "<script>var t='<button>删除</button>';</script>";
  const r = RawPatch.patchSourceText(src, 'button', '删除', '移除该项');
  assert.strictEqual(r.ok, true);
  const block = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/i.exec(r.html)[1];
  new Function(block); // 语法错误会抛
});

check('A1 anchors 比对前解 HTML 实体，不会被诱饵候选骗走', () => {
  const src = '<html><body>'
    + "<button title=\"go('确定')\">确定</button>"
    + "<button onclick=\"go(&#39;确定&#39;)\">确定</button>"
    + '</body></html>';
  const r = RawPatch.patchSourceText(src, 'button', '确定', '确认', { anchors: ["go('确定')"] });
  // 两个候选的 openTag 解码后都含该 anchor → 无法区分 → 必须拒绝而不是乱选
  assert.strictEqual(r.ok, false, '不得被诱饵候选骗去写错位置');
  assert.strictEqual(r.reason, 'AMBIGUOUS');
});

check('$ 不被拦截，且 $& / $1 在写入时保持字面量（用切片拼接而非 String.replace）', () => {
  const src = '<html><body><p>价格说明文本</p></body></html>';
  const r = RawPatch.patchSourceText(src, 'p', '价格说明文本', '$& 与 $1 原样');
  assert.strictEqual(r.ok, true, '实际: ' + r.reason);
  assert.ok(r.html.indexOf('<p>$& 与 $1 原样</p>') !== -1, '不得发生反向引用展开');
});

check('超长新文本被拒（TOO_LONG）', () => {
  const src = '<html><body><p>价格说明文本</p></body></html>';
  const r = RawPatch.patchSourceText(src, 'p', '价格说明文本', '长'.repeat(2001));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'TOO_LONG');
});

check('扫描器能把 <!DOCTYPE> 与 HTML 注释都归入不参与替换的区间', () => {
  const src = '<!DOCTYPE html>\n<html><body><!-- <p>提交</p> --><p>提交</p></body></html>';
  const regions = RawPatch.scanRegions(src);
  assert.ok(regions.some((x) => x.kind === 'comment' && src.slice(x.start, x.end) === '<!DOCTYPE html>'));
  const r = RawPatch.patchSourceText(src, 'p', '提交', '确认');
  assert.strictEqual(r.ok, true, '应命中注释外那个，实际: ' + r.reason);
  assert.ok(r.html.indexOf('<!-- <p>提交</p> -->') !== -1, '注释必须原样保留');
});

console.log('\n[8] 独立缺陷 P1-10：同标签同文本但其实是另一个元素');

// 真实案例：脚本模板渲染的 <span class="field-tag">流程名称</span>
// 曾经被写到隐藏表单里另一个同标签同文本的元素上。
// 原因是只按「同标签 + 同文本」匹配，不看 class。

check('class 不兼容的同文元素被排除', () => {
  const src = '<html><body><span class="field-chip">工单ID</span></body></html>';
  const r = RawPatch.patchSourceText(src, 'span', '工单ID', '工单 ID', { elementClasses: 'field-tag' });
  assert.strictEqual(r.ok, false, '不得写到 class 不同的元素上');
  assert.strictEqual(r.reason, 'NOT_FOUND');
});

check('class 兼容时正常命中', () => {
  const src = '<html><body><span class="field-chip">工单ID</span></body></html>';
  const r = RawPatch.patchSourceText(src, 'span', '工单ID', '工单 ID', { elementClasses: 'field-chip' });
  assert.strictEqual(r.ok, true, '实际: ' + r.reason);
});

check('class 子集关系视为兼容（容忍运行时追加的 class）', () => {
  const src = '<html><body><span class="tab">标签文本</span></body></html>';
  const r = RawPatch.patchSourceText(src, 'span', '标签文本', '新标签', { elementClasses: 'tab active' });
  assert.strictEqual(r.ok, true, '运行时追加的 active 不应导致误拒，实际: ' + r.reason);
});

check('候选 class 含模板表达式时跳过该比对（不误拒）', () => {
  const src = '<html><body><span class="tag ${cond}">状态文案</span></body></html>';
  const r = RawPatch.patchSourceText(src, 'span', '状态文案', '新状态', { elementClasses: 'tag tag-blue' });
  assert.strictEqual(r.ok, true, '动态 class 无法比对时应跳过，实际: ' + r.reason);
});

check('elementClasses 缺省时不做该比对（向后兼容）', () => {
  const src = '<html><body><span class="field-chip">工单ID</span></body></html>';
  const r = RawPatch.patchSourceText(src, 'span', '工单ID', '工单 ID');
  assert.strictEqual(r.ok, true);
});

check('真实 fixture 在传入 elementClasses 后依然命中正确行', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', '停用该项', {
    elementClasses: 'btn-link'
  });
  assert.strictEqual(r.ok, true, '实际: ' + r.reason);
  assert.strictEqual(r.line, 72);
  const r2 = RawPatch.patchSourceText(FIXTURE_09, 'button', '编辑', '编辑X', {
    elementClasses: 'btn-link',
    anchors: ["openEdit('标准流程模板')"]
  });
  assert.strictEqual(r2.ok, true, '实际: ' + r2.reason);
  assert.strictEqual(r2.line, 82);
});

console.log('\n[9] 闸门：源文件中结构已静态存在时不许改写 <script>');

check('allowScript=false 时拒绝脚本模板候选', () => {
  // 静态 <p> 的文本被 <b> 拆成两个文本节点，DOM 定位必失败；
  // 若放行脚本兜底，就会把静态元素的编辑写进 <script>。
  const src = "<html><body><p>协议 <b>重要</b> 说明</p>"
    + "<script>document.getElementById('x').innerHTML='<p>协议  说明</p>';</script></body></html>";
  const rejected = RawPatch.patchSourceText(src, 'p', '协议  说明', '协议与说明', { allowScript: false });
  assert.strictEqual(rejected.ok, false, '结构已静态存在时不得改写脚本');
  const allowed = RawPatch.patchSourceText(src, 'p', '协议  说明', '协议与说明');
  assert.strictEqual(allowed.ok, true, '不加闸门时会误改脚本，说明这道闸门是必要的');
  assert.strictEqual(allowed.strategy, 'literal-script');
});

check('allowScript=false 时静态 HTML 候选仍可正常命中', () => {
  const src = '<html><body><p>协议说明文本</p></body></html>';
  const r = RawPatch.patchSourceText(src, 'p', '协议说明文本', '新文案', { allowScript: false });
  assert.strictEqual(r.ok, true, '实际: ' + r.reason);
  assert.strictEqual(r.strategy, 'literal-tag');
});

check('真实 fixture 的运行时表格元素在 allowScript=false 下被正确拒绝', () => {
  const r = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', '停用该项', { allowScript: false });
  assert.strictEqual(r.ok, false, '该按钮在源文件里无静态结构，调用方应传 allowScript=true');
});

check('editor.js 已把 elementClasses 与结构闸门接到兜底上', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'content/editor.js'), 'utf8');
  assert.ok(/elementClasses:\s*card\.targetEl\.getAttribute\('class'\)/.test(editor), '应传 elementClasses');
  assert.ok(/const structureExists = sourceStructureExists\(sourceDoc, card\)/.test(editor), '应计算结构是否存在');
  assert.ok(/allowScript:\s*!structureExists/.test(editor), '结构存在时应禁止改脚本');
  assert.ok(/allowHtml:\s*!structureExists/.test(editor), '结构存在时应禁止改别处静态字面量');
  assert.ok(/rawStructureExists:\s*structureExists/.test(editor), '应把该事实传给错误提示');
  assert.ok(/function sourceStructureExists\(/.test(editor), '应有 sourceStructureExists 实现');
});

check('editor.js 的同文兜底已加 class 兼容性过滤', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'content/editor.js'), 'utf8');
  const start = editor.indexOf('function findSourceElementByOriginalText');
  const end = editor.indexOf('function sourceElementMatchesCard');
  const body = editor.slice(start, end);
  assert.ok(/sourceClassCompatible\(/.test(body), '同文匹配必须再过一道 class 校验');
  assert.ok(!/return candidates\.length === 1/.test(body), '不应保留「唯一命中就直接采用」的旧逻辑');
});

console.log('\n[10] 边界与原子性（独立审计缺口断言）');

check('G3 tagName 大小写不敏感，传大写不得静默失效', () => {
  const up = RawPatch.patchSourceText(FIXTURE_09, 'BUTTON', '停用', '停用该项');
  const lo = RawPatch.patchSourceText(FIXTURE_09, 'button', '停用', '停用该项');
  assert.strictEqual(up.ok, true);
  assert.strictEqual(lo.ok, true);
  assert.strictEqual(up.html, lo.html);
  const editor = fs.readFileSync(path.join(ROOT, 'content/editor.js'), 'utf8');
  assert.ok(/tagName\.toLowerCase\(\)/.test(editor), '调用点也应显式传小写');
});

check('G4 空白原文 → NO_ORIGINAL；单字符原文 → LOW_INFORMATION', () => {
  assert.strictEqual(RawPatch.patchSourceText('<p> </p>', 'p', '   ', 'x').reason, 'NO_ORIGINAL');
  assert.strictEqual(RawPatch.patchSourceText('<p>中</p>', 'p', '中', 'x').reason, 'LOW_INFORMATION');
});

check('G5 源文件里的实体/NBSP 差异不会被误当成命中', () => {
  assert.strictEqual(RawPatch.patchSourceText('<p>a&#160;b</p>', 'p', 'a\u00a0b', 'x').reason, 'NOT_FOUND');
  assert.strictEqual(RawPatch.patchSourceText('<p>a&amp;b</p>', 'p', 'a&b', 'x').reason, 'NOT_FOUND');
});

check('G6 替换保留文本两侧的空白与换行', () => {
  const r = RawPatch.patchSourceText('<div>\n    原始文本\n</div>', 'div', '原始文本', '新文本');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.html, '<div>\n    新文本\n</div>');
});

check('G7 原子性：任何失败码都不得返回 html', () => {
  const cases = [
    ['<p> </p>', 'p', '   ', 'x'],
    ['<p>甲文字</p>', 'p', '甲文字', '带\n换行'],
    ['<p>甲文字</p>', 'p', '甲文字', '带<尖括号'],
    ['<p>甲文字</p>', 'p', '甲文字', "带'引号"],
    ['<p>甲文字</p>', 'p', '甲文字', ''],
    ['<p>甲文字</p>', 'p', '甲文字', '长'.repeat(2001)],
    ['<p>甲文字</p>', 'bad tag', '甲文字', 'x'],
    ['<p>找不到的文字</p>', 'p', '甲文字', 'x'],
    ['<p>--</p>', 'p', '--', 'x']
  ];
  cases.forEach((c) => {
    const r = RawPatch.patchSourceText(c[0], c[1], c[2], c[3]);
    assert.strictEqual(r.ok, false, '应失败: ' + JSON.stringify(c));
    assert.strictEqual(r.html, undefined, '失败时不得返回 html: ' + r.reason);
  });
});

check('G9 04 fixture 回填结果与「只替换那一处」逐字节等价', () => {
  const text = '这段内容由 JavaScript 在页面加载后生成，不应该被固化到源 HTML。';
  const r = RawPatch.patchSourceText(FIXTURE_04, 'p', text, '用户改过的卡片文案');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.html, FIXTURE_04.replace('>' + text + '</p>', '>用户改过的卡片文案</p>'));
});

check('G2 正文与脚本同 tag 同文本时，交由 allowScript 闸门处理而不是乱猜', () => {
  const src = '<html><body><p>卡片文本</p>'
    + "<script>box.innerHTML='<p>卡片文本</p>';</script></body></html>";
  // 结构静态存在 → 调用方应传 allowScript=false → 只剩正文候选，唯一即命中正文
  const htmlOnly = RawPatch.patchSourceText(src, 'p', '卡片文本', '新卡片', { allowScript: false });
  assert.strictEqual(htmlOnly.ok, true, '实际: ' + htmlOnly.reason);
  assert.strictEqual(htmlOnly.strategy, 'literal-tag');
  // 不加闸门 → 两个候选 → 必须拒绝
  const both = RawPatch.patchSourceText(src, 'p', '卡片文本', '新卡片');
  assert.strictEqual(both.ok, false);
  assert.strictEqual(both.reason, 'AMBIGUOUS');
});

check('G10 样式改动与依赖缺失都拒绝兜底', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'content/editor.js'), 'utf8');
  const start = editor.indexOf('function buildRawPatchedSource');
  const end = editor.indexOf('function collectRawAnchors');
  const body = editor.slice(start, end);
  assert.ok(/Object\.keys\(stylePatch\)\.length/.test(body), '应检查样式改动');
  assert.ok(/SOURCE_TEMPLATE_STYLE_UNSUPPORTED/.test(body), '应返回专用错误码');
  assert.ok(/typeof RawPatch === 'undefined'/.test(body), 'raw-patch.js 缺失时应回落原错误码');
});

console.log('\n[11] 静态页面走原路径（接入点与注册顺序断言）');

check('editor.js 仅在 findSafeSourceElement 失败后才调用兜底', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'content/editor.js'), 'utf8');
  const start = editor.indexOf('async function buildPatchedSource');
  const end = editor.indexOf('function buildRawPatchedSource');
  assert.ok(start !== -1 && end > start, '应能截取到 buildPatchedSource 函数体');
  const body = editor.slice(start, end);

  assert.ok(
    /if \(!sourceEl\) \{\s*return buildRawPatchedSource\(/.test(body),
    '兜底必须挂在 !sourceEl 分支下'
  );
  assert.ok(
    body.indexOf('findSafeSourceElement(') < body.indexOf('return buildRawPatchedSource('),
    '常规定位在前，兜底在后'
  );
  assert.strictEqual(
    (editor.match(/return buildRawPatchedSource\(/g) || []).length,
    1,
    '兜底只能有一处调用点，不允许绕过 !sourceEl 判断'
  );
});

check('格式错误提示中不再出现「刷新页面后重试」', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'content/editor.js'), 'utf8');
  // 只截取 formatSaveError 本身，不要吞进后面的函数——
  // 「模式切换失败」提示里的「请刷新页面后重试」是合法指引（脚本注入失败确实要刷新）。
  const block = editor.slice(editor.indexOf('function formatSaveError'), editor.indexOf('function describeSourceMiss'));
  assert.ok(block.length > 0, '应能截取到 formatSaveError');
  assert.ok(block.indexOf('刷新页面后重试') === -1, '保存错误文案不得含无效指引');
});

check('manifest.json 与 background.js 都注册了 raw-patch.js，且排在 editor.js 之前', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const list = manifest.content_scripts[0].js;
  assert.ok(list.indexOf('content/raw-patch.js') !== -1, 'manifest 应注册');
  assert.ok(list.indexOf('content/raw-patch.js') < list.indexOf('content/editor.js'), '应排在 editor.js 之前');

  const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const constant = background.slice(background.indexOf('const CONTENT_SCRIPTS'), background.indexOf('const CONTENT_CSS'));
  assert.ok(constant.indexOf("'content/raw-patch.js'") !== -1, 'background 应注册');
  assert.ok(
    constant.indexOf("'content/raw-patch.js'") < constant.indexOf("'content/editor.js'"),
    '应排在 editor.js 之前'
  );
});

console.log('\n' + '─'.repeat(56));
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项，通过 ' + passed + ' 项\n');
  failures.forEach((f) => {
    console.log('✗ ' + f.name);
    console.log('  ' + f.error.stack.split('\n').slice(0, 3).join('\n  '));
    console.log('');
  });
  process.exit(1);
}
console.log('全部通过：' + passed + ' 项断言');
