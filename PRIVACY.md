# 页改笔 HTMLEdit 隐私政策 / HTMLEdit Privacy Policy

生效日期 / Effective date: 2026-06-19

## 中文

页改笔 HTMLEdit 是一款用于本地 HTML 编辑、网页标注和标注导出的 Chrome 扩展。我们重视你的隐私，并尽量让数据处理保持在本地浏览器内完成。

### 我们收集哪些数据

本扩展不会将用户数据上传到开发者服务器，也不会向第三方服务自动传输用户数据。

扩展在本地浏览器中可能保存以下数据，用于实现产品功能：

- 用户创建的标注内容、标注状态、页面标题、页面 URL、CSS 选择器和相关 HTML 上下文
- 编辑模式下用户确认修改的文字、占位符和轻量样式信息
- 用户选择的工作模式、面板状态等扩展设置
- 用户主动授权的本地目录句柄，用于在本地 HTML 文件内保存用户确认的编辑内容

这些数据保存在 Chrome 本地存储或 IndexedDB 中，不会由扩展自动发送到任何服务器。

### 数据如何使用

上述数据仅用于：

- 在网页或本地 HTML 页面中显示、恢复和管理标注
- 将标注按页面分组导出为文本或 JSON
- 在用户授权的本地目录内，将用户确认的编辑写回对应 HTML 文件
- 维持扩展的模式状态和基础使用体验

当用户主动复制导出内容，并粘贴到 AI 工具、Issue、PRD、聊天工具或开发协作平台时，相关数据传输由用户自行发起，不属于扩展的自动传输行为。

### 本地文件访问

编辑模式使用浏览器提供的 File System Access API。只有当用户主动点击授权按钮并选择本地目录后，扩展才会获得该目录的访问权限。

扩展只会在用户确认编辑后，尝试写入授权目录范围内的本地 HTML 文件。扩展不会在未经用户授权的情况下读取或修改本地文件，也不会将目录句柄上传到任何服务器。

### 权限用途

扩展申请的权限用于以下目的：

- `activeTab`：用户点击扩展并选择模式后，在当前标签页启用功能
- `scripting`：确保标注、编辑和面板脚本可以在当前页面运行
- `storage`、`unlimitedStorage`：在本地保存标注数据和扩展状态
- `webNavigation`：识别页面中的 iframe，以便在 iframe 内支持标注和编辑
- `file:///*`：支持本地 HTML 页面的标注、编辑和授权目录内保存
- `http://*/*`、`https://*/*`：支持在线网页标注和临时页面检查；扩展不会写回远程网站源文件

### 第三方服务

本扩展不使用第三方分析、追踪、广告或远程代码服务。

### 数据删除

用户可以通过以下方式删除数据：

- 在扩展面板中删除对应标注
- 在 Chrome 扩展管理页移除扩展，以删除扩展本地保存的数据
- 在浏览器站点数据或扩展存储管理中清理相关本地数据

### 联系方式

如需反馈隐私相关问题，请通过项目 README 或 Chrome Web Store 商品详情页中提供的联系方式联系开发者。

## English

HTMLEdit is a Chrome extension for editing local HTML files, adding annotations to web or local HTML pages, and exporting structured feedback. We care about user privacy and keep data processing local to the browser whenever possible.

### What Data We Handle

This extension does not upload user data to a developer server and does not automatically transmit user data to third-party services.

The extension may store the following data locally in the user's browser to provide its core features:

- Annotations created by the user, annotation status, page titles, page URLs, CSS selectors, and related HTML context
- Text, placeholder, and light style changes confirmed by the user in edit mode
- Extension settings such as the selected mode and panel state
- Local directory handles explicitly authorized by the user, used only to save confirmed edits back to local HTML files

This data is stored in Chrome local storage or IndexedDB. It is not automatically sent to any server by the extension.

### How Data Is Used

The data above is used only to:

- Display, restore, and manage annotations on web pages or local HTML pages
- Export annotations grouped by page as text or JSON
- Save confirmed edits back to local HTML files within a user-authorized directory
- Maintain the extension's basic state and user experience

If the user manually copies exported content and pastes it into an AI tool, issue tracker, PRD, chat tool, or developer collaboration platform, that transfer is initiated by the user and is not an automatic transmission by the extension.

### Local File Access

Edit mode uses the browser's File System Access API. The extension can access a local directory only after the user explicitly clicks the authorization button and selects that directory.

The extension only attempts to write to local HTML files within the authorized directory after the user confirms an edit. It does not read or modify local files without user authorization and does not upload directory handles to any server.

### Permission Usage

The extension requests permissions for the following purposes:

- `activeTab`: Enables the extension on the current tab after the user clicks the extension and selects a mode
- `scripting`: Ensures that annotation, editing, and panel scripts can run on the current page
- `storage` and `unlimitedStorage`: Stores annotation data and extension state locally
- `webNavigation`: Detects iframes so annotation and editing can work inside frames
- `file:///*`: Supports annotation, editing, and authorized local saving for local HTML pages
- `http://*/*` and `https://*/*`: Supports annotation and temporary inspection on online pages; the extension does not write changes back to remote website source files

### Third-Party Services

This extension does not use third-party analytics, tracking, advertising, or remote code services.

### Data Deletion

Users can delete data by:

- Deleting annotations inside the extension panel
- Removing the extension from Chrome, which deletes extension-local data
- Clearing related extension or site data in the browser's storage settings

### Contact

For privacy-related questions, please use the contact information provided in the project README or on the Chrome Web Store listing page.
