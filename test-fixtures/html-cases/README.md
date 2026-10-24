# HTMLEdit 手工回归测试用例

这组 HTML 文件用于覆盖常见页面类型，复现编辑/标注扩展在不同场景下的潜在问题。

## 使用方式

1. 在 Chrome 扩展管理页重新加载 `prototype-annotator`。
2. 直接用浏览器打开 `index.html`，或者单独打开任意 case 文件。
3. 打开扩展 Popup，授权目录建议选择 `test-fixtures/html-cases`。
4. 切换到编辑模式或标注模式，按每个页面内的说明操作。

## 用例列表

- `index.html`：测试入口页，链接到所有 case。
- `01-static-article.html`：静态文本、标题、列表、内联文本编辑。
- `02-form-controls.html`：input、textarea、placeholder、select、button、label。
- `03-interactive-admin.html`：表格、链接、按钮、双击行交互，验证编辑模式是否影响页面原交互。
- `04-dynamic-runtime.html`：运行时渲染和临时 DOM，验证整页保存是否会固化运行时状态。
- `05-style-inheritance.html`：CSS 继承、响应式字号、主题样式，验证 inline style 风险。
- `06-iframe-shell.html`：iframe 壳页面，加载子页面，验证 frame 内编辑保存。
- `09-script-template.html`：**脚本模板渲染页**（合成数据，无真实业务内容）。表格与卡片在源文件里是空容器，内容全部由 `<script>` 里的数据数组 + 模板字面量在运行时渲染。用于验证 P1-09：模板里写死的文案能否回填进源文件、数据插值渲染的文案能否被正确拒绝。
- `frames/profile.html`：iframe 子页面。
- `module-a/detail.html` 与 `module-b/detail.html`：同名文件定位风险。
- `p1-03-open-this/detail.html` 与 `p1-03-authorized-root/detail.html`：路径推断失败后按同名文件 fallback 的复现场景。

## 建议重点回归

- 修改 `textarea` 内容后刷新源文件，确认是否真的保存到标签内部文本。
- 在 `03-interactive-admin.html` 双击表格行，确认页面原有双击行为是否被编辑模式拦截。
- 在 `04-dynamic-runtime.html` 修改任意文本后保存，检查源 HTML 是否被写入运行时生成的节点。
- 在两个 `detail.html` 中分别编辑，确认保存是否落到正确文件。
- 打开 `p1-03-open-this/detail.html`，但故意授权 `p1-03-authorized-root` 目录，确认是否误写授权目录里的同名文件。
- 在 `05-style-inheritance.html` 只改颜色，确认是否额外固化了字号/粗细/斜体。
- 在 `09-script-template.html` 改表格操作列的「撤销生效」，确认保存后源文件第 72 行的模板文案被正确替换。
- 在 `09-script-template.html` 改「状态」列的「审批通过」（来自数据插值），确认被拒绝且提示里给出源文件行号，而不是笼统报错。
- 在 `09-script-template.html` 改带样式的动态元素，确认整条被拒绝并提示「只能改文字」。

## 自动化测试

```bash
# P1-09 回填逻辑 + P1-10 错靶修复，67 项断言（纯 Node，无需浏览器）
node test-fixtures/raw-patch.test.js

# P1-03 路径推断（纯 Node，无需浏览器）
node test-fixtures/path-resolution.test.js

# v2.1.0 接线集成测试（需要本机 Chrome）
# 用 chrome API 桩 + 真实 content script，验证胶囊挂载、三段点击、
# ⌥Q/⌥W 提示、⌥E 转发、未授权小黄点、切换失败 toast、面板避让等 17 项
node test-fixtures/wiring.test.js

# 本目录全部手工用例的自动回归（需要本机 Chrome）
# 真的用无头 Chrome 打开每个 fixture，在渲染后的 DOM 上跑一遍 editor.js 的定位逻辑，
# 逐元素比对「改动前 vs 改动后」。任何未登记在台账里的行为变化都会以非 0 退出。
node test-fixtures/fixture-regression.js
```

`fixture-regression.js` 的定位逻辑是从 `content/editor.js` **原文按函数名抽取**的，不是重写一份，
所以它验证的是真实代码而不是它的副本。已复核的预期变化记录在脚本的 `REVIEWED` 台账里。
