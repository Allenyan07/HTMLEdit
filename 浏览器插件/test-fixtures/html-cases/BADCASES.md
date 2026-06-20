# HTMLEdit Badcase 跟踪清单

用于记录当前插件在常见 HTML 页面中的已知风险、复现入口和修复验收标准。

测试入口：[index.html](./index.html)

## 修复验证记录

- 2026-06-17：已完成代码修复，并通过 `node --check` 验证 `content/editor.js`、`background.js`、`popup.js` 语法。
- 2026-06-17：已通过 Node 断言验证 P1-03 路径推断：授权错误目录时不再按同名文件 fallback。
- 2026-06-17：已通过静态断言验证 P0-01、P0-02、P1-04、P1-05、P2-06、P2-07、P1-08 的关键修复分支存在，旧的运行时 DOM 保存函数和文件名 fallback 已移除。
- 2026-06-17：已将 `02-form-controls.html`、`04-dynamic-runtime.html`、`05-style-inheritance.html` 恢复为干净测试基线，便于后续在扩展中手动回归。
- 2026-06-18：补充修复并验证 P1-03 同名授权根目录风险。目录授权时记录当前页面对应的根路径片段，保存时要求完整路径前缀匹配；旧授权缺少路径片段时要求重新授权。

## 总览

| 编号    | 问题                                            | 已复现 | 已修复 | 已验证 |
| ----- | --------------------------------------------- | :-: | :-: | :-: |
| P0-01 | `textarea` 修改无法可靠写回 HTML 源码                   | [x] | [x] | [x] |
| P0-02 | 整页 `outerHTML` 保存会固化运行时 DOM                   | [x] | [x] | [x] |
| P1-03 | 同名文件或目录推断导致保存目标不可靠                            | [x] | [x] | [x] |
| P1-04 | 双击快捷编辑容易误触页面原有交互                              | [x] | [x] | [x] |
| P1-05 | input / textarea 的 value 与 placeholder 编辑语义不清 | [x] | [x] | [x] |
| P2-06 | 样式编辑会额外固化 inline style                        | [x] | [x] | [x] |
| P2-07 | 多 iframe 编辑计数不准确                              | [x] | [x] | [x] |
| P1-08 | 目录授权状态与真实写入失败提示不准确                            | [x] | [x] | [x] |

---

## P0-01 textarea 修改无法可靠写回 HTML 源码

- [x] 已复现
- [x] 已修复
- [x] 已验证

**复现文件**

[02-form-controls.html](./02-form-controls.html)

**复现步骤**

1. 打开 `02-form-controls.html`。
2. 进入编辑模式。
3. 双击 `textarea 标签内部文本` 的内容。
4. 修改为任意新文本并确认保存。
5. 重新打开或查看源 HTML 文件。

**当前风险**

当前逻辑对 `TEXTAREA` 设置 `value` attribute，但 HTML 中 `textarea` 的初始值来自标签内部文本：

```html
<textarea>这里是初始内容</textarea>
```

因此页面上看似改了，保存后的 HTML 源码可能没有真正更新。

**期望结果**

修改 `textarea` 后，源文件中的标签内部文本也被正确更新。

**建议修复方向**

区分表单控件类型：

- `input`：根据编辑对象写入 `value` 或 `placeholder`
- `textarea` 有内容：写入 `textContent`
- `textarea` 只有 placeholder：写入 `placeholder`

---

## P0-02 整页 outerHTML 保存会固化运行时 DOM

- [x] 已复现
- [x] 已修复
- [x] 已验证

**复现文件**

[04-dynamic-runtime.html](./04-dynamic-runtime.html)

**复现步骤**

1. 打开 `04-dynamic-runtime.html`。
2. 点击“添加临时运行时节点”。
3. 进入编辑模式。
4. 修改页面中任意原始文本并保存。
5. 查看源 HTML。

**当前风险**

当前保存逻辑会 clone 当前 `document.documentElement` 并用 `outerHTML` 覆盖源文件。运行时生成的节点、临时状态、脚本修改后的 DOM 可能被写入源码。

**期望结果**

保存只影响用户明确编辑的文本或样式，不应把运行时生成节点固化到 HTML 文件。

**建议修复方向**

优先做局部保存：

- 使用 selector / DOM path / 文本节点定位源 HTML
- 只替换对应文本或属性
- 对无法安全局部替换的页面给出明确提示

---

## P1-03 同名文件或目录推断导致保存目标不可靠

- [x] 已复现
- 当前复现状态：已复现
- [x] 已修复
- [x] 已验证

**复现文件**

[module-a/detail.html](./module-a/detail.html)  
[module-b/detail.html](./module-b/detail.html)  
[p1-03-open-this/detail.html](./p1-03-open-this/detail.html)  
[p1-03-authorized-root/detail.html](./p1-03-authorized-root/detail.html)

**复现步骤**

1. 授权 `html-cases` 目录。
2. 打开 `module-a/detail.html` 并编辑一段文字。
3. 打开 `module-b/detail.html` 并编辑一段文字。
4. 分别查看两个源文件是否保存到正确位置。

**强制触发 fallback 的复现步骤**

1. 打开 `p1-03-open-this/detail.html`。
2. 在 Popup 中故意授权 `p1-03-authorized-root` 目录，而不是 `html-cases` 或 `p1-03-open-this`。
3. 进入编辑模式。
4. 编辑 `p1-03-open-this/detail.html` 中的目标段落并保存。
5. 查看 `p1-03-authorized-root/detail.html` 是否被错误改写。
6. 正确行为应该是拒绝保存，并提示当前文件不在已授权目录内。

**当前风险**

保存逻辑在路径推断失败时会按文件名递归查找。常见项目中 `index.html`、`detail.html`、`list.html` 很容易重复，可能导致找不到、报歧义，或在特殊情况下保存到错误文件。

**复现记录**

- 2026-06-17：使用 `module-a/detail.html` 与 `module-b/detail.html` 未复现保存错误。
- 2026-06-17：新增 `p1-03-open-this/detail.html` + `p1-03-authorized-root/detail.html`，用于强制触发路径推断失败后的同名文件 fallback。
- 2026-06-17：按强制 fallback 步骤复现成功，`p1-03-authorized-root/detail.html` 被错误写入打开页内容；已将测试文件恢复为初始状态，便于下次复测。

**期望结果**

编辑哪个 frame / 页面，就保存到该页面对应的真实文件路径。

**建议修复方向**

- 首次保存时缓存 `fileUrl -> 授权目录内相对路径`
- 优先使用完整相对路径定位文件
- 文件名搜索只作为最后兜底，并在多匹配时要求用户确认

---

## P1-04 双击快捷编辑容易误触页面原有交互

- [x] 已复现
- [x] 已修复
- [x] 已验证

**复现文件**

[03-interactive-admin.html](./03-interactive-admin.html)

**复现步骤**

1. 打开 `03-interactive-admin.html`。
2. 不开启编辑模式，双击表格行，确认底部日志会显示打开详情。
3. 开启编辑模式。
4. 双击表格行、按钮/链接文本、普通说明文字，对比哪些场景被编辑卡片接管。

**当前风险**

编辑模式下双击文本会打开编辑卡片，这是高效入口，但如果对表格行、树组件、列表项、链接、按钮等交互区域一律抢占事件，会破坏页面原本的双击查看详情、打开链接、选择文本等操作。

**期望结果**

双击仍然作为普通文本的快捷编辑入口，但要降低误触页面交互的概率。普通文本、标题、表格单元格里的文本应尽量可双击编辑；强交互控件或明显有页面行为的区域应优先放过页面自身交互。`Shift+Click` 保留为强制精确编辑入口。

**建议修复方向**

- 不做大面积排除，避免可直接编辑的文本范围过小。
- 双击普通文本叶子节点时打开编辑卡片，例如 `p`、`span`、`h1-h6`、`li`、`td`、`th` 中的文本。
- 强交互控件默认不接管双击，例如 `input`、`textarea`、`select`、`video`、`audio`、`canvas`、`iframe`。
- 对明显承载页面交互的元素优先放过，例如 `a[href]`、`button`、`contenteditable`、`draggable`、`role="button"`、`role="gridcell"`、带 `onclick` 的元素。
- 只有命中文本内容时才触发双击编辑，双击容器空白区域不打开编辑卡片。
- 保留 `Shift+Click` 作为强制编辑入口，用于复杂组件内的精确文本修改。

---

## P1-05 input / textarea 的 value 与 placeholder 编辑语义不清

- [x] 已复现
- [x] 已修复
- [x] 已验证

**复现文件**

[02-form-controls.html](./02-form-controls.html)

**复现步骤**

1. 打开 `02-form-controls.html`。
2. 分别编辑：
   - 有 `value` 的 input
   - 只有 `placeholder` 的 input
   - 有内部文本的 textarea
   - 只有 `placeholder` 的 textarea
3. 查看编辑卡片和保存后的源码。

**当前风险**

当前编辑卡片只显示“原文本 / 修改为”，没有告诉用户正在改 `value`、`placeholder` 还是普通文本。用户可能以为在改默认值，实际改了占位提示。

**期望结果**

编辑卡片明确显示当前编辑目标类型。

**建议修复方向**

在编辑卡片增加字段提示：

- `文本内容`
- `输入值 value`
- `占位提示 placeholder`
- `textarea 初始内容`

---

## P2-06 样式编辑会额外固化 inline style

- [x] 已复现
- [x] 已修复
- [x] 已验证

**复现文件**

[05-style-inheritance.html](./05-style-inheritance.html)

**复现步骤**

1. 打开 `05-style-inheritance.html`。
2. 进入编辑模式。
3. 只修改某段文字的颜色。
4. 保存后查看源 HTML 中该元素的 `style` 属性。

**当前风险**

只要样式发生变化，当前逻辑会写入：

- `font-size`
- `color`
- `font-weight`
- `font-style`

用户只改颜色，也可能把当前计算字号和字重固化成 inline style，破坏响应式和主题继承。

**期望结果**

只写入用户实际修改过的样式属性。

**建议修复方向**

记录每个控件是否被用户改动：

- 只改颜色，只写 `color`
- 只改字号，只写 `font-size`
- 加粗/倾斜仅在切换时写入

---

## P2-07 多 iframe 编辑计数不准确

- [x] 已复现
- [x] 已修复
- [x] 已验证

**复现文件**

[06-iframe-shell.html](./06-iframe-shell.html)  
[frames/profile.html](./frames/profile.html)

**复现步骤**

1. 打开 `06-iframe-shell.html`。
2. 授权 `html-cases` 目录。
3. 在主页面编辑一处文本。
4. 在 iframe 子页面编辑一处文本。
5. 查看 Popup 中“已保存 N 处”的计数。

**当前风险**

每个 frame 内部各自维护 `editedCount`，并把局部计数发送给 background 覆盖 tab 级计数。多个 frame 轮流编辑时，计数可能被覆盖，显示不准确。

**期望结果**

同一个 tab 内多 frame 编辑，保存计数应累计准确。

**建议修复方向**

让 background 维护 tab 级累计计数：

- content script 只发送 `delta: 1`
- background 负责累加
- Popup 只读取 background 的 tab 级计数

---

## P1-08 目录授权状态与真实写入失败提示不准确

- [x] 已复现
- [x] 已修复
- [x] 已验证

**复现文件**

待补充稳定复现入口。可先使用任意 `file://` HTML 页面观察。

**已观察现象**

用户刚在扩展 Popup 中授权过目录，但编辑保存时偶发提示：

```text
写入权限已失效，请在扩展弹窗中重新授权
```

**可能触发条件**

1. Chrome 将已保存的目录句柄权限从 `granted` 降为 `prompt` 或 `denied`。
2. 扩展 background service worker 休眠后恢复，重新读取 IndexedDB 中的目录句柄时权限状态变化。
3. 授权目录、当前打开文件、真实写入目标之间不稳定匹配。
4. 文件被系统、同步盘或其它程序占用，导致 `createWritable()` 写入失败。
5. 当前代码把权限检查失败和真实写入失败都归类为 `PERMISSION_DENIED`。

**当前风险**

提示文案会让用户误以为“刚授权就失效”，但真实原因可能是权限需要重新确认、文件路径不匹配、文件不可写或写入过程失败。用户无法判断是该重新授权目录，还是该检查文件位置和文件状态。

**期望结果**

保存失败时能区分不同原因：

- 尚未授权目录
- 目录权限需要重新确认
- 当前文件不在授权目录内
- 找不到当前页面对应文件
- 文件写入失败或文件被占用

**建议修复方向**

- `queryPermission()` 返回 `prompt` 时使用单独错误码，例如 `PERMISSION_PROMPT_REQUIRED`。
- `queryPermission()` 返回 `denied` 时才提示权限被拒绝或失效。
- `createWritable()` / `write()` / `close()` 抛错时使用单独错误码，例如 `WRITE_FAILED`，不要复用 `PERMISSION_DENIED`。
- 错误提示中保留用户能理解的下一步操作，同时在调试信息中保留原始异常信息。
- 修复 P1-03 后，再验证该问题是否仍会被路径误判放大。
