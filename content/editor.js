const Editor = (() => {
  const EDITED_CLASS = '__proto_editor_edited__';
  const TARGET_SELECTOR = 'input, textarea, button, a, label, span, p, div, h1, h2, h3, h4, h5, h6, td, th, li';
  const DOUBLE_CLICK_PASSTHROUGH_SELECTOR = 'input, textarea, select, option, video, audio, canvas, iframe, a[href], button, [contenteditable], [draggable="true"], [role="button"], [role="gridcell"], [onclick]';

  let isActive = false;
  let hoveredElement = null;
  let highlightOverlay = null;
  let currentCard = null;
  let editedCount = 0;
  let lastUndo = null;
  let undoToast = null;
  let undoToastTimer = null;

  function activate() {
    if (isActive) return;
    isActive = true;
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDoubleClick, true);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('dblclick', onDoubleClick, true);
    removeHighlight();
    closeCard();
    clearUndoToast();
    clearEditedMarks();
  }

  function onMouseOver(e) {
    if (!isActive) return;
    if (isToolElement(e.target)) return;

    const target = findEditableTarget(e.target, { force: true });
    if (!target || target === hoveredElement) return;

    removeHighlight();
    hoveredElement = target;
    showHighlight(target);
  }

  function onMouseOut(e) {
    if (!isActive) return;
    if (!hoveredElement) return;
    if (e.relatedTarget && hoveredElement.contains(e.relatedTarget)) return;
    if (e.target === hoveredElement || hoveredElement.contains(e.target)) {
      removeHighlight();
      hoveredElement = null;
    }
  }

  function onClick(e) {
    if (!isActive) return;
    if (!e.shiftKey) return;
    if (isToolElement(e.target)) return;

    const target = findEditableTarget(e.target, { force: true });
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();
    removeHighlight();
    hoveredElement = null;
    showCard(target, { left: e.clientX, top: e.clientY });
  }

  function onDoubleClick(e) {
    if (!isActive) return;
    if (isToolElement(e.target)) return;

    if (shouldPassThroughDoubleClick(e.target)) return;

    const target = findEditableTarget(e.target, { force: false });
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();
    removeHighlight();
    hoveredElement = null;
    showCard(target, { left: e.clientX, top: e.clientY });
  }

  function findEditableTarget(startEl, options) {
    if (!startEl || startEl.nodeType !== Node.ELEMENT_NODE) return null;
    options = options || {};

    let el = startEl.closest(TARGET_SELECTOR);
    while (el && el !== document.body && el !== document.documentElement) {
      if (!isToolElement(el) && getEditableText(el)) {
        if (!options.force && hasInteractiveAncestor(el)) return null;
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function shouldPassThroughDoubleClick(startEl) {
    if (!startEl || startEl.nodeType !== Node.ELEMENT_NODE) return true;
    if (startEl.closest(DOUBLE_CLICK_PASSTHROUGH_SELECTOR)) return true;
    return false;
  }

  function hasInteractiveAncestor(el) {
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current !== el && current.matches && current.matches(DOUBLE_CLICK_PASSTHROUGH_SELECTOR)) return true;
      if (current !== el && hasDataAttributes(current)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function hasDataAttributes(el) {
    if (!el || !el.attributes) return false;
    for (const attr of el.attributes) {
      if (attr.name.indexOf('data-') === 0) return true;
    }
    return false;
  }

  function getEditableText(el) {
    if (!el) return '';
    if (el.tagName === 'INPUT') {
      const meta = getEditTargetMeta(el);
      return (meta.value || '').trim();
    }
    if (el.tagName === 'TEXTAREA') {
      const meta = getEditTargetMeta(el);
      return (meta.value || '').trim();
    }
    if (el.tagName === 'SELECT') {
      return '';
    }

    const directText = getDirectText(el);
    if (directText) return directText;

    const text = el.textContent ? el.textContent.trim() : '';
    const elementChildren = Array.from(el.children).filter((child) => !isToolElement(child));
    if (text && elementChildren.length === 0) return text;
    return '';
  }

  function getDirectText(el) {
    let text = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    });
    return text.trim();
  }

  function getEditTargetMeta(el) {
    if (el.tagName === 'INPUT') {
      if (el.hasAttribute('value') || el.value) {
        return { kind: 'input-value', label: '输入值 value', value: el.value || el.getAttribute('value') || '' };
      }
      if (el.hasAttribute('placeholder') || el.placeholder) {
        return { kind: 'placeholder', label: '占位提示 placeholder', value: el.placeholder || el.getAttribute('placeholder') || '' };
      }
      return { kind: 'input-value', label: '输入值 value', value: el.value || '' };
    }

    if (el.tagName === 'TEXTAREA') {
      const initialText = el.textContent || el.defaultValue || '';
      if (initialText.trim()) {
        return { kind: 'textarea-text', label: 'textarea 初始内容', value: initialText };
      }
      if (el.hasAttribute('placeholder') || el.placeholder) {
        return { kind: 'placeholder', label: '占位提示 placeholder', value: el.placeholder || el.getAttribute('placeholder') || '' };
      }
      return { kind: 'textarea-text', label: 'textarea 初始内容', value: initialText };
    }

    return { kind: 'text', label: '文本内容', value: getDirectText(el) || (el.textContent || '') };
  }

  function applyText(el, nextText, targetMeta) {
    targetMeta = targetMeta || getEditTargetMeta(el);
    if (targetMeta.kind === 'input-value') {
      el.value = nextText;
      el.setAttribute('value', nextText);
      return;
    }
    if (targetMeta.kind === 'placeholder') {
      el.placeholder = nextText;
      el.setAttribute('placeholder', nextText);
      return;
    }
    if (targetMeta.kind === 'textarea-text') {
      el.value = nextText;
      el.defaultValue = nextText;
      el.textContent = nextText;
      el.removeAttribute('value');
      return;
    }

    const textNodes = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
    const primary = textNodes.find((node) => node.textContent.trim());
    if (primary) {
      primary.textContent = preserveOuterWhitespace(primary.textContent, nextText);
    } else {
      el.textContent = nextText;
    }
  }

  function preserveOuterWhitespace(oldValue, nextText) {
    const leading = oldValue.match(/^\s*/)?.[0] || '';
    const trailing = oldValue.match(/\s*$/)?.[0] || '';
    return leading + nextText + trailing;
  }

  function showHighlight(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    highlightOverlay = document.createElement('div');
    highlightOverlay.className = '__proto_editor_highlight__';
    highlightOverlay.style.cssText =
      'position:fixed;' +
      'left:' + rect.left + 'px;' +
      'top:' + rect.top + 'px;' +
      'width:' + rect.width + 'px;' +
      'height:' + rect.height + 'px;' +
      'border:2px dashed #22c55e;' +
      'background:rgba(34,197,94,0.08);' +
      'pointer-events:none;' +
      'z-index:2147483640;' +
      'border-radius:3px;';
    document.body.appendChild(highlightOverlay);
  }

  function removeHighlight() {
    if (highlightOverlay) {
      highlightOverlay.remove();
      highlightOverlay = null;
    }
  }

  function showCard(targetEl, position) {
    closeCard();

    const targetMeta = getEditTargetMeta(targetEl);
    const originalText = (targetMeta.value || '').trim();
    const originalStyle = getTextStyle(targetEl);
    const sourceLocator = getSourceLocator(targetEl);
    const container = document.createElement('div');
    container.id = '__proto_editor_card__';
    container.__proto_annotator = true;
    const shadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getCardStyles();
    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = buildCardHTML(originalText, originalStyle, targetMeta);
    shadow.appendChild(card);
    document.body.appendChild(container);

    currentCard = { container, shadow, card, targetEl, targetMeta, sourceLocator, originalText, originalStyle };
    authAutoOpenedForCard = null;   // 新的一张卡，重新允许自动弹一次授权窗
    positionCard(card, position);
    bindCardEvents();
    requestAnimationFrame(() => card.classList.add('card-visible'));
  }

  function positionCard(card, position) {
    const width = 360;
    const height = 370;
    let left = position.left + 10;
    let top = position.top + 10;
    if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10;
    if (top + height > window.innerHeight - 10) top = position.top - height - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function buildCardHTML(originalText, originalStyle, targetMeta) {
    return '' +
      '<div class="type-indicator">编辑：' + escapeHtml(targetMeta.label) + '</div>' +
      '<div class="card-body">' +
      '  <label>原文本</label>' +
      '  <div class="original-text">' + escapeHtml(originalText) + '</div>' +
      '  <label>修改为</label>' +
      '  <textarea class="new-text-input" rows="3" placeholder="输入新文本...">' + escapeHtml(originalText) + '</textarea>' +
      '  <div class="style-grid">' +
      '    <div class="style-field">' +
      '      <label>字号</label>' +
      '      <div class="size-control"><input type="number" class="font-size-input" min="1" max="300" step="1" value="' + escapeHtml(originalStyle.size) + '" /><span>px</span></div>' +
      '    </div>' +
      '    <div class="style-field">' +
      '      <label>颜色</label>' +
      '      <input type="color" class="font-color-input" value="' + escapeHtml(originalStyle.color) + '" />' +
      '    </div>' +
      '    <div class="style-field compact">' +
      '      <label>字形</label>' +
      '      <div class="toggle-row">' +
      '        <button type="button" class="toggle-btn bold-toggle' + (originalStyle.bold ? ' active' : '') + '" title="加粗">B</button>' +
      '        <button type="button" class="toggle-btn italic-toggle' + (originalStyle.italic ? ' active' : '') + '" title="倾斜">I</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="error" aria-live="polite"></div>' +
      '</div>' +
      '<div class="card-actions">' +
      '  <button class="btn btn-cancel">取消</button>' +
      '  <button class="btn btn-confirm">确认修改</button>' +
      '</div>';
  }

  function bindCardEvents() {
    if (!currentCard) return;
    const shadow = currentCard.shadow;
    shadow.querySelector('.btn-cancel').addEventListener('click', closeCard);
    shadow.querySelector('.btn-confirm').addEventListener('click', confirmEdit);
    shadow.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.dataset.dirty = 'true';
        btn.classList.toggle('active');
      });
    });
    shadow.querySelector('.font-size-input').addEventListener('input', (event) => {
      event.currentTarget.dataset.dirty = 'true';
    });
    shadow.querySelector('.font-color-input').addEventListener('input', (event) => {
      event.currentTarget.dataset.dirty = 'true';
    });
    const input = shadow.querySelector('.new-text-input');
    input.focus();
    input.select();
  }

  async function confirmEdit() {
    if (!currentCard) return;

    const input = currentCard.shadow.querySelector('.new-text-input');
    const error = currentCard.shadow.querySelector('.error');
    const confirmBtn = currentCard.shadow.querySelector('.btn-confirm');
    const nextText = input.value.trim();
    const stylePatch = getStylePatchFromCard(currentCard.shadow);
    const textChanged = nextText !== currentCard.originalText;
    const styleChanged = Object.keys(stylePatch).length > 0;

    if (!nextText) {
      error.textContent = '修改文本不能为空';
      return;
    }
    if (!textChanged && !styleChanged) {
      error.textContent = '文字和样式都没有变化';
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = '保存中...';
    error.textContent = '';

    const patchedSource = await buildPatchedSource(currentCard, nextText, textChanged, stylePatch);
    if (!patchedSource.success) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认修改';
      error.textContent = formatSaveError(patchedSource.error);
      maybeRequestAuth(patchedSource.error);
      return;
    }

    const snapshot = captureElementState(currentCard.targetEl);

    if (textChanged) applyText(currentCard.targetEl, nextText, currentCard.targetMeta);
    if (styleChanged) applyTextStyle(currentCard.targetEl, stylePatch);
    markEdited(currentCard.targetEl);

    const response = await Messaging.sendToBackground({
      type: 'SAVE_EDITED_HTML',
      fileUrl: window.location.href,
      pageName: ProtoStorage.getPageName(),
      html: patchedSource.html
    });

    if (!response || !response.success) {
      restoreElementState(currentCard.targetEl, snapshot);
      unmarkEdited(currentCard.targetEl);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认修改';
      error.textContent = formatSaveError(response && response.error);
      maybeRequestAuth(response && response.error);
      return;
    }

    syncEditableLocalStorage(patchedSource.localStoragePatch);

    editedCount += 1;
    Messaging.sendToBackground({ type: 'EDIT_STATE_CHANGED', delta: 1 });
    const pageName = ProtoStorage.getPageName();
    lastUndo = {
      fileUrl: window.location.href,
      pageName: pageName,
      previousHtml: patchedSource.previousHtml,
      previousLocalStoragePatch: patchedSource.previousLocalStoragePatch,
      targetEl: currentCard.targetEl,
      snapshot: snapshot
    };
    closeCard();
    showUndoToast('已修改并保存到 ' + pageName + describeRawHit(patchedSource));
  }

  function syncEditableLocalStorage(patch) {
    if (!patch || !patch.editId) return;
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        const raw = localStorage.getItem(key);
        if (!raw || raw[0] !== '{') continue;
        let data;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          continue;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        if (!Object.prototype.hasOwnProperty.call(data, patch.editId)) continue;
        data[patch.editId] = patch.html;
        localStorage.setItem(key, JSON.stringify(data));
      }
    } catch (e) {}
  }

  function captureElementState(el) {
    return {
      value: el.value,
      // 保存子节点的「原始节点引用」而不是 innerHTML 字符串：
      // 回滚时把同一些节点放回去，addEventListener 绑定的监听器不会丢。
      childNodes: Array.from(el.childNodes),
      textContent: el.textContent,
      placeholder: el.getAttribute('placeholder'),
      valueAttr: el.getAttribute('value'),
      className: el.className,
      styleAttr: el.getAttribute('style')
    };
  }

  function restoreElementState(el, state) {
    if ('value' in el) el.value = state.value;
    if (state.childNodes) {
      // 不要用 el.textContent = ... 回滚：那会把所有子元素拍成一个纯文本节点，
      // 链接/按钮就此消失。这里把捕获时保留的原节点按顺序放回去。
      el.textContent = '';
      state.childNodes.forEach((node) => el.appendChild(node));
    } else {
      el.textContent = state.textContent;
    }
    setNullableAttr(el, 'placeholder', state.placeholder);
    setNullableAttr(el, 'value', state.valueAttr);
    el.className = state.className;
    setNullableAttr(el, 'style', state.styleAttr);
  }

  function getTextStyle(el) {
    const computed = window.getComputedStyle(el);
    return {
      size: String(Math.round(parseFloat(computed.fontSize) || 14)),
      color: rgbToHex(computed.color) || '#1f2328',
      bold: parseInt(computed.fontWeight, 10) >= 600 || computed.fontWeight === 'bold',
      italic: computed.fontStyle === 'italic' || computed.fontStyle === 'oblique'
    };
  }

  function getStylePatchFromCard(shadow) {
    const sizeInput = shadow.querySelector('.font-size-input');
    const colorInput = shadow.querySelector('.font-color-input');
    const boldToggle = shadow.querySelector('.bold-toggle');
    const italicToggle = shadow.querySelector('.italic-toggle');
    const size = Math.min(300, Math.max(1, parseInt(sizeInput.value, 10) || 14));
    const patch = {};
    if (sizeInput.dataset.dirty === 'true' && String(size) !== currentCard.originalStyle.size) {
      patch.fontSize = String(size) + 'px';
    }
    if (colorInput.dataset.dirty === 'true' && (colorInput.value || '').toLowerCase() !== currentCard.originalStyle.color.toLowerCase()) {
      patch.color = colorInput.value || '#1f2328';
    }
    const bold = boldToggle.classList.contains('active');
    if (boldToggle.dataset.dirty === 'true' && bold !== currentCard.originalStyle.bold) {
      patch.fontWeight = bold ? '700' : '400';
    }
    const italic = italicToggle.classList.contains('active');
    if (italicToggle.dataset.dirty === 'true' && italic !== currentCard.originalStyle.italic) {
      patch.fontStyle = italic ? 'italic' : 'normal';
    }
    return patch;
  }

  function applyTextStyle(el, stylePatch) {
    Object.keys(stylePatch).forEach((name) => {
      el.style[name] = stylePatch[name];
    });
  }

  async function buildPatchedSource(card, nextText, textChanged, stylePatch) {
    const source = await Messaging.sendToBackground({
      type: 'READ_EDIT_SOURCE',
      fileUrl: window.location.href
    });
    if (!source || !source.success) return source || { success: false, error: { code: 'READ_FAILED' } };

    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(source.html, 'text/html');
    const sourceEl = findSafeSourceElement(sourceDoc, card);

    if (!sourceEl) {
      return buildRawPatchedSource(source.html, sourceDoc, card, nextText, textChanged, stylePatch);
    }

    const previousLocalStoragePatch = getLocalStoragePatch(sourceDoc, card.sourceLocator);
    if (textChanged) applyTextToSourceElement(sourceEl, nextText, card.targetMeta);
    if (Object.keys(stylePatch).length) applyTextStyle(sourceEl, stylePatch);

    return {
      success: true,
      html: serializeSourceDocument(sourceDoc),
      previousHtml: source.html,
      previousLocalStoragePatch: previousLocalStoragePatch,
      localStoragePatch: getLocalStoragePatch(sourceDoc, card.sourceLocator)
    };
  }

  // 兜底：源文档里定位不到节点，说明该元素是页面脚本运行时渲染出来的。
  // 退一步在源文件原始字符串上，按「标签锚定 + 唯一匹配」把文本回填进脚本模板。
  // 只在既有定位全部失败后才参与，静态页面完全不走这里。
  function buildRawPatchedSource(sourceHtml, sourceDoc, card, nextText, textChanged, stylePatch) {
    if (Object.keys(stylePatch).length) {
      // 样式改不到脚本模板里。宁可整条拒绝，也不做半截写入。
      return { success: false, error: { code: 'SOURCE_TEMPLATE_STYLE_UNSUPPORTED' } };
    }
    if (!textChanged || typeof RawPatch === 'undefined') {
      return { success: false, error: { code: 'SOURCE_TARGET_NOT_FOUND', rawReason: 'NOT_FOUND' } };
    }

    const structureExists = sourceStructureExists(sourceDoc, card);
    const result = RawPatch.patchSourceText(
      sourceHtml,
      card.targetEl.tagName.toLowerCase(),
      card.originalText,
      nextText,
      {
        anchors: collectRawAnchors(card.targetEl),
        elementClasses: card.targetEl.getAttribute('class'),
        // 源文件里本就有同路径同标签的静态结构时，说明 DOM 与源文件的差异只是文本层面
        // （被别的标签拆开、实体写法不同等），此时改到任何字面量位置都是错的。
        // 仍调用本函数以取得行号等诊断信息，但不接受任何候选。
        allowScript: !structureExists,
        allowHtml: !structureExists
      }
    );

    if (!result.ok) {
      return {
        success: false,
        error: {
          code: 'SOURCE_TARGET_NOT_FOUND',
          rawReason: result.reason,
          rawDiagnostics: result.diagnostics,
          rawStructureExists: structureExists
        }
      };
    }

    return {
      success: true,
      html: result.html,
      previousHtml: sourceHtml,
      previousLocalStoragePatch: null,
      localStoragePatch: null,
      rawHit: { line: result.line, strategy: result.strategy }
    };
  }

  // 取运行时元素的辨识性属性值，用于在多个同文案候选之间平局裁决。
  // 源文件里的值可能带 JS 转义（onclick="openRevoke(\'effect\')"），
  // 去反斜杠的比对在 RawPatch 内部完成。
  function collectRawAnchors(el) {
    const anchors = [];
    if (!el || !el.attributes) return anchors;
    ['onclick', 'href', 'title'].forEach((name) => {
      const value = el.getAttribute(name);
      if (value) anchors.push(value);
    });
    Array.prototype.forEach.call(el.attributes, (attr) => {
      if (attr.name.indexOf('data-') === 0 && attr.value) anchors.push(attr.value);
    });
    return anchors;
  }

  function getLocalStoragePatch(doc, locator) {
    const stableRoot = findSourceStableRoot(doc, locator);
    if (!stableRoot) return null;
    const editId = stableRoot.getAttribute('data-edit-id');
    if (!editId) return null;
    return {
      editId: editId,
      html: stableRoot.innerHTML
    };
  }

  function findSourceStableRoot(doc, locator) {
    if (!locator || (locator.type !== 'attr' && locator.type !== 'attrPath')) return null;
    const selector = '[' + locator.name + '="' + cssEscape(locator.value) + '"]';
    const matches = Array.from(doc.querySelectorAll(selector));
    return matches.length === 1 ? matches[0] : null;
  }

  function getSourceLocator(el) {
    const id = el.getAttribute('id');
    if (id && document.querySelectorAll('#' + cssEscape(id)).length === 1) {
      return { type: 'id', value: id };
    }

    const stableEditRoot = findStableEditRoot(el);
    if (stableEditRoot) {
      const editId = stableEditRoot.getAttribute('data-edit-id');
      if (stableEditRoot === el) {
        return { type: 'attr', name: 'data-edit-id', value: editId, stable: true };
      }
      return {
        type: 'attrPath',
        name: 'data-edit-id',
        value: editId,
        childPath: getElementPathBetween(stableEditRoot, el),
        stable: true
      };
    }
    return { type: 'path', value: getElementPath(el) };
  }

  function findStableEditRoot(el) {
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const editId = current.getAttribute && current.getAttribute('data-edit-id');
      if (editId && document.querySelectorAll('[data-edit-id="' + cssEscape(editId) + '"]').length === 1) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function findSourceElement(doc, locator) {
    if (!locator) return null;
    if (locator.type === 'id') {
      return doc.getElementById(locator.value);
    }
    if (locator.type === 'path') {
      return findElementByPath(doc, locator.value);
    }
    if (locator.type === 'attr') {
      const selector = '[' + locator.name + '="' + cssEscape(locator.value) + '"]';
      const matches = Array.from(doc.querySelectorAll(selector));
      return matches.length === 1 ? matches[0] : null;
    }
    if (locator.type === 'attrPath') {
      const selector = '[' + locator.name + '="' + cssEscape(locator.value) + '"]';
      const matches = Array.from(doc.querySelectorAll(selector));
      if (matches.length !== 1) return null;
      return findElementByRelativePath(matches[0], locator.childPath);
    }
    return null;
  }

  function findSafeSourceElement(doc, card) {
    const direct = findSourceElement(doc, card.sourceLocator);
    if (direct && card.sourceLocator && card.sourceLocator.stable && direct.tagName === card.targetEl.tagName) return direct;
    if (direct && sourceElementMatchesCard(direct, card)) return direct;

    const fallback = findSourceElementByOriginalText(doc, card);
    if (fallback) return fallback;
    return null;
  }

  function findSourceElementByOriginalText(doc, card) {
    const tagName = card.targetEl.tagName.toLowerCase();
    const candidates = Array.from(doc.querySelectorAll(tagName)).filter((el) => sourceElementMatchesCard(el, card));
    if (!candidates.length) return null;
    // 只按「同标签 + 同文本」找，会在页面里撞上另一个同文元素。
    // 典型场景：表格里 class=field-tag 的单元格，与页面另一处隐藏表单中的
    // 同文本元素撞车——只按「标签名 + 文本」匹配会静默写错目标
    // class=field-chip 的标签上（源文件 445 行），用户完全看不到变化。
    // 因此再加一道 class 兼容性校验。
    const compatible = candidates.filter((el) => sourceClassCompatible(card.targetEl, el));
    return compatible.length === 1 ? compatible[0] : null;
  }

  function sourceClassCompatible(liveEl, sourceEl) {
    if (typeof RawPatch === 'undefined' || typeof RawPatch.classCompatible !== 'function') return true;
    return RawPatch.classCompatible(
      RawPatch.classTokensOf(liveEl.getAttribute('class')),
      RawPatch.classTokensOf(sourceEl.getAttribute('class'))
    );
  }

  // 该元素在源文件里是否本就有同路径同标签的静态结构。
  // 是 → 说明 DOM 与源文件的差异只是文本层面，绝不能去改 <script> 里的模板。
  function sourceStructureExists(sourceDoc, card) {
    const direct = findSourceElement(sourceDoc, card.sourceLocator);
    return !!(direct && direct.tagName === card.targetEl.tagName);
  }

  function sourceElementMatchesCard(el, card) {
    return getSourceEditableText(el, card.targetMeta.kind).trim() === card.originalText;
  }

  function getSourceEditableText(el, kind) {
    if (kind === 'input-value') return el.getAttribute('value') || '';
    if (kind === 'placeholder') return el.getAttribute('placeholder') || '';
    if (kind === 'textarea-text') return el.textContent || '';

    const textNodes = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
    const primary = textNodes.find((node) => node.textContent.trim());
    return primary ? primary.textContent : (el.textContent || '');
  }

  function getElementPath(el) {
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      let index = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tag) index += 1;
        sibling = sibling.previousElementSibling;
      }
      path.unshift({ tag: tag, index: index });
      if (current === document.documentElement) break;
      current = current.parentElement;
    }
    return path;
  }

  function getElementPathBetween(root, el) {
    const path = [];
    let current = el;
    while (current && current !== root && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      let index = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tag) index += 1;
        sibling = sibling.previousElementSibling;
      }
      path.unshift({ tag: tag, index: index });
      current = current.parentElement;
    }
    return current === root ? path : [];
  }

  function findElementByRelativePath(root, path) {
    let current = root;
    for (const item of path || []) {
      const matches = Array.from(current.children).filter((child) => child.tagName.toLowerCase() === item.tag);
      current = matches[item.index];
      if (!current) return null;
    }
    return current;
  }

  function findElementByPath(doc, path) {
    if (!path || !path.length) return null;
    let current = doc.documentElement;
    if (!current || current.tagName.toLowerCase() !== path[0].tag) return null;
    for (let i = 1; i < path.length; i += 1) {
      const item = path[i];
      const matches = Array.from(current.children).filter((child) => child.tagName.toLowerCase() === item.tag);
      current = matches[item.index];
      if (!current) return null;
    }
    return current;
  }

  function applyTextToSourceElement(el, nextText, targetMeta) {
    if (targetMeta.kind === 'input-value') {
      el.setAttribute('value', nextText);
      return;
    }
    if (targetMeta.kind === 'placeholder') {
      el.setAttribute('placeholder', nextText);
      return;
    }
    if (targetMeta.kind === 'textarea-text') {
      el.textContent = nextText;
      el.removeAttribute('value');
      return;
    }

    const textNodes = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
    const primary = textNodes.find((node) => node.textContent.trim());
    if (primary) {
      primary.textContent = preserveOuterWhitespace(primary.textContent, nextText);
    } else {
      el.textContent = nextText;
    }
  }

  function serializeSourceDocument(doc) {
    const doctype = doc.doctype ? '<!DOCTYPE ' + doc.doctype.name + '>\n' : '<!DOCTYPE html>\n';
    return doctype + doc.documentElement.outerHTML;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\#.;:[\]>+~*^$|=,\s]/g, '\\$&');
  }

  function rgbToHex(value) {
    const match = value && value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return '';
    return '#' + [match[1], match[2], match[3]].map((part) => {
      return Number(part).toString(16).padStart(2, '0');
    }).join('');
  }

  function setNullableAttr(el, name, value) {
    if (value === null || value === undefined) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function markEdited(el) {
    if (!el.classList.contains(EDITED_CLASS)) el.classList.add(EDITED_CLASS);
  }

  function unmarkEdited(el) {
    el.classList.remove(EDITED_CLASS);
  }

  function clearEditedMarks() {
    document.querySelectorAll('.' + EDITED_CLASS).forEach((el) => {
      el.classList.remove(EDITED_CLASS);
    });
  }

  // 返回「这次是否真的关掉了什么」，供 Esc 判断要不要继续往下做别的事。
  // 编辑器自己的高亮标记（highlightOverlay）随卡片一起清掉；
  // 注意这与「标注高亮」是两个不同的东西，后者绝不在这里碰。
  function closeCard() {
    const hadCard = !!currentCard;
    if (currentCard) {
      currentCard.container.remove();
      currentCard = null;
    }
    // 卡片没了就不该再等授权回执，否则标志会永久悬挂，
    // 之后任何一次授权完成都会去保存一张用户没要求保存的卡。
    pendingAuthCard = null;

    const hadHighlight = !!highlightOverlay;
    removeHighlight();
    return hadCard || hadHighlight;
  }

  // 焦点是否落在用户正在打字的控件上。
  // 用于避免插件的全局快捷键劫持页面输入框的原生行为（尤其 Ctrl+Z 撤销）。
  function isTypingTarget(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function handleKeyDown(e) {
    if (!isActive) return false;
    // 用户正在页面输入框里打字时，Ctrl+Z 必须交还给页面
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'
      && !currentCard && lastUndo && !isTypingTarget(document.activeElement)) {
      e.preventDefault();
      undoLastEdit();
      return true;
    }
    if (e.key === 'Escape') {
      closeCard();
      removeHighlight();
      return true;
    }
    if (e.key === 'Enter' && currentCard) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        insertTextareaNewline(currentCard.shadow.querySelector('.new-text-input'));
      } else {
        confirmEdit();
      }
      return true;
    }
    return false;
  }

  function insertTextareaNewline(textarea) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const value = textarea.value;
    textarea.value = value.slice(0, start) + '\n' + value.slice(end);
    textarea.selectionStart = start + 1;
    textarea.selectionEnd = start + 1;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function undoLastEdit() {
    if (!lastUndo) return;
    const undo = lastUndo;
    lastUndo = null;
    clearUndoToast();

    const response = await Messaging.sendToBackground({
      type: 'SAVE_EDITED_HTML',
      fileUrl: undo.fileUrl,
      pageName: undo.pageName,
      html: undo.previousHtml
    });

    if (!response || !response.success) {
      lastUndo = undo;
      showUndoToast(formatSaveError(response && response.error), true);
      return;
    }

    if (undo.targetEl && undo.targetEl.isConnected) {
      restoreElementState(undo.targetEl, undo.snapshot);
    }
    syncEditableLocalStorage(undo.previousLocalStoragePatch);
    editedCount = Math.max(0, editedCount - 1);
    Messaging.sendToBackground({ type: 'EDIT_STATE_CHANGED', delta: -1 });
    showUndoToast('已撤销上一次修改', false, 2000);
  }

  function showUndoToast(message, keepUndo, duration) {
    clearUndoToast();

    const el = document.createElement('div');
    el.className = '__proto_editor_undo_toast__';
    el.__proto_annotator = true;
    el.style.cssText =
      'position:fixed;right:18px;bottom:84px;z-index:2147483647;' +
      'display:flex;align-items:center;gap:12px;max-width:360px;' +
      'padding:10px 12px;border-radius:8px;background:#1f2328;color:#fff;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;' +
      'opacity:1;transition:opacity .18s ease;pointer-events:auto;';

    const text = document.createElement('span');
    text.textContent = message;
    text.style.cssText = 'min-width:0;word-break:break-word;';
    el.appendChild(text);

    if (keepUndo !== false && lastUndo) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '撤销';
      btn.style.cssText =
        'height:26px;padding:0 10px;border:0;border-radius:6px;background:#22c55e;color:#fff;' +
        'font:12px/26px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-weight:600;cursor:pointer;flex-shrink:0;';
      btn.addEventListener('click', () => {
        undoLastEdit();
      });
      el.appendChild(btn);
    }

    document.body.appendChild(el);

    undoToast = el;
    const expiresUndo = keepUndo !== false;
    undoToastTimer = setTimeout(() => {
      if (expiresUndo) lastUndo = null;
      clearUndoToast();
    }, duration || 10000);
  }

  function clearUndoToast() {
    if (undoToastTimer) {
      clearTimeout(undoToastTimer);
      undoToastTimer = null;
    }
    if (undoToast) {
      const el = undoToast;
      undoToast = null;
      el.style.opacity = '0';
      setTimeout(() => {
        if (el.parentNode) el.remove();
      }, 180);
    }
  }

  function getEditState() {
    return { count: editedCount };
  }

  function formatSaveError(error) {
    const code = error && error.code;
    if (code === 'NO_DIRECTORY') return '尚未授权原型目录，请在扩展弹窗中授权后重试';
    if (code === 'DIRECTORY_REAUTH_REQUIRED') return '目录路径信息缺失，请在扩展弹窗中重新授权';
    if (code === 'PERMISSION_PROMPT_REQUIRED') return '目录权限需要重新确认，请在扩展弹窗中重新授权';
    if (code === 'PERMISSION_DENIED') return '目录写入权限被拒绝，请在扩展弹窗中重新授权';
    if (code === 'OUTSIDE_DIRECTORY') return '当前文件不在已授权目录内';
    if (code === 'FILE_NOT_FOUND') return '找不到当前页面对应的 HTML 文件';
    if (code === 'READ_FAILED') return '读取源 HTML 失败，请检查文件是否可访问';
    if (code === 'READ_TIMEOUT') return '读取源 HTML 超时，请检查商店版扩展的文件访问权限后重试';
    if (code === 'WRITE_FAILED') return '写入 HTML 失败，请检查文件是否被占用或不可写';
    if (code === 'WRITE_TIMEOUT') return '写入 HTML 超时，请检查文件是否被占用，或重新授权目录后重试';
    if (code === 'BACKGROUND_TIMEOUT') return '保存响应超时，请重新打开页面或在扩展弹窗中重新授权目录后重试';
    if (code === 'BACKGROUND_UNAVAILABLE') return '扩展后台暂时不可用，请稍后重试';
    if (code === 'SOURCE_TEMPLATE_STYLE_UNSUPPORTED') {
      return '这个元素由页面脚本动态渲染，只能改文字，暂不支持改样式';
    }
    if (code === 'SOURCE_TARGET_NOT_FOUND') {
      return '无法在源 HTML 中定位当前元素\n' + describeSourceMiss(error);
    }
    if (code === 'UNSUPPORTED') return '当前浏览器不支持目录写入能力';
    return '保存失败，请重新授权目录后重试';
  }

  // 定位失败时给出可执行线索，而不是让用户反复刷新页面
  function describeSourceMiss(error) {
    const reason = error && error.rawReason;
    const diagnostics = error && error.rawDiagnostics;
    const lines = [];

    if (error && error.rawStructureExists) {
      lines.push('这个元素在源 HTML 里是静态存在的，但它的文字被 <b>、<br> 之类标签拆开了（或写法与源文件不同），无法自动定位。');
      lines.push('请直接打开源 HTML 修改对应位置。');
      return lines.join('\n');
    }

    if (reason === 'AMBIGUOUS' && diagnostics && diagnostics.candidates && diagnostics.candidates.length) {
      const where = diagnostics.candidates.map((item) => '第 ' + item.line + ' 行').join('、');
      lines.push('这段文字在源文件里有 ' + diagnostics.candidates.length + ' 处相同写法（' + where + '），无法安全判断是哪一处。');
      lines.push('请直接修改源 HTML 中对应位置。');
      return lines.join('\n');
    }

    if (reason === 'LOW_INFORMATION') {
      lines.push('这段文字太短，或者只由数字与符号组成，无法在源文件里安全定位。');
      lines.push('它多半是页面脚本用数据渲染出来的，请直接修改脚本里的数据字段。');
      return lines.join('\n');
    }

    if (reason === 'UNSAFE_CHAR') {
      lines.push('这个元素由页面脚本动态渲染，新文字里不能包含引号、反斜杠、尖括号或换行。');
      lines.push('（这些字符会破坏源文件里的脚本）');
      return lines.join('\n');
    }

    if (reason === 'TOO_LONG') {
      lines.push('新文字过长，无法安全回填到页面脚本里。');
      lines.push('请直接修改源 HTML。');
      return lines.join('\n');
    }

    if (diagnostics && diagnostics.occurrences && diagnostics.occurrences.length) {
      const inScript = diagnostics.occurrences.filter((item) => item.inScript);
      if (inScript.length) {
        lines.push('这段文字由页面脚本生成，源文件里出现在第 ' + inScript[0].line + ' 行附近的脚本中。');
        lines.push('请直接修改该脚本的模板或数据字段。');
        return lines.join('\n');
      }
      if (diagnostics.occurrences.every((item) => item.inComment)) {
        lines.push('这段文字在源文件里只出现在注释中，没有对应的真实元素。');
        lines.push('请直接修改源 HTML。');
        return lines.join('\n');
      }
    }

    lines.push('源文件里没有与这段文字对应的元素。两种可能：');
    lines.push('1) 它是页面脚本运行时渲染出来的（例如数据字段）——请改源 HTML 里的脚本模板或数据字段，刷新页面无效；');
    lines.push('2) 当前页面内容和源文件已经不一致（比如上一次编辑没保存成功、留下了残留文字）——这种情况下刷新页面即可恢复原状。');
    return lines.join('\n');
  }

  // 回填的是脚本模板而不是单个元素，改动会影响所有使用该模板的位置，需要明确告知
  // ───────────────── 授权联动：失败即时授权 + 自动重试 ─────────────────
  // 设计原则：切模式不拦授权，只有真要落盘时才需要。
  // 所以保存因授权/路径失败时，弹出授权小窗；授权成功后自动重试这一次保存，
  // 用户的文字不会丢。
  const AUTH_ERROR_CODES = [
    'NO_DIRECTORY',
    'PERMISSION_PROMPT_REQUIRED',
    'PERMISSION_DENIED',
    'DIRECTORY_REAUTH_REQUIRED',
    'OUTSIDE_DIRECTORY'
  ];

  // 待重试保存的那张卡：用对象引用做身份，避免「授权成功后拿旧意图保存了新内容」
  let pendingAuthCard = null;
  // 每张卡最多自动弹一次授权窗：防止「授权成功 → 重试 → 仍失败 → 再弹窗」死循环
  let authAutoOpenedForCard = null;

  function isAuthError(error) {
    return !!error && AUTH_ERROR_CODES.indexOf(error.code) !== -1;
  }

  function maybeRequestAuth(error) {
    if (!isAuthError(error)) return;
    // 已经有一次待重试的授权：不重复开窗（连点两次「确认修改」不该弹两个窗）
    if (pendingAuthCard) return;
    // 同一张卡已经自动弹过一次、授权后仍然失败 → 说明重授权解决不了，别再弹
    if (authAutoOpenedForCard === currentCard) {
      showUndoToast(describeAuthStuck(error), false, 4200);
      return;
    }
    authAutoOpenedForCard = currentCard;
    pendingAuthCard = currentCard;
    Messaging.sendToBackground({
      type: 'REQUEST_AUTH',
      code: error && error.code,
      fileUrl: window.location.href,
      tabUrl: window.location.href
    }).catch(() => {});
  }

  // 「重新授权也修不好」的那类原因，直接把正确动作告诉用户，
  // 否则用户会反复点「重新授权」而问题永远不消失（授权死循环）。
  function describeAuthStuck(error) {
    const code = error && error.code;
    if (code === 'OUTSIDE_DIRECTORY') {
      return '这个文件不在已授权的文件夹里，重新授权无效：请在扩展弹窗里改选一个包含它的文件夹。';
    }
    if (code === 'DIRECTORY_REAUTH_REQUIRED') {
      return '授权记录不完整，请在扩展弹窗里重新选择目录。';
    }
    return '授权后仍无法保存，请在扩展弹窗里检查目录设置。';
  }

  // 授权小窗完成后由 content.js 调过来
  function onAuthCompleted(ok) {
    const card = pendingAuthCard;
    pendingAuthCard = null;
    if (!ok || !card) return;
    // 卡片已被 Esc 关掉、或用户换了另一个元素 → 不拿旧意图去保存
    if (currentCard !== card) return;
    showUndoToast('授权完成，正在重试保存…', false, 1600);
    confirmEdit();
  }

  // 快捷键切换失败（例如脚本注入失败）也要让用户看到
  function showModeSwitchError(error) {
    const code = error && error.code;
    const text = code === 'INJECTION_FAILED'
      ? '无法在当前页面启用：请刷新页面后重试'
      : '模式切换失败，请刷新页面后重试';
    showUndoToast(text, false, 2600);
  }

  function describeRawHit(patchedSource) {
    if (!patchedSource || !patchedSource.rawHit) return '';
    return '（脚本模板：源文件第 ' + patchedSource.rawHit.line + ' 行，使用该模板的位置会一起变化）';
  }

  function isToolElement(el) {
    if (!el) return false;
    let current = el;
    while (current) {
      if (current.id && (current.id.startsWith('__proto_annotator') || current.id.startsWith('__proto_editor'))) return true;
      if (current.classList) {
        for (const className of current.classList) {
          if (className.indexOf('__proto_annotator') === 0) return true;
          if (className.indexOf('__proto_editor') === 0 && className !== EDITED_CLASS) return true;
        }
      }
      if (current.__proto_annotator) return true;
      current = current.parentElement;
    }
    return false;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function getCardStyles() {
    return '' +
      '.card{position:fixed;z-index:2147483647;width:360px;background:#fff;border-radius:10px;' +
      'box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.08);font-family:-apple-system,"Inter",BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;color:#1f2328;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;overflow:hidden;}' +
      '.card-visible{opacity:1;transform:translateY(0);}' +
      '.type-indicator{padding:10px 16px;font-weight:600;font-size:13px;color:#16a34a;border-bottom:1px solid #eaeef2;}' +
      '.card-body{padding:12px 16px;}' +
      'label{display:block;font-size:11px;color:#6e7781;margin-bottom:4px;font-weight:500;}' +
      '.original-text{padding:8px 10px;background:#fafafa;border-radius:5px;font-size:12px;color:#6e7781;margin-bottom:8px;word-break:break-all;max-height:80px;overflow:auto;}' +
      '.new-text-input{width:100%;padding:8px 10px;border:1px solid #d8dee4;border-radius:5px;font-size:12px;font-family:inherit;outline:none;resize:vertical;min-height:70px;box-sizing:border-box;color:#1f2328;background:#fff;}' +
      '.new-text-input:focus{border-color:#22c55e;}' +
      '.style-grid{display:grid;grid-template-columns:112px 64px 1fr;gap:10px;align-items:end;margin-top:10px;}' +
      '.style-field label{margin-bottom:4px;}' +
      '.size-control{display:flex;align-items:center;height:32px;border:1px solid #d8dee4;border-radius:6px;background:#fff;overflow:hidden;}' +
      '.size-control input{width:72px;height:30px;padding:0 8px;border:0;outline:none;font:inherit;color:#1f2328;background:transparent;box-sizing:border-box;}' +
      '.size-control span{color:#6e7781;font-size:11px;padding-right:8px;}' +
      '.font-color-input{width:64px;height:32px;padding:3px;border:1px solid #d8dee4;border-radius:6px;background:#fff;cursor:pointer;box-sizing:border-box;}' +
      '.toggle-row{display:flex;gap:6px;}' +
      '.toggle-btn{width:32px;height:32px;border:1px solid #d8dee4;border-radius:6px;background:#fff;color:#1f2328;font-size:13px;font-weight:700;line-height:30px;cursor:pointer;transition:background .15s,border-color .15s,color .15s;}' +
      '.italic-toggle{font-style:italic;}' +
      '.toggle-btn.active{background:rgba(34,197,94,.12);border-color:#22c55e;color:#15803d;}' +
      '.error{min-height:18px;margin-top:6px;color:#d1242f;font-size:11px;line-height:18px;white-space:pre-line;}' +
      '.card-actions{display:flex;justify-content:flex-end;gap:8px;padding:8px 16px 12px;border-top:1px solid #eaeef2;}' +
      '.btn{height:32px;padding:0 16px;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:500;transition:background .15s;}' +
      '.btn:disabled{opacity:.7;cursor:not-allowed;}' +
      '.btn-cancel{background:#f6f8fa;color:#6e7781;}.btn-cancel:hover{background:#eaeef2;}' +
      '.btn-confirm{background:#22c55e;color:#fff;}.btn-confirm:hover{background:#16a34a;}' +
      '@media (prefers-color-scheme:dark){.card{background:#161b22;color:#e6edf3}.type-indicator{border-bottom-color:#21262d;color:#4ade80}.original-text{background:#1c2128;color:#8b949e}.new-text-input{background:#1c2128;color:#e6edf3;border-color:#30363d}.new-text-input:focus{border-color:#22c55e}.size-control,.font-color-input,.toggle-btn{background:#1c2128;border-color:#30363d;color:#e6edf3}.size-control input{color:#e6edf3}.toggle-btn.active{background:rgba(34,197,94,.18);border-color:#22c55e;color:#4ade80}.card-actions{border-top-color:#21262d}.btn-cancel{background:#1c2128;color:#8b949e}.btn-cancel:hover{background:#21262d}}';
  }

  return {
    activate,
    deactivate,
    closeCard,
    handleKeyDown,
    getEditState,
    onAuthCompleted,
    showModeSwitchError,
    // 仅供自动化测试使用，不属于对外 API。
    // 回滚逻辑是内部函数，不暴露就没法验证「回滚是否销毁了子元素」。
    __test: {
      captureElementState: captureElementState,
      restoreElementState: restoreElementState
    }
  };
})();
