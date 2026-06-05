const Annotator = (() => {
  let isActive = false;
  let currentCard = null;
  let hoveredElement = null;
  let highlightOverlay = null;
  const badges = [];
  const areaOverlays = [];
  let rafId = null;
  let capturedSelection = null;
  let scrollResizeHandler = null;

  function activate() {
    if (isActive) return;
    isActive = true;
    console.log('[ProtoAnnotator] Annotator activated, page:', ProtoStorage.getPageName());
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onMouseDown, true);
    AreaSelector.activate(onAreaSelected);
    restoreBadges();
    startBadgePositionUpdate();
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    AreaSelector.deactivate();
    removeHighlight();
    removeHighlightAnnotation();
    closeCard();
    clearBadges();
    clearAreaOverlays();
    stopBadgePositionUpdate();
  }

  function onMouseOver(e) {
    if (!isActive) return;
    if (AreaSelector.isDragInProgress()) return;
    if (isAnnotatorElement(e.target)) return;
    if (hoveredElement !== e.target) {
      removeHighlight();
      hoveredElement = e.target;
      showHighlight(hoveredElement);
    }
  }

  function onMouseDown(e) {
    capturedSelection = null;
    if (!isActive) return;
    if (!e.shiftKey) return;
    if (isAnnotatorElement(e.target)) return;

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      const el = e.target;
      if (el.selectionStart !== undefined && el.selectionEnd !== undefined
        && el.selectionStart !== el.selectionEnd) {
        capturedSelection = {
          text: el.value.substring(el.selectionStart, el.selectionEnd),
          element: el
        };
        return;
      }
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
      const range = sel.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      let targetEl = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
      if (targetEl && e.target !== targetEl && !e.target.contains(targetEl)
        && !targetEl.contains(e.target)) {
        capturedSelection = {
          text: sel.toString().trim(),
          element: targetEl
        };
      }
    }
  }

  function onMouseOut(e) {
    if (!isActive) return;
    if (AreaSelector.isDragInProgress()) return;
    if (isAnnotatorElement(e.target)) return;
    if (e.target === hoveredElement) {
      removeHighlight();
      hoveredElement = null;
    }
  }

  function onClick(e) {
    if (!isActive) return;
    if (!e.shiftKey) return;
    if (AreaSelector.isDragInProgress()) return;
    if (AreaSelector.hasDragJustCompleted()) return;
    if (isAnnotatorElement(e.target)) return;

    let targetEl = e.target;
    let selectedText = '';

    if (capturedSelection && capturedSelection.element) {
      targetEl = capturedSelection.element;
      selectedText = capturedSelection.text;
      capturedSelection = null;
    }

    console.log('[ProtoAnnotator] Shift+click detected on:', targetEl.tagName, (targetEl.textContent || targetEl.value || '').substring(0, 30));
    e.preventDefault();
    e.stopPropagation();
    removeHighlight();
    hoveredElement = null;
    showCard(targetEl, { left: e.clientX, top: e.clientY }, null, selectedText);
  }

  function isAnnotatorElement(el) {
    if (!el) return false;
    let current = el;
    while (current) {
      if (current.className && typeof current.className === 'string') {
        if (current.className.startsWith('__proto_annotator')) return true;
      }
      if (current.id && current.id.startsWith('__proto_annotator')) return true;
      if (current.host && current.host.__proto_annotator) return true;
      current = current.parentElement;
    }
    return false;
  }

  function showHighlight(el) {
    if (!el) return;
    highlightOverlay = document.createElement('div');
    highlightOverlay.className = '__proto_annotator_highlight__';
    const rect = el.getBoundingClientRect();
    highlightOverlay.style.cssText =
      'position:fixed;' +
      'left:' + rect.left + 'px;' +
      'top:' + rect.top + 'px;' +
      'width:' + rect.width + 'px;' +
      'height:' + rect.height + 'px;' +
      'border:2px solid #1976d2;' +
      'background:rgba(25,118,210,0.08);' +
      'pointer-events:none;' +
      'z-index:2147483640;' +
      'border-radius:2px;' +
      'transition:all 0.15s ease;';
    document.body.appendChild(highlightOverlay);
  }

  function removeHighlight() {
    if (highlightOverlay) {
      highlightOverlay.remove();
      highlightOverlay = null;
    }
  }

  function showCard(targetEl, position, areaRect, selectedText) {
    closeCard();
    const originalText = areaRect ? '' : (selectedText || SelectorUtils.getElementText(targetEl));
    const selector = areaRect ? '' : SelectorUtils.generateSelector(targetEl);
    const htmlContext = areaRect ? '' : SelectorUtils.getElementHTML(targetEl);

    const container = document.createElement('div');
    container.id = '__proto_annotator_card__';
    const shadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getCardStyles();
    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = buildCardHTML(originalText, areaRect);
    shadow.appendChild(card);

    document.body.appendChild(container);
    currentCard = { container, shadow, card, targetEl, selector, htmlContext, originalText, areaRect };

    positionCard(card, position);
    bindCardEvents(card, shadow);

    requestAnimationFrame(() => {
      card.classList.add('card-visible');
    });
  }

  function positionCard(card, position) {
    const cardWidth = 340;
    const cardHeight = 280;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = position.left + 10;
    let top = position.top + 10;

    if (left + cardWidth > viewportWidth - 10) {
      left = viewportWidth - cardWidth - 10;
    }
    if (top + cardHeight > viewportHeight - 10) {
      top = position.top - cardHeight - 10;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function buildCardHTML(originalText, areaRect) {
    const isArea = !!areaRect;
    const header = isArea
      ? '<div class="type-indicator">📍 区域标注</div>' +
        (areaRect ? '<div class="area-size-hint">' + Math.round(areaRect.width) + ' × ' + Math.round(areaRect.height) + ' px</div>' : '')
      : '<div class="type-indicator">✏️ 元素标注</div>';

    const textFields = isArea
      ? ''
      : '<div class="field-group text-fields">' +
        '<label>原文本</label>' +
        '<div class="original-text">' + escapeHtml(originalText) + '</div>' +
        '<label>修改为 <span class="label-hint">（选填）</span></label>' +
        '<input type="text" class="new-text-input" placeholder="直接改文字…" />' +
        '</div>';

    const noteField = '<div class="field-group note-fields">' +
      '<label>修改说明 <span class="label-hint">（改颜色、位置、交互等）</span></label>' +
      '<textarea class="note-input" placeholder="描述需要怎么改…" rows="3"></textarea>' +
      '</div>';

    return header +
      '<div class="card-body">' +
      textFields +
      noteField +
      '</div>' +
      '<div class="card-actions">' +
      '<button class="btn btn-cancel">取消</button>' +
      '<button class="btn btn-confirm">确认</button>' +
      '</div>';
  }

  function bindCardEvents(card, shadow) {
    shadow.querySelector('.btn-cancel').addEventListener('click', () => {
      closeCard();
    });

    shadow.querySelector('.btn-confirm').addEventListener('click', () => {
      saveAnnotation(card, shadow);
    });

    const textInput = shadow.querySelector('.new-text-input');
    const noteInput = shadow.querySelector('.note-input');
    if (textInput) textInput.focus();
    if (!textInput && noteInput) noteInput.focus();
  }

  async function saveAnnotation(card, shadow) {
    if (!currentCard) return;

    const isArea = !!currentCard.areaRect;
    const newText = shadow.querySelector('.new-text-input')?.value?.trim() || '';
    const note = shadow.querySelector('.note-input')?.value?.trim() || '';

    // At least one field must be filled
    if (!newText && !note) return;

    // Determine type based on what user filled in
    let type;
    if (isArea) {
      type = 'area';
    } else if (newText) {
      type = 'text';
    } else {
      type = 'note';
    }

    // Build areaRect with page context for reproducibility
    let areaRectWithContext = null;
    if (isArea && currentCard.areaRect) {
      areaRectWithContext = {
        ...currentCard.areaRect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      };
    }

    const id = await ProtoStorage.getNextId();
    const annotation = {
      id: id,
      type: type,
      pageName: ProtoStorage.getPageName(),
      selector: currentCard.selector,
      originalText: currentCard.originalText,
      newText: newText,
      note: note,
      areaRect: areaRectWithContext,
      status: 'pending',
      htmlContext: currentCard.htmlContext,
      createdAt: new Date().toISOString(),
      isTopFrame: Messaging.isTopFrame
    };

    await ProtoStorage.addAnnotation(annotation);
    Messaging.broadcastAnnotationChange('ANNOTATION_CREATED', annotation);

    if (annotation.areaRect) {
      showAreaOverlay(annotation);
    } else {
      showBadge(annotation);
    }

    closeCard();
    showToast('标注 ' + annotation.id + ' 已保存');
  }

  function closeCard() {
    if (currentCard) {
      currentCard.container.remove();
      currentCard = null;
    }
  }

  function showBadge(annotation) {
    if (!annotation.selector) return;
    let el = SelectorUtils.findElement(annotation.selector);
    
    if (!el && annotation.originalText) {
      el = findElementByText(annotation.originalText);
    }

    const badge = document.createElement('div');
    badge.className = '__proto_annotator_badge__';
    badge.dataset.annotationId = annotation.id;
    badge.textContent = annotation.id;
    badge.title = annotation.type === 'text'
      ? annotation.originalText + ' → ' + annotation.newText
      : annotation.note;

    // Status-based badge styling
    if (annotation.status === 'done') {
      badge.classList.add('__proto_annotator_badge_status_done__');
      badge.textContent = annotation.id + ' ✓';
    } else if (annotation.status === 'rejected') {
      badge.classList.add('__proto_annotator_badge_status_rejected__');
      badge.textContent = annotation.id + ' ✗';
    }

    if (el) {
      updateBadgePosition(badge, el);
    } else {
      badge.classList.add('__proto_annotator_badge_missing__');
      badge.title = '[元素已变更] ' + badge.title;
      const missingCount = badges.filter(b => !b.element).length;
      badge.style.top = (10 + missingCount * 26) + 'px';
    }

    document.body.appendChild(badge);
    badges.push({ badge, annotation, element: el });

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      highlightAnnotation(annotation.id);
    });
  }

  function findElementByText(text) {
    if (!text) return null;
    // Use a safe approach: walk text nodes instead of XPath string concatenation
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (node.textContent.trim().includes(text)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    const textNode = walker.nextNode();
    if (textNode && textNode.parentElement) {
      return textNode.parentElement;
    }
    return null;
  }

  function updateBadgePosition(badge, el) {
    if (!el || !document.contains(el)) {
      badge.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      badge.style.display = 'none';
      return;
    }
    badge.style.display = '';
    badge.style.left = (rect.right - 8) + 'px';
    badge.style.top = (rect.top - 8) + 'px';
  }

  function updateAllBadgePositions() {
    badges.forEach((b) => {
      if (document.contains(b.element)) {
        updateBadgePosition(b.badge, b.element);
      } else {
        b.badge.style.display = 'none';
      }
    });
  }

  function startBadgePositionUpdate() {
    if (scrollResizeHandler) return;
    scrollResizeHandler = () => {
      if (!isActive) return;
      updateAllBadgePositions();
    };
    window.addEventListener('scroll', scrollResizeHandler, true);
    window.addEventListener('resize', scrollResizeHandler);
    updateAllBadgePositions();
  }

  function stopBadgePositionUpdate() {
    if (scrollResizeHandler) {
      window.removeEventListener('scroll', scrollResizeHandler, true);
      window.removeEventListener('resize', scrollResizeHandler);
      scrollResizeHandler = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function showAreaOverlay(annotation) {
    if (!annotation.areaRect) return;
    const overlay = document.createElement('div');
    overlay.className = '__proto_annotator_area_overlay__';
    overlay.dataset.annotationId = annotation.id;
    const r = annotation.areaRect;
    overlay.style.cssText =
      'position:absolute;' +
      'left:' + r.left + 'px;' +
      'top:' + r.top + 'px;' +
      'width:' + r.width + 'px;' +
      'height:' + r.height + 'px;' +
      'background:rgba(211,47,47,0.1);' +
      'border:2px dashed #d32f2f;' +
      'z-index:2147483638;' +
      'pointer-events:none;';

    const label = document.createElement('div');
    label.className = '__proto_annotator_area_label__';
    label.textContent = annotation.id;
    label.style.cssText =
      'position:absolute;' +
      'top:-12px;' +
      'left:-4px;' +
      'background:#d32f2f;' +
      'color:#fff;' +
      'font-size:11px;' +
      'font-weight:600;' +
      'padding:1px 6px;' +
      'border-radius:8px;' +
      'pointer-events:auto;' +
      'cursor:pointer;' +
      'line-height:1.4;';
    overlay.appendChild(label);
    document.body.appendChild(overlay);
    areaOverlays.push({ overlay, annotation });

    label.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      highlightAnnotation(annotation.id);
    });
  }

  function highlightAnnotation(id) {
    removeHighlightAnnotation();

    const annotation = badges.find((b) => b.annotation.id === id)?.annotation
      || areaOverlays.find((a) => a.annotation.id === id)?.annotation;
    if (!annotation) return;

    let targetEl = null;
    if (annotation.selector) {
      targetEl = SelectorUtils.findElement(annotation.selector);
    }

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        const rect = targetEl.getBoundingClientRect();
        createStableHighlight(rect.left + window.scrollX - 4, rect.top + window.scrollY - 4, rect.width + 8, rect.height + 8, annotation, false);
      }, 300);
    } else if (annotation.areaRect) {
      const r = annotation.areaRect;
      createStableHighlight(r.left - 4, r.top - 4, r.width + 8, r.height + 8, annotation, true);
    }
  }

  function removeHighlightAnnotation() {
    const existing = document.getElementById('__proto_annotator_stable_highlight__');
    if (existing) existing.remove();
  }

  function createStableHighlight(left, top, width, height, annotation, useAbsolute) {
    removeHighlightAnnotation();

    const overlay = document.createElement('div');
    overlay.id = '__proto_annotator_stable_highlight__';
    overlay.style.cssText =
      'position:' + (useAbsolute ? 'absolute' : 'fixed') + ';' +
      'left:' + left + 'px;' +
      'top:' + top + 'px;' +
      'width:' + width + 'px;' +
      'height:' + height + 'px;' +
      'border:3px solid #ff9800;' +
      'background:rgba(255,152,0,0.12);' +
      'border-radius:4px;' +
      'z-index:2147483642;' +
      'pointer-events:auto;' +
      'cursor:pointer;' +
      'transition:opacity 0.3s ease;';

    if (useAbsolute) {
      window.scrollTo({ top: top - window.innerHeight / 2, behavior: 'smooth' });
    }

    document.body.appendChild(overlay);

    const dismissHandler = (e) => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
      document.removeEventListener('click', dismissHandler, true);
    };

    setTimeout(() => {
      document.addEventListener('click', dismissHandler, true);
    }, 100);
  }

  async function restoreBadges() {
    clearBadges();
    clearAreaOverlays();
    const annotations = await ProtoStorage.getAnnotations();
    const pageName = ProtoStorage.getPageName();
    const pageAnnotations = annotations.filter((a) => a.pageName === pageName);

    for (const ann of pageAnnotations) {
      if (ann.areaRect) {
        showAreaOverlay(ann);
      } else if (ann.selector) {
        showBadge(ann);
      }
    }
  }

  function clearBadges() {
    badges.forEach((b) => b.badge.remove());
    badges.length = 0;
  }

  function clearAreaOverlays() {
    areaOverlays.forEach((a) => a.overlay.remove());
    areaOverlays.length = 0;
  }

  function onAreaSelected(rect) {
    // rect contains document coordinates, but card uses fixed positioning
    // so convert back to viewport coordinates for card positioning
    const viewportPosition = {
      left: rect.left - window.scrollX,
      top: rect.top - window.scrollY
    };
    showCard(null, viewportPosition, rect);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getCardStyles() {
    return '' +
      '.card {' +
      '  position:fixed;z-index:2147483647;' +
      '  width:340px;background:#fff;border-radius:12px;' +
      '  box-shadow:0 8px 32px rgba(0,0,0,0.18);' +
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      '  font-size:14px;color:#333;padding:0;' +
      '  opacity:0;transform:translateY(8px);' +
      '  transition:opacity 0.2s,transform 0.2s;' +
      '  overflow:hidden;' +
      '}' +
      '.card-visible {opacity:1;transform:translateY(0);}' +
      '.type-indicator {padding:10px 16px;font-weight:600;color:#d32f2f;border-bottom:1px solid #eee;}' +
      '.area-size-hint {padding:2px 16px 8px;font-size:12px;color:#999;font-family:"SF Mono","Menlo","Monaco",monospace;}' +
      '.label-hint {font-weight:400;font-size:11px;color:#bbb;}' +
      '.card-body {padding:12px 16px;}' +
      '.field-group {margin-bottom:8px;}' +
      '.field-group label {display:block;font-size:12px;color:#888;margin-bottom:4px;font-weight:500;}' +
      '.original-text {' +
      '  padding:8px 10px;background:#f5f5f5;border-radius:6px;' +
      '  font-size:13px;color:#555;margin-bottom:8px;word-break:break-all;' +
      '}' +
      '.new-text-input, .note-input {' +
      '  width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;' +
      '  font-size:13px;outline:none;transition:border-color 0.2s;' +
      '  box-sizing:border-box;' +
      '}' +
      '.new-text-input:focus, .note-input:focus {border-color:#1976d2;}' +
      '.note-input {resize:vertical;min-height:60px;font-family:inherit;}' +
      '.card-actions {display:flex;justify-content:flex-end;gap:8px;padding:8px 16px 12px;border-top:1px solid #f0f0f0;}' +
      '.btn {' +
      '  padding:7px 18px;border:none;border-radius:6px;font-size:13px;' +
      '  cursor:pointer;font-weight:500;transition:all 0.2s;' +
      '}' +
      '.btn-cancel {background:#f5f5f5;color:#666;}' +
      '.btn-cancel:hover {background:#e8e8e8;}' +
      '.btn-confirm {background:#1976d2;color:#fff;}' +
      '.btn-confirm:hover {background:#1565c0;}' +
      '@media (prefers-color-scheme: dark) {' +
      '  .card {background:#2d2d2d;color:#e0e0e0;}' +
      '  .original-text {background:#383838;color:#ccc;}' +
      '  .new-text-input, .note-input {background:#383838;color:#e0e0e0;border-color:#555;}' +
      '  .btn-cancel {background:#383838;color:#ccc;}' +
      '  .btn-confirm {background:#1976d2;color:#fff;}' +
      '  .type-indicator {color:#ef5350;border-bottom-color:#444;}' +
      '  .area-size-hint {color:#777;}' +
      '  .label-hint {color:#666;}' +
      '  .card-actions {border-top-color:#444;}' +
      '}';
  }

  function showToast(msg) {
    const old = document.querySelector('.__proto_annotator_toast__');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = '__proto_annotator_toast__';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 2000);
  }

  return {
    activate,
    deactivate,
    closeCard,
    restoreBadges,
    highlightAnnotation,
    removeHighlightAnnotation,
    showBadge,
    showAreaOverlay,
    updateAllBadgePositions,
    showToast
  };
})();