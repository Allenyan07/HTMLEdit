# 原型标注工具 — 编辑模式需求规格

> **写给 Codex**：这是一个已存在的 Chrome MV3 扩展，当前只有标注功能（v1.1.0）。需要在上面加编辑模式。
> **参考代码**：`editor-fsa-attempt` 分支有完整的编辑模式实现（348 行 editor.js + 三态 Popup + content.js 模式机），但**保存机制两次尝试均失败**。本次的重点是找到**可靠的保存方案**。

---

## 一、项目概况

| 项目 | 说明 |
|------|------|
| 类型 | Chrome MV3 扩展 |
| 用途 | 在本地 HTML 原型上标注修改意见 + 直接编辑文本 |
| 协议 | `file://`（用户从 Obsidian vault 打开本地 HTML 文件） |
| 页面结构 | index.html 作为 shell，通过 `<iframe>` 加载子页面 |
| 路径 | `/home/agentuser/obsidian_sync/01 产品经理/原型标注工具/浏览器插件/prototype-annotator/` |
| 当前版本 | v1.1.0（commit `78b2a7a`，只有标注功能） |

---

## 二、当前架构（v1.1.0，不要破坏）

### 2.1 文件结构

```
manifest.json          # MV3, content_scripts 注入所有 frame
background.js          # Service Worker — 消息路由 + 模式状态 + 注入调度
popup.html / popup.js  # 扩展弹窗 — 单按钮「开启/关闭标注模式」
content/
  storage.js           # chrome.storage.local 封装（ProtoStorage）
  selector.js          # CSS 选择器生成 + 元素查找（SelectorUtils）
  messaging.js         # 消息收发封装 + IS_TOP 检测（Messaging）
  area-selector.js     # Shift+拖拽 区域标注（AreaSelector）
  annotator.js         # 标注核心：hover 高亮、Shift+Click 卡片、badge（Annotator）
  panel.js             # 侧边面板：标注列表、导出、FAB 按钮（Panel）
  content.js           # 顶层编排：模式激活/停用、消息分发（ProtoAnnotator）
  content.css          # 注入样式
```

### 2.2 模块加载顺序（manifest.json line 32-40）

```
storage → selector → messaging → area-selector → annotator → panel → content
```

每个模块是 IIFE：`const ModuleName = (() => { ... return { api }; })();`

### 2.3 模式管理（当前）

- `background.js` 用 `tabStates[tabId] = { active: bool }` 管理状态
- Popup 点击 → `SET_MODE` 消息 → background → 写入 storage → 广播 `MODE_CHANGED` 到所有 frame
- `content.js` 收到 `MODE_CHANGED` → `activateMode()` / `deactivateMode()` → 调用 `Annotator.activate()` / `Panel.create()` 等
- **只有一种模式：标注。没有编辑模式。**

### 2.4 Popup 当前 UI

```html
<button id="toggleBtn">开启标注模式</button>  <!-- 单击切换 -->
```

---

## 三、目标：新增编辑模式

### 3.1 功能描述

在标注模式之外新增「编辑模式」。用户切换到编辑模式后：

1. **Hover**：叶节点文本元素显示绿色虚线高亮（区别于标注的紫色）
2. **Shift+Click** 文本元素：弹出编辑卡片（Shadow DOM），显示「原文本」+「修改为」输入框
3. **确认修改**：直接修改 DOM 文本 + **立即保存到原 HTML 文件**（覆盖，不生成新文件）
4. **编辑标记**：被编辑过的元素显示淡绿色边框 + 背景，session 内可见
5. **退出编辑模式**：清除所有编辑标记

### 3.2 保存机制（核心难点）

这是本次需求的关键。之前两次尝试均失败：

| 方案 | 原理 | 为什么失败 |
|------|------|-----------|
| Native Host | 扩展通过本地进程写文件 | 需要用户本机安装 manifest，用户不想装 |
| FSA API（ISOLATED world） | content script 直接调 `showOpenFilePicker` | FSA API 在 content script 隔离世界不可用 |
| FSA API（MAIN world 注入） | background → `executeScript({world:'MAIN'})` 注入 FSA 代码 | 也未成功（原因未完全定位，可能是 transient activation 丢失或 frame 定位问题） |

**你需要找到一个能在 Chrome 扩展 + `file://` 协议下，可靠覆盖原文件的方法。**

约束：
- 不能要求用户安装额外软件
- 必须是原地覆盖，不是下载新文件
- 页面通过 `file://` 协议加载，常包含 iframe
- 目标文件路径通过 `new URL(window.location.href).pathname` 获取

