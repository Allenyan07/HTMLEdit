const Editor = (() => {
  const EDITED_CLASS = '__proto_editor_edited__';
  const TARGET_SELECTOR = 'input, textarea, button, a, label, span, p, div, h1, h2, h3, h4, h5, h6, td, th, li';

  let isActive = false;
  let hoveredElement = null;
  let highlightOverlay = null;
  let currentCard = null;
  let editedCount = 0;

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
    clearEditedMarks();
  }

  function onMouseOver(e) {
    if (!isActive) return;
    if (isToolElement(e.target)) return;

    const target = findEditableTarget(e.target);
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

    const target = findEditableTarget(e.target);
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

    const target = findEditableTarget(e.target);
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();
    removeHighlight();
    hoveredElement = null;
    showCard(target, { left: e.clientX, top: e.clientY });
  }

  function findEditableTarget(startEl) {
    if (!startEl || startEl.nodeType !== Node.ELEMENT_NODE) return null;

    let el = startEl.closest(TARGET_SELECTOR);
    while (el && el !== document.body && el !== document.documentElement) {
      if (!isToolElement(el) && getEditableText(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function getEditableText(el) {
    if (!el) return '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return (el.value || el.getAttribute('value') || el.placeholder || '').trim();
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

  function applyText(el, nextText) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.value || el.hasAttribute('value')) {
        el.value = nextText;
        el.setAttribute('value', nextText);
      } else {
        el.placeholder = nextText;
        el.setAttribute('placeholder', nextText);
      }
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

    const originalText = getEditableText(targetEl);
    const originalStyle = getTextStyle(targetEl);
    const container = document.createElement('div');
    container.id = '__proto_editor_card__';
    container.__proto_annotator = true;
    const shadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getCardStyles();
    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = buildCardHTML(originalText, originalStyle);
    shadow.appendChild(card);
    document.body.appendChild(container);

    currentCard = { container, shadow, card, targetEl, originalText, originalStyle };
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

  function buildCardHTML(originalText, originalStyle) {
    return '' +
      '<div class="type-indicator">编辑文本</div>' +
      '<div class="card-body">' +
      '  <label>原文本</label>' +
      '  <div class="original-text">' + escapeHtml(originalText) + '</div>' +
      '  <label>修改为</label>' +
      '  <textarea class="new-text-input" rows="3" placeholder="输入新文本...">' + escapeHtml(originalText) + '</textarea>' +
      '  <div class="style-grid">' +
      '    <div class="style-field">' +
      '      <label>字号</label>' +
      '      <div class="size-control"><input type="number" class="font-size-input" min="8" max="96" step="1" value="' + escapeHtml(originalStyle.size) + '" /><span>px</span></div>' +
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
        btn.classList.toggle('active');
      });
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
    const nextStyle = getStyleFromCard(currentCard.shadow);
    const textChanged = nextText !== currentCard.originalText;
    const styleChanged = isStyleChanged(nextStyle, currentCard.originalStyle);

    if (!nextText) {
      error.textContent = '修改文本不能为空';
      return;
    }
    if (!textChanged && !styleChanged) {
      error.textContent = '文字和样式都没有变化';
      return;
    }

    const snapshot = captureElementState(currentCard.targetEl);
    confirmBtn.disabled = true;
    confirmBtn.textContent = '保存中...';
    error.textContent = '';

    if (textChanged) applyText(currentCard.targetEl, nextText);
    if (styleChanged) applyTextStyle(currentCard.targetEl, nextStyle);
    markEdited(currentCard.targetEl);

    const response = await Messaging.sendToBackground({
      type: 'SAVE_EDITED_HTML',
      fileUrl: window.location.href,
      pageName: ProtoStorage.getPageName(),
      html: buildCleanHTML()
    });

    if (!response || !response.success) {
      restoreElementState(currentCard.targetEl, snapshot);
      unmarkEdited(currentCard.targetEl);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认修改';
      error.textContent = formatSaveError(response && response.error);
      return;
    }

    editedCount += 1;
    Messaging.sendToBackground({ type: 'EDIT_STATE_CHANGED', count: editedCount });
    const pageName = ProtoStorage.getPageName();
    closeCard();
    Annotator.showToast('已修改并保存到 ' + pageName);
  }

  function captureElementState(el) {
    return {
      value: el.value,
      textContent: el.textContent,
      placeholder: el.getAttribute('placeholder'),
      valueAttr: el.getAttribute('value'),
      className: el.className,
      styleAttr: el.getAttribute('style')
    };
  }

  function restoreElementState(el, state) {
    if ('value' in el) el.value = state.value;
    el.textContent = state.textContent;
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

  function getStyleFromCard(shadow) {
    const sizeInput = shadow.querySelector('.font-size-input');
    const colorInput = shadow.querySelector('.font-color-input');
    const size = Math.min(96, Math.max(8, parseInt(sizeInput.value, 10) || 14));
    return {
      size: String(size),
      color: colorInput.value || '#1f2328',
      bold: shadow.querySelector('.bold-toggle').classList.contains('active'),
      italic: shadow.querySelector('.italic-toggle').classList.contains('active')
    };
  }

  function isStyleChanged(nextStyle, originalStyle) {
    return nextStyle.size !== originalStyle.size
      || nextStyle.color.toLowerCase() !== originalStyle.color.toLowerCase()
      || nextStyle.bold !== originalStyle.bold
      || nextStyle.italic !== originalStyle.italic;
  }

  function applyTextStyle(el, style) {
    el.style.fontSize = style.size + 'px';
    el.style.color = style.color;
    el.style.fontWeight = style.bold ? '700' : '400';
    el.style.fontStyle = style.italic ? 'italic' : 'normal';
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

  function buildCleanHTML() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[id^="__proto_annotator"], [id^="__proto_editor"], .__proto_annotator_badge__, .__proto_annotator_area_overlay__, .__proto_annotator_toast__, .__proto_editor_highlight__').forEach((el) => {
      el.remove();
    });
    clone.querySelectorAll('.' + EDITED_CLASS).forEach((el) => {
      el.classList.remove(EDITED_CLASS);
      if (!el.getAttribute('class')) el.removeAttribute('class');
    });
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function closeCard() {
    if (currentCard) {
      currentCard.container.remove();
      currentCard = null;
    }
  }

  function handleKeyDown(e) {
    if (!isActive) return false;
    if (e.key === 'Escape') {
      closeCard();
      removeHighlight();
      return true;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (currentCard) {
        e.preventDefault();
        confirmEdit();
        return true;
      }
    }
    return false;
  }

  function getEditState() {
    return { count: editedCount };
  }

  function formatSaveError(error) {
    const code = error && error.code;
    if (code === 'NO_DIRECTORY') return '尚未授权原型目录，请在扩展弹窗中授权后重试';
    if (code === 'PERMISSION_DENIED') return '写入权限已失效，请在扩展弹窗中重新授权';
    if (code === 'OUTSIDE_DIRECTORY') return '当前文件不在已授权目录内';
    if (code === 'FILE_NOT_FOUND') return '找不到当前页面对应的 HTML 文件';
    if (code === 'UNSUPPORTED') return '当前浏览器不支持目录写入能力';
    return '保存失败，请重新授权目录后重试';
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
      '.error{min-height:18px;margin-top:6px;color:#d1242f;font-size:11px;line-height:18px;}' +
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
    getEditState
  };
})();