### 3.3 Popup 改造

从单按钮改为三态分段控件：

```
[关闭]  [✏️ 编辑]  [📋 标注]
```

- 每个按钮点击 → `SET_MODE { mode: 'off' | 'edit' | 'annotate' }`
- 编辑模式下额外显示「💾 保存修改 (N处)」按钮（查询 `GET_EDIT_STATE`）
- 参考实现：`editor-fsa-attempt` 分支的 `popup.html` + `popup.js`

---

## 四、技术约束

### 4.1 必须遵守的

1. **协议**：所有操作在 `file://` 下完成
2. **iframe**：页面使用 `<iframe>` 加载子页面（如 `index.html` 内嵌 `规则创建页.html`），编辑可能发生在主 frame 或 iframe 内
3. **Shadow DOM**：编辑卡片用 Shadow DOM 隔离样式，避免被页面 CSS 污染
4. **模块加载顺序**：新模块 `editor.js` 必须在 `annotator.js` 之后、`panel.js` 之前加载（因为 Editor 引用 Annotator.showToast，Panel 引用 Editor API）
5. **不要破坏标注功能**：标注和编辑是互斥模式，切换时正确清理/激活

### 4.2 不要做的事

1. **不要用 contentEditable** — 用户之前拒绝了，太容易误触
2. **不要加中间保存状态**（保存条、beforeunload 警告等）— 用户明确要求「确认即保存」，一步到位
3. **不要改变现有的标注 UI 和交互逻辑**

### 4.3 视觉规范

- 编辑模式主题色：绿色 `#22c55e`（区别于标注的紫色 `#5b6cff`）
- 字体：`-apple-system, "Inter", BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei"`
- 卡片圆角：6-12px，投影轻量（`0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.08)`）
- 编辑标记：`outline: 1px solid rgba(34,197,94,0.35)` + `background: rgba(34,197,94,0.04)`
- 完整视觉 spec 见 skill `prototype-annotator-dev` 的 `references/ui-token-spec.md`

---

## 五、参考代码

`editor-fsa-attempt` 分支包含完整的编辑模式实现，除了保存部分不可靠外，其他都可以直接复用或参考：

| 文件 | 说明 | 是否可复用 |
|------|------|:--:|
| `content/editor.js` (348 行) | 完整的编辑逻辑：hover、Shift+Click、卡片 UI、markEdited、buildCleanHTML | ✅ 编辑逻辑可复用，**保存函数需替换** |
| `popup.html` | 三态分段控件 HTML | ✅ 直接复用 |
| `popup.js` | 三态切换 + 保存按钮逻辑 | ✅ 直接复用 |
| `popup.css` | 分段控件 + 保存按钮样式 | ✅ 直接复用 |
| `content/content.js` | 三态模式机 `setMode('off'/'edit'/'annotate')` | ✅ 直接复用 |
| `background.js` | `MODE_CHANGED` 携带 `mode` 字段 + `GET_EDIT_STATE` / `SAVE_EDITS` 消息 | ✅ 可复用，**删掉 FSA_WRITE_FILE 部分** |
| `manifest.json` | content_scripts 数组加 `editor.js` | ✅ 参考 |

查看分支代码：
```bash
git show editor-fsa-attempt:content/editor.js
git show editor-fsa-attempt:content/content.js
git show editor-fsa-attempt:popup.html
git show editor-fsa-attempt:popup.js
git show editor-fsa-attempt:popup.css
git show editor-fsa-attempt:background.js
```

---

## 六、你需要交付

1. **`content/editor.js`** — 编辑模式模块（新建或基于分支版本修改）
2. **`popup.html` + `popup.js` + `popup.css`** — 三态 UI
3. **`content/content.js`** — 加入三态模式机
4. **`background.js`** — 加入 `mode` 字段 + 新消息类型
5. **`manifest.json`** — content_scripts 数组加 `editor.js`
6. **可靠的保存机制** — 这是本次的核心交付物

---

## 七、验收标准

- [ ] Popup 显示三态分段控件，切换后页面行为正确
- [ ] 编辑模式下，hover 文本元素出现绿色高亮
- [ ] Shift+Click 弹出编辑卡片，输入后确认 → DOM 文本更新
- [ ] **确认修改 → 直接覆盖原 HTML 文件，不弹下载**
- [ ] 第二次编辑同一文件时静默保存（不弹文件选择器）
- [ ] 编辑后的元素显示绿色标记，退出编辑模式后标记清除
- [ ] 标注模式功能不受影响
- [ ] 在 iframe 内编辑也能正确保存到对应文件
