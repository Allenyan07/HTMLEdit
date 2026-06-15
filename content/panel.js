const Panel = (() => {
  let panelContainer = null;
  let shadow = null;
  let panelEl = null;
  let isPanelVisible = false;
  let editOverlay = null;
  let fabEl = null;

  function getAllFramePageNames() {
    const names = new Set();
    names.add(ProtoStorage.getPageName());
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      try {
        const src = iframe.src || iframe.getAttribute('src') || '';
        if (src) {
          const url = new URL(src, window.location.href);
          let path = url.pathname.split('/').pop() || '';
          // Strip query params and hash
          path = path.split('?')[0].split('#')[0];
          if (path && !path.startsWith('http') && !path.startsWith('about:')) {
            names.add(decodeURIComponent(path));
          }
        }
      } catch (e) {}
    });
    return names;
  }

  function create() {
    if (panelContainer) return;

    panelContainer = document.createElement('div');
    panelContainer.id = '__proto_annotator_panel_container__';
    // Fixed position ensures the panel stays in place regardless of body layout changes
    panelContainer.style.cssText = 'position:fixed;top:0;right:0;width:0;height:0;overflow:visible;z-index:2147483646;pointer-events:none;';
    shadow = panelContainer.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getPanelStyles();
    shadow.appendChild(style);

    panelEl = document.createElement('div');
    panelEl.className = 'panel';
    panelEl.innerHTML = buildPanelHTML();
    shadow.appendChild(panelEl);

    document.body.appendChild(panelContainer);
    bindPanelEvents();

    refreshList();
  }

  function destroy() {
    closeEditCard();
    closeExportOverlay();
    hideFab();
    if (panelContainer) {
      panelContainer.remove();
      panelContainer = null;
      shadow = null;
      panelEl = null;
    }
    isPanelVisible = false;
  }

  let pushStyleSheet = null;

  function show() {
    if (!panelContainer) create();
    if (panelEl) {
      panelEl.style.display = '';
    }
    isPanelVisible = true;
    hideFab();
    injectPushStyles();
    refreshList();
  }

  function hide() {
    if (panelEl) {
      panelEl.style.display = 'none';
    }
    isPanelVisible = false;
    removePushStyles();
  }

  function minimize() {
    hide();
    showFab();
  }

  function injectPushStyles() {
    if (pushStyleSheet) return;
    const style = document.createElement('style');
    style.id = '__proto_annotator_push_styles__';
    // Push document-flow content left via html margin-right.
    // Fixed-position elements are handled separately in adjustFixedElements().
    // Our own fixed UI needs counter-margin to stay in place.
    style.textContent =
      'html { margin-right: 360px !important; transition: margin-right 0.25s ease !important; }';
    document.head.appendChild(style);
    pushStyleSheet = style;

    // Wait for DOM reflow before reading computed styles
    requestAnimationFrame(() => {
      adjustFixedElements(true);
    });
  }

  function removePushStyles() {
    if (pushStyleSheet) {
      pushStyleSheet.remove();
      pushStyleSheet = null;
    }
    adjustFixedElements(false);
  }

  function adjustFixedElements(push) {
    // Find fixed-position elements — limit to body descendants (skip shadow DOM)
    // Only check elements up to ~5 levels deep for performance
    const allElements = document.querySelectorAll('body *, body');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      // Skip our own elements
      if (el.id && el.id.startsWith('__proto_annotator')) continue;
      // Skip shadow DOM hosts and elements inside shadow DOM
      if (el.shadowRoot) continue;
      if (el.getRootNode() !== document) continue;

      const computed = window.getComputedStyle(el);
      if (computed.position !== 'fixed') continue;

      if (push) {
        // Store original inline styles so we can restore them
        if (el.__proto_original_right === undefined) {
          el.__proto_original_right = el.style.right;
          el.__proto_original_width = el.style.width;
          el.__proto_original_margin_right = el.style.marginRight;
          el.__proto_original_left = el.style.left;
        }

        const rightVal = computed.right;
        const widthVal = parseFloat(computed.width);
        const viewportWidth = window.innerWidth;

        // Element anchored to right edge (right: 0)
        if (rightVal === '0px') {
          el.style.right = '360px';
        }
        // Full-width fixed element (top bar, bottom bar, side nav)
        else if (!isNaN(widthVal) && widthVal > viewportWidth * 0.5) {
          el.style.width = (widthVal - 360) + 'px';
        }
        // Element at left:0 with no explicit right — likely full-width
        else if (computed.left === '0px' && rightVal === 'auto') {
          el.style.marginRight = '360px';
        }
      } else {
        // Restore original values
        if (el.__proto_original_right !== undefined) {
          el.style.right = el.__proto_original_right;
          el.style.width = el.__proto_original_width;
          el.style.marginRight = el.__proto_original_margin_right;
          el.style.left = el.__proto_original_left;
          delete el.__proto_original_right;
          delete el.__proto_original_width;
          delete el.__proto_original_margin_right;
          delete el.__proto_original_left;
        }
      }
    }
  }

  function toggle() {
    if (isPanelVisible) {
      minimize();
    } else {
      show();
    }
  }

  function showFab() {
    if (fabEl) return;
    fabEl = document.createElement('div');
    fabEl.className = '__proto_annotator_fab__';
    fabEl.textContent = '📋';
    fabEl.title = '打开标注面板';
    fabEl.addEventListener('click', () => {
      show();
    });
    document.body.appendChild(fabEl);
    requestAnimationFrame(() => {
      fabEl.classList.add('__proto_annotator_fab_visible__');
    });
  }

  function hideFab() {
    if (!fabEl) return;
    fabEl.classList.remove('__proto_annotator_fab_visible__');
    setTimeout(() => {
      if (fabEl) {
        fabEl.remove();
        fabEl = null;
      }
    }, 200);
  }

  function buildPanelHTML() {
    return '' +
      '<div class="panel-header">' +
      '  <div class="panel-title">📋 标注面板</div>' +
      '  <div class="panel-header-actions">' +
      '    <button class="icon-btn" id="paMinimize" title="最小化">−</button>' +
      '  </div>' +
      '</div>' +
      '<div class="panel-body">' +
      '  <div class="panel-toolbar">' +
      '    <button class="toolbar-btn" id="paExport" title="导出标注">📥 导出</button>' +
      '    <button class="toolbar-btn toolbar-btn-danger" id="paClearAll" title="清空所有标注">🗑️ 清空</button>' +
      '  </div>' +
      '  <div class="panel-list" id="paList"></div>' +
      '  <div class="panel-empty" id="paEmpty">暂无标注<br><span class="empty-hint">Shift+点击 标注元素<br>Shift+拖拽 标注区域</span></div>' +
      '</div>';
  }

  function bindPanelEvents() {
    shadow.getElementById('paMinimize').addEventListener('click', () => {
      minimize();
    });

    shadow.getElementById('paExport').addEventListener('click', exportAnnotations);
    shadow.getElementById('paClearAll').addEventListener('click', clearAllAnnotations);
  }

  async function refreshList() {
    if (!shadow) return;

    const listEl = shadow.getElementById('paList');
    const emptyEl = shadow.getElementById('paEmpty');
    if (!listEl || !emptyEl) return;

    try {
      const annotations = await ProtoStorage.getAnnotations();
      const pageName = ProtoStorage.getPageName();

      if (annotations.length === 0) {
        listEl.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
      }

      listEl.style.display = 'block';
      emptyEl.style.display = 'none';

      const grouped = {};
      annotations.forEach((a) => {
        if (!grouped[a.pageName]) grouped[a.pageName] = [];
        grouped[a.pageName].push(a);
      });

      let html = '';
      for (const [page, items] of Object.entries(grouped)) {
        const isCurrentPage = page === pageName;
        html += '<div class="page-group">';
        html += '<div class="page-header' + (isCurrentPage ? ' current' : '') + '">';
        html += '<span class="page-name">' + escapeHtml(page) + '</span>';
        html += '<span class="page-count">' + items.length + '</span>';
        html += '</div>';
        html += '<div class="page-items">';
        items.forEach((a) => {
          html += buildAnnotationItem(a, isCurrentPage);
        });
        html += '</div></div>';
      }

      listEl.innerHTML = html;

      listEl.querySelectorAll('.anno-item').forEach((item) => {
        const id = item.dataset.id;
        item.addEventListener('click', (e) => {
          if (e.target.closest('.anno-delete')) return;
          locateAndEditAnnotation(id);
        });
        item.querySelector('.anno-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          deleteAnnotation(id);
        });
      });
    } catch (err) {
      console.error('[ProtoAnnotator] refreshList error:', err);
    }
  }

  function buildAnnotationItem(a, isCurrentPage) {
    try {
      let rows = '';

      // Line 1: original text (with  icon) or area info (with 📍 icon)
      if (a.areaRect) {
        let areaInfo = Math.round(a.areaRect.width) + '×' + Math.round(a.areaRect.height);
        if (a.areaRect.coveredElements && a.areaRect.coveredElements.length > 0) {
          const elSummary = a.areaRect.coveredElements.map((el) => {
            const text = el.text ? escapeHtml(el.text.substring(0, 20)) : '';
            return '&lt;' + escapeHtml(el.tag) + '&gt;' + (text ? ' ' + text : '');
          }).join('  ');
          rows += '<div class="anno-row"><span class="anno-row-icon">📍</span><span class="anno-row-text anno-area-info">' + areaInfo + '</span></div>';
          rows += '<div class="anno-row"><span class="anno-row-icon"></span><span class="anno-row-text anno-area-elements">' + elSummary + '</span></div>';
        } else {
          rows += '<div class="anno-row"><span class="anno-row-icon">📍</span><span class="anno-row-text anno-area-info">区域 ' + areaInfo + '</span></div>';
        }
      } else if (a.originalText) {
        rows += '<div class="anno-row"><span class="anno-row-icon">📄</span><span class="anno-row-text anno-original">' + escapeHtml(a.originalText) + '</span></div>';
      }

      // Line 2: new text (with ️ icon)
      if (a.newText) {
        rows += '<div class="anno-row"><span class="anno-row-icon">✏️</span><span class="anno-row-text anno-new">' + escapeHtml(a.newText) + '</span></div>';
      }

      // Line 3: note (with 💬 icon)
      if (a.note) {
        rows += '<div class="anno-row"><span class="anno-row-icon">💬</span><span class="anno-row-text anno-note">' + escapeHtml(a.note) + '</span></div>';
      }

      if (!rows) {
        rows = '<div class="anno-row"><span class="anno-row-icon">💬</span><span class="anno-row-text anno-note">(空)</span></div>';
      }

      const status = a.status || 'pending';

      return '' +
        '<div class="anno-item' + (isCurrentPage ? ' current-page' : '') + '" data-id="' + a.id + '">' +
        '  <div class="anno-id-badge anno-badge-' + status + '">' + a.id + '</div>' +
        '  <div class="anno-body">' + rows + '</div>' +
        '  <button class="anno-delete" title="删除">✕</button>' +
        '</div>';
    } catch (err) {
      console.error('[ProtoAnnotator] buildAnnotationItem error for', a.id, err);
      return '<div class="anno-item" data-id="' + (a.id || '?') + '">' +
        '<div class="anno-id-badge">?</div>' +
        '<div class="anno-body"><div class="anno-row"><span class="anno-row-text">标注数据异常</span></div></div>' +
        '<button class="anno-delete">✕</button></div>';
    }
  }

  async function locateAndEditAnnotation(id) {
    const annotations = await ProtoStorage.getAnnotations();
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;

    locateAnnotation(id);
    showEditCard(annotation);
  }

  let editCardContainer = null;
  let editCardShadow = null;
  let editCardCloseTimer = null;

  function showEditCard(annotation) {
    closeEditCard();

    editCardContainer = document.createElement('div');
    editCardContainer.id = '__proto_annotator_edit_card_container__';
    editCardShadow = editCardContainer.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getOverlayStyles();
    editCardShadow.appendChild(style);

    editOverlay = document.createElement('div');
    editOverlay.className = 'edit-overlay';
    editOverlay.innerHTML = buildEditCardHTML(annotation);
    editCardShadow.appendChild(editOverlay);

    document.body.appendChild(editCardContainer);

    requestAnimationFrame(() => {
      editOverlay.classList.add('edit-overlay-visible');
    });

    bindEditCardEvents(annotation);
  }

  function buildCoveredElementsHTML(areaRect) {
    if (!areaRect || !areaRect.coveredElements || areaRect.coveredElements.length === 0) {
      return '<div class="edit-area-elements-hint">区域内未检测到可见元素</div>';
    }
    let html = '<div class="edit-area-elements"><div class="edit-area-elements-title">📦 区域内元素</div>';
    areaRect.coveredElements.forEach((el) => {
      const tag = el.tag ? '&lt;' + escapeHtml(el.tag) + '&gt;' : '';
      const text = el.text ? '「' + escapeHtml(el.text.length > 25 ? el.text.substring(0, 25) + '...' : el.text) + '」' : '';
      html += '<div class="edit-area-el">' + tag + ' ' + text + '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildEditCardHTML(a) {
    const isArea = !!a.areaRect;

    const typeHeader = isArea
      ? '<div class="edit-type-indicator">📍 区域标注</div>' +
        (a.areaRect ? '<div class="edit-area-info">区域: ' +
          Math.round(a.areaRect.width) + '×' + Math.round(a.areaRect.height) +
          ' @ (' + Math.round(a.areaRect.left) + ', ' + Math.round(a.areaRect.top) + ')</div>' : '') +
        buildCoveredElementsHTML(a.areaRect)
      : '<div class="edit-type-indicator">✏️ 元素标注</div>';

    const textFields = isArea
      ? ''
      : '<div class="edit-field-group edit-text-fields">' +
        '<label>原文本</label>' +
        '<div class="edit-original-text">' + escapeHtml(a.originalText || '(无文本)') + '</div>' +
        '<label>修改为 <span class="edit-label-hint">（选填）</span></label>' +
        '<input type="text" class="edit-new-text-input" value="' + escapeAttr(a.newText) + '" placeholder="直接改文字…" />' +
        '</div>';

    const noteField = '<div class="edit-field-group edit-note-fields">' +
      '<label>修改说明 <span class="edit-label-hint">（改颜色、位置、交互等，选填）</span></label>' +
      '<textarea class="edit-note-input" rows="3" placeholder="描述需要怎么改…">' + escapeHtml(a.note) + '</textarea>' +
      '</div>';

    return '' +
      '<div class="edit-card">' +
      '  <div class="edit-card-header">' +
      '    <span class="edit-card-id">' + a.id + '</span>' +
      '    <span class="edit-card-page">' + escapeHtml(a.pageName) + '</span>' +
      '    <button class="edit-card-close" title="关闭">✕</button>' +
      '  </div>' +
      typeHeader +
      '  <div class="edit-card-body">' +
      textFields +
      noteField +
      '  </div>' +
      '  <div class="edit-card-actions">' +
      '    <button class="edit-btn edit-btn-cancel">取消</button>' +
      '    <button class="edit-btn edit-btn-save">保存</button>' +
      '  </div>' +
      '</div>';
  }

  function bindEditCardEvents(annotation) {
    editOverlay.querySelector('.edit-card-close').addEventListener('click', () => {
      closeEditCard();
    });

    // Click on overlay backdrop to close
    editOverlay.addEventListener('click', (e) => {
      if (e.target === editOverlay) {
        closeEditCard();
      }
    });

    editOverlay.querySelector('.edit-btn-cancel').addEventListener('click', () => {
      closeEditCard();
    });

    editOverlay.querySelector('.edit-btn-save').addEventListener('click', () => {
      saveEditCard(annotation);
    });

    const textInput = editOverlay.querySelector('.edit-new-text-input');
    const noteInput = editOverlay.querySelector('.edit-note-input');
    // Focus the field that has content, or text first
    if (textInput) textInput.focus();
  }

  async function saveEditCard(annotation) {
    if (!editOverlay) return;

    const newText = editOverlay.querySelector('.edit-new-text-input')?.value?.trim() || '';
    const note = editOverlay.querySelector('.edit-note-input')?.value?.trim() || '';

    if (!newText && !note) return;

    // Determine type based on content
    let type;
    if (annotation.areaRect) {
      type = 'area';
    } else if (newText) {
      type = 'text';
    } else {
      type = 'note';
    }

    const updates = {
      type: type,
      newText: newText,
      note: note
    };

    await ProtoStorage.updateAnnotation(annotation.id, updates);
    const updatedAnnotation = { ...annotation, ...updates };
    Messaging.broadcastAnnotationChange('ANNOTATION_UPDATED', updatedAnnotation);
    Annotator.restoreBadges();
    refreshList();
    closeEditCard();
  }

  function closeEditCard() {
    if (editOverlay) {
      if (editCardCloseTimer) {
        clearTimeout(editCardCloseTimer);
        editCardCloseTimer = null;
      }
      editOverlay.classList.remove('edit-overlay-visible');
      const container = editCardContainer;
      editCardCloseTimer = setTimeout(() => {
        if (editCardContainer === container) {
          container.remove();
          editCardContainer = null;
          editCardShadow = null;
          editCardCloseTimer = null;
        }
      }, 200);
      editOverlay = null;
    }
  }

  async function locateAnnotation(id) {
    const annotations = await ProtoStorage.getAnnotations();
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;

    const currentPageName = ProtoStorage.getPageName();

    if (annotation.pageName === currentPageName) {
      Annotator.highlightAnnotation(id);
    } else {
      Messaging.sendToBackground({
        type: 'NAVIGATE_TO_ANNOTATION',
        annotation: annotation
      });
    }
  }

  async function deleteAnnotation(id) {
    await ProtoStorage.deleteAnnotation(id);
    Messaging.broadcastAnnotationChange('ANNOTATION_DELETED', { id: id });
    Annotator.restoreBadges();
    refreshList();
    closeEditCard();
  }

  async function cycleStatus(id) {
    // Kept for potential future use (status cycling)
    const annotations = await ProtoStorage.getAnnotations();
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;

    const statusOrder = ['pending', 'done', 'rejected'];
    const currentIdx = statusOrder.indexOf(annotation.status);
    annotation.status = statusOrder[(currentIdx + 1) % statusOrder.length];

    await ProtoStorage.updateAnnotation(id, { status: annotation.status });
    Messaging.broadcastAnnotationChange('ANNOTATION_UPDATED', annotation);
    refreshList();
  }

  let clearConfirmPending = false;

  async function clearAllAnnotations() {
    const annotations = await ProtoStorage.getAnnotations();
    if (annotations.length === 0) return;

    // Double-click confirmation: first click shows warning, second click confirms
    const clearBtn = shadow.getElementById('paClearAll');
    if (!clearConfirmPending) {
      clearConfirmPending = true;
      clearBtn.textContent = '⚠️ 确认清空？';
      clearBtn.style.background = '#ffebee';
      clearBtn.style.color = '#d32f2f';
      setTimeout(() => {
        clearConfirmPending = false;
        if (clearBtn) {
          clearBtn.textContent = '🗑️ 清空';
          clearBtn.style.background = '';
          clearBtn.style.color = '';
        }
      }, 3000);
      return;
    }

    clearConfirmPending = false;
    if (clearBtn) {
      clearBtn.textContent = '🗑️ 清空';
      clearBtn.style.background = '';
      clearBtn.style.color = '';
    }

    await ProtoStorage.clearAnnotations();
    Messaging.broadcastAnnotationChange('CLEAR_ALL_ANNOTATIONS', {});
    Annotator.restoreBadges();
    refreshList();
    closeEditCard();
  }

  async function exportAnnotations() {
    const annotations = await ProtoStorage.getAnnotations();
    if (annotations.length === 0) return;

    const data = buildExportText(annotations);
    showExportOverlay(data);
  }

  function buildExportText(annotations) {
    const now = new Date();
    const dateStr = now.getFullYear() + '/' +
      String(now.getMonth() + 1).padStart(2, '0') + '/' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');

    let lines = [];
    lines.push('=== 原型标注导出（按页面分组） ===');
    lines.push('日期: ' + dateStr);
    lines.push('总计: ' + annotations.length + ' 条');

    // Group by pageName
    const grouped = {};
    annotations.forEach((a) => {
      const page = a.pageName || '未知页面';
      if (!grouped[page]) grouped[page] = [];
      grouped[page].push(a);
    });

    for (const [page, items] of Object.entries(grouped)) {
      lines.push('');
      lines.push('══════ 『' + page + '』 ════════（' + items.length + ' 条）');

      items.forEach((a) => {
        lines.push('  【' + a.id + '】');

        if (a.type === 'area' || a.areaRect) {
          // Area annotation
          lines.push('  📐 区域标注');
          if (a.areaRect) {
            lines.push('     坐标: (' + Math.round(a.areaRect.left) + ', ' + Math.round(a.areaRect.top) + ')  尺寸: ' + Math.round(a.areaRect.width) + ' × ' + Math.round(a.areaRect.height));
          }
        } else {
          // Element annotation
          if (a.originalText) {
            lines.push('  📄 原本内容：' + a.originalText);
          }
        }

        if (a.type === 'text' && a.newText) {
          lines.push('  ✏️ 修改后：' + a.newText);
        }

        if (a.note) {
          lines.push('  💬 修改说明：' + a.note);
        }

        if (a.selector) {
          lines.push('  🔍 选择器：' + a.selector);
        }

        if (a.htmlContext) {
          lines.push('  📝 上下文：' + a.htmlContext);
        }

        // Show covered elements for area annotations
        if (a.areaRect && a.areaRect.coveredElements && a.areaRect.coveredElements.length > 0) {
          lines.push('  📦 区域内元素：');
          a.areaRect.coveredElements.forEach((el, i) => {
            const tag = el.tag ? '<' + el.tag + '>' : '';
            const text = el.text ? '「' + (el.text.length > 30 ? el.text.substring(0, 30) + '...' : el.text) + '」' : '';
            lines.push('     ' + (i + 1) + '. ' + tag + ' ' + text);
            if (el.selector) {
              lines.push('        选择器：' + el.selector);
            }
          });
        }

        lines.push('');
      });
    }

    lines.push('=== 导出结束 ===');
    return lines.join('\n');
  }

  let exportCardContainer = null;
  let exportCardShadow = null;

  function showExportOverlay(textData) {
    closeExportOverlay();

    exportCardContainer = document.createElement('div');
    exportCardContainer.id = '__proto_annotator_export_card_container__';
    exportCardShadow = exportCardContainer.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getOverlayStyles();
    exportCardShadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'edit-overlay';
    overlay.innerHTML =
      '<div class="export-card export-card-wide">' +
      '  <div class="export-card-header">' +
      '    <span class="export-card-title">📥 导出标注数据</span>' +
      '    <div class="export-format-tabs">' +
      '      <button class="export-format-tab active" data-format="text">📄 文本</button>' +
      '      <button class="export-format-tab" data-format="json">📋 JSON</button>' +
      '    </div>' +
      '    <button class="edit-card-close export-close" title="关闭">✕</button>' +
      '  </div>' +
      '  <div class="export-card-body">' +
      '    <textarea class="export-textarea" readonly rows="16">' + escapeHtml(textData) + '</textarea>' +
      '  </div>' +
      '  <div class="export-card-actions">' +
      '    <button class="edit-btn edit-btn-save export-copy">📋 复制到剪贴板</button>' +
      '  </div>' +
      '</div>';

    exportCardShadow.appendChild(overlay);
    document.body.appendChild(exportCardContainer);

    requestAnimationFrame(() => {
      overlay.classList.add('edit-overlay-visible');
    });

    // Store both formats
    const exportData = { text: textData, json: null };
    // Compute JSON lazily
    let jsonComputed = false;

    overlay.querySelector('.export-close').addEventListener('click', () => {
      closeExportOverlay();
    });

    // Click on overlay backdrop to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeExportOverlay();
      }
    });

    // Format tab switching
    const formatTabs = overlay.querySelectorAll('.export-format-tab');
    const textarea = overlay.querySelector('.export-textarea');
    formatTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        formatTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const format = tab.dataset.format;
        if (format === 'json') {
          if (!jsonComputed) {
            // Re-fetch annotations for JSON export (includes full areaRect with coveredElements)
            ProtoStorage.getAnnotations().then((annotations) => {
              exportData.json = JSON.stringify(annotations, null, 2);
              jsonComputed = true;
              textarea.value = exportData.json;
            });
          } else {
            textarea.value = exportData.json;
          }
        } else {
          textarea.value = exportData.text;
        }
      });
    });

    overlay.querySelector('.export-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textarea.value);
        const btn = overlay.querySelector('.export-copy');
        btn.textContent = '✅ 已复制';
        setTimeout(() => { btn.textContent = '📋 复制到剪贴板'; }, 1500);
      } catch (e) {
        textarea.select();
        const btn = overlay.querySelector('.export-copy');
        btn.textContent = '请按 Ctrl+C 复制';
        setTimeout(() => { btn.textContent = '📋 复制到剪贴板'; }, 3000);
      }
    });
  }

  function closeExportOverlay() {
    if (exportCardContainer) {
      const overlay = exportCardShadow?.querySelector('.edit-overlay');
      if (overlay) overlay.classList.remove('edit-overlay-visible');
      setTimeout(() => {
        if (exportCardContainer) {
          exportCardContainer.remove();
          exportCardContainer = null;
          exportCardShadow = null;
        }
      }, 200);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getPanelStyles() {
    return '' +
      ':host { all: initial; font-family: -apple-system, "Inter", BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }' +
      '.panel {' +
      '  position: fixed; top: 0; right: 0; width: 360px; height: 100vh;' +
      '  background: #ffffff; border-left: 1px solid #d8dee4;' +
      '  box-shadow: -4px 0 20px rgba(0,0,0,0.08);' +
      '  display: flex; flex-direction: column; z-index: 2147483646;' +
      '  font-size: 12px; color: #1f2328; pointer-events: auto;' +
      '}' +
      '.panel-header {' +
      '  display: flex; align-items: center; justify-content: space-between;' +
      '  padding: 12px 16px; border-bottom: 1px solid #eaeef2;' +
      '  background: #fafafa; flex-shrink: 0;' +
      '}' +
      '.panel-title { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: #1f2328; }' +
      '.panel-header-actions { display: flex; gap: 4px; }' +
      '.icon-btn {' +
      '  width: 28px; height: 28px; border: none; background: none;' +
      '  cursor: pointer; font-size: 18px; color: #6e7781; border-radius: 5px;' +
      '  display: flex; align-items: center; justify-content: center;' +
      '  transition: background 0.15s;' +
      '}' +
      '.icon-btn:hover { background: #f6f8fa; }' +
      '.panel-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }' +
      '.panel-toolbar {' +
      '  display: flex; gap: 8px; padding: 8px 16px;' +
      '  border-bottom: 1px solid #eaeef2; flex-shrink: 0;' +
      '}' +
      '.toolbar-btn {' +
      '  padding: 5px 12px; border: 1px solid #d8dee4; border-radius: 6px;' +
      '  background: #ffffff; cursor: pointer; font-size: 12px; color: #6e7781;' +
      '  font-weight: 500; transition: background 0.15s;' +
      '}' +
      '.toolbar-btn:hover { background: #f6f8fa; }' +
      '.toolbar-btn-danger { color: #e5484d; border-color: rgba(229,72,77,0.2); }' +
      '.toolbar-btn-danger:hover { background: rgba(229,72,77,0.08); }' +
      '.panel-list { flex: 1; overflow-y: auto; padding: 4px 0; }' +
      '.panel-empty {' +
      '  flex: 1; display: flex; align-items: center; justify-content: center;' +
      '  text-align: center; color: #8b949e; font-size: 12px; line-height: 1.8;' +
      '}' +
      '.empty-hint { font-size: 11px; color: #b0b8c1; }' +
      '.page-group { margin-bottom: 2px; }' +
      '.page-header {' +
      '  display: flex; align-items: center; justify-content: space-between;' +
      '  padding: 8px 16px; background: #f6f8fa; font-size: 11px; color: #6e7781;' +
      '  font-weight: 600; cursor: default;' +
      '}' +
      '.page-header.current { background: rgba(91,108,255,0.08); color: #4a5cef; }' +
      '.page-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
      '.page-count {' +
      '  background: #eaeef2; color: #6e7781; font-size: 11px; padding: 1px 8px;' +
      '  border-radius: 10px; margin-left: 8px;' +
      '}' +
      '.page-header.current .page-count { background: rgba(91,108,255,0.12); color: #4a5cef; }' +
      '.page-items { padding: 0 8px; }' +
      '.anno-item {' +
      '  display: flex; align-items: flex-start; gap: 8px;' +
      '  padding: 8px 12px; margin: 4px 0; border-radius: 6px;' +
      '  border: 1px solid #d8dee4; background: #ffffff;' +
      '  transition: background 0.1s, border-color 0.1s; cursor: pointer;' +
      '}' +
      '.anno-item:hover { border-color: #5b6cff; background: #fafafa; }' +
      '.anno-item.current-page { border-left: 3px solid #5b6cff; }' +
      '.anno-id-badge {' +
      '  flex-shrink: 0; min-width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;' +
      '  background: #5b6cff; color: #fff; font-size: 11px; font-weight: 600;' +
      '  letter-spacing: -0.02em; border-radius: 6px;' +
      '  margin-top: 2px; padding: 0 6px;' +
      '}' +
      '.anno-badge-done { background: #7c8aff !important; opacity: 0.75; }' +
      '.anno-badge-rejected { background: #8b949e !important; opacity: 0.7; }' +
      '.anno-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }' +
      '.anno-row {' +
      '  display: flex; align-items: baseline; gap: 4px;' +
      '  font-size: 12px; line-height: 1.6;' +
      '}' +
      '.anno-row-icon {' +
      '  flex-shrink: 0; width: 18px; text-align: center; font-size: 11px; margin-top: 1px;' +
      '}' +
      '.anno-row-text { flex: 1; min-width: 0; word-break: break-all; }' +
      '.anno-original { color: #1f2328; }' +
      '.anno-area-info {' +
      '  color: #6e7781; font-size: 11px;' +
      '  font-family: -apple-system, "SF Mono", Menlo, monospace;' +
      '  font-variant-numeric: tabular-nums;' +
      '}' +
      '.anno-area-elements {' +
      '  color: #8b949e; font-size: 11px;' +
      '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' +
      '}' +
      '.anno-new {' +
      '  color: #4a5cef; font-weight: 500;' +
      '  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;' +
      '  overflow: hidden; text-overflow: ellipsis; word-break: break-all;' +
      '}' +
      '.anno-note {' +
      '  color: #6e7781;' +
      '  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;' +
      '  overflow: hidden; text-overflow: ellipsis; word-break: break-all;' +
      '}' +
      '.anno-delete {' +
      '  flex-shrink: 0; align-self: flex-start; margin-top: 4px;' +
      '  padding: 2px 6px; border: none; border-radius: 5px;' +
      '  background: none; cursor: pointer; font-size: 14px; color: #d0d7de;' +
      '  transition: background 0.15s;' +
      '}' +
      '.anno-delete:hover { color: #e5484d; background: rgba(229,72,77,0.08); }' +
      '@media (prefers-color-scheme: dark) {' +
      '  .panel { background: #161b22; color: #e6edf3; border-left-color: #30363d; }' +
      '  .panel-header { background: #1c2128; border-bottom-color: #21262d; }' +
      '  .panel-title { color: #e6edf3; }' +
      '  .icon-btn { color: #8b949e; }' +
      '  .icon-btn:hover { background: #1c2128; }' +
      '  .panel-toolbar { border-bottom-color: #21262d; }' +
      '  .toolbar-btn { background: #161b22; color: #8b949e; border-color: #30363d; }' +
      '  .toolbar-btn:hover { background: #1c2128; }' +
      '  .toolbar-btn-danger { color: #ff7b72; border-color: rgba(255,123,114,0.2); }' +
      '  .toolbar-btn-danger:hover { background: rgba(255,123,114,0.1); }' +
      '  .page-header { background: #1c2128; color: #8b949e; }' +
      '  .page-header.current { background: rgba(124,138,255,0.14); color: #a5b0ff; }' +
      '  .page-count { background: #21262d; color: #8b949e; }' +
      '  .page-header.current .page-count { background: rgba(124,138,255,0.2); color: #a5b0ff; }' +
      '  .anno-item { background: #161b22; border-color: #30363d; }' +
      '  .anno-item:hover { border-color: #7c8aff; background: #1c2128; }' +
      '  .anno-item.current-page { border-left-color: #7c8aff; }' +
      '  .anno-id-badge { background: #7c8aff; }' +
      '  .anno-badge-done { background: #5b6cff !important; opacity: 0.75; }' +
      '  .anno-badge-rejected { background: #6e7781 !important; opacity: 0.7; }' +
      '  .anno-delete { color: #484f58; }' +
      '  .anno-delete:hover { color: #ff7b72; background: rgba(255,123,114,0.1); }' +
      '  .anno-original { color: #e6edf3; }' +
      '  .anno-area-info { color: #8b949e; }' +
      '  .anno-area-elements { color: #484f58; }' +
      '  .anno-new { color: #a5b0ff; }' +
      '  .anno-note { color: #8b949e; }' +
      '  .panel-empty { color: #484f58; }' +
      '  .empty-hint { color: #30363d; }' +
      '}';
  }  function getOverlayStyles() {
    return '' +
      ':host { all: initial; font-family: -apple-system, "Inter", BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }' +
      '.edit-overlay {' +
      '  position: fixed; top: 0; left: 0; right: 0; bottom: 0;' +
      '  background: rgba(0,0,0,0.35); z-index: 2147483647;' +
      '  display: flex; align-items: center; justify-content: center;' +
      '  opacity: 0; transition: opacity 0.2s ease;' +
      '}' +
      '.edit-overlay-visible { opacity: 1; }' +
      '.edit-card {' +
      '  width: 320px; background: #ffffff; border-radius: 12px;' +
      '  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08);' +
      '  overflow: hidden;' +
      '  transform: translateY(10px); transition: transform 0.2s ease;' +
      '  max-height: 90vh; display: flex; flex-direction: column;' +
      '}' +
      '.edit-overlay-visible .edit-card { transform: translateY(0); }' +
      '.edit-card-header {' +
      '  display: flex; align-items: center; gap: 8px;' +
      '  padding: 10px 16px; background: #fafafa; border-bottom: 1px solid #eaeef2; flex-shrink: 0;' +
      '}' +
      '.edit-card-id {' +
      '  background: #5b6cff; color: #fff; font-size: 11px; font-weight: 600;' +
      '  letter-spacing: -0.02em; padding: 2px 8px; border-radius: 6px;' +
      '}' +
      '.edit-card-page { font-size: 12px; color: #8b949e; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
      '.edit-card-close {' +
      '  width: 24px; height: 24px; border: none; background: none;' +
      '  cursor: pointer; font-size: 16px; color: #8b949e; border-radius: 5px;' +
      '  display: flex; align-items: center; justify-content: center;' +
      '  transition: background 0.15s;' +
      '}' +
      '.edit-card-close:hover { background: #f6f8fa; color: #1f2328; }' +
      '.edit-type-indicator { padding: 8px 16px; font-weight: 600; color: #4a5cef; border-bottom: 1px solid #eaeef2; }' +
      '.edit-label-hint { font-weight: 400; font-size: 11px; color: #b0b8c1; }' +
      '.edit-area-info {' +
      '  padding: 4px 16px 8px; font-size: 11px; color: #6e7781;' +
      '  font-family: -apple-system, "SF Mono", Menlo, monospace;' +
      '  font-variant-numeric: tabular-nums;' +
      '  border-bottom: 1px solid #eaeef2;' +
      '}' +
      '.edit-area-elements {' +
      '  padding: 6px 16px; border-bottom: 1px solid #eaeef2;' +
      '}' +
      '.edit-area-elements-title { font-size: 11px; font-weight: 600; color: #6e7781; margin-bottom: 4px; }' +
      '.edit-area-el {' +
      '  font-size: 11px; color: #8b949e; padding: 2px 0; line-height: 1.4;' +
      '}' +
      '.edit-area-elements-hint {' +
      '  padding: 6px 16px; font-size: 11px; color: #b0b8c1;' +
      '  border-bottom: 1px solid #eaeef2; font-style: italic;' +
      '}' +
      '.edit-card-body { padding: 12px 16px; overflow-y: auto; }' +
      '.edit-field-group { margin-bottom: 8px; }' +
      '.edit-field-group label { display: block; font-size: 11px; color: #6e7781; margin-bottom: 4px; font-weight: 500; }' +
      '.edit-original-text {' +
      '  padding: 8px 10px; background: #fafafa; border-radius: 5px;' +
      '  font-size: 12px; color: #6e7781; margin-bottom: 8px; word-break: break-all;' +
      '}' +
      '.edit-new-text-input, .edit-note-input {' +
      '  width: 100%; padding: 8px 10px; border: 1px solid #d8dee4; border-radius: 5px;' +
      '  font-size: 12px; font-family: inherit; outline: none; transition: border-color 0.15s;' +
      '  box-sizing: border-box;' +
      '}' +
      '.edit-new-text-input:focus, .edit-note-input:focus { border-color: #5b6cff; }' +
      '.edit-note-input { resize: vertical; min-height: 60px; }' +
      '.edit-card-actions {' +
      '  display: flex; justify-content: flex-end; gap: 8px;' +
      '  padding: 8px 16px 12px; border-top: 1px solid #eaeef2; flex-shrink: 0;' +
      '}' +
      '.edit-btn {' +
      '  height: 32px; padding: 0 16px; border: none; border-radius: 6px; font-size: 12px;' +
      '  cursor: pointer; font-weight: 500; transition: background 0.15s;' +
      '}' +
      '.edit-btn-cancel { background: #f6f8fa; color: #6e7781; }' +
      '.edit-btn-cancel:hover { background: #eaeef2; }' +
      '.edit-btn-save { background: #5b6cff; color: #fff; }' +
      '.edit-btn-save:hover { background: #4a5cef; }' +
      '.edit-page-warning {' +
      '  padding: 8px 16px; background: rgba(245,165,36,0.08); color: #c4841d;' +
      '  font-size: 12px; border-bottom: 1px solid rgba(245,165,36,0.15);' +
      '}' +
      '.export-card {' +
      '  width: 320px; background: #ffffff; border-radius: 12px;' +
      '  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08);' +
      '  overflow: hidden;' +
      '  transform: translateY(10px); transition: transform 0.2s ease;' +
      '  max-height: 90vh; display: flex; flex-direction: column;' +
      '}' +
      '.export-card-wide {' +
      '  width: 500px; max-width: calc(100vw - 40px);' +
      '}' +
      '.edit-overlay-visible .export-card { transform: translateY(0); }' +
      '.export-card-header {' +
      '  display: flex; align-items: center; gap: 8px;' +
      '  padding: 10px 16px; background: #fafafa; border-bottom: 1px solid #eaeef2; flex-shrink: 0;' +
      '}' +
      '.export-card-title { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: #1f2328; white-space: nowrap; }' +
      '.export-format-tabs {' +
      '  display: flex; gap: 2px; margin-left: auto; background: #eaeef2; border-radius: 6px; padding: 2px;' +
      '}' +
      '.export-format-tab {' +
      '  padding: 3px 10px; border: none; border-radius: 5px; background: transparent;' +
      '  cursor: pointer; font-size: 11px; color: #6e7781; transition: background 0.15s;' +
      '}' +
      '.export-format-tab.active { background: #ffffff; color: #5b6cff; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }' +
      '.export-card-body { padding: 12px 16px; overflow-y: auto; }' +
      '.export-textarea {' +
      '  width: 100%; padding: 8px 10px; border: 1px solid #d8dee4; border-radius: 5px;' +
      '  font-size: 11px; font-family: -apple-system, "SF Mono", Menlo, monospace;' +
      '  font-variant-numeric: tabular-nums;' +
      '  outline: none; resize: vertical; box-sizing: border-box;' +
      '  background: #fafafa; color: #1f2328; line-height: 1.5;' +
      '}' +
      '.export-textarea:focus { border-color: #5b6cff; }' +
      '.export-card-actions {' +
      '  display: flex; justify-content: flex-end;' +
      '  padding: 8px 16px 12px; border-top: 1px solid #eaeef2; flex-shrink: 0;' +
      '}' +
      '@media (prefers-color-scheme: dark) {' +
      '  .edit-overlay { background: rgba(0,0,0,0.5); }' +
      '  .edit-card { background: #161b22; }' +
      '  .edit-card-header { background: #1c2128; border-bottom-color: #21262d; }' +
      '  .edit-card-page { color: #8b949e; }' +
      '  .edit-card-close { color: #484f58; }' +
      '  .edit-card-close:hover { background: #1c2128; color: #e6edf3; }' +
      '  .edit-type-indicator { color: #a5b0ff; border-bottom-color: #21262d; }' +
      '  .edit-label-hint { color: #484f58; }' +
      '  .edit-area-info { border-bottom-color: #21262d; color: #8b949e; }' +
      '  .edit-area-elements { border-bottom-color: #21262d; }' +
      '  .edit-area-elements-title { color: #8b949e; }' +
      '  .edit-area-el { color: #484f58; }' +
      '  .edit-area-elements-hint { border-bottom-color: #21262d; color: #484f58; }' +
      '  .edit-original-text { background: #1c2128; color: #8b949e; }' +
      '  .edit-new-text-input, .edit-note-input { background: #1c2128; color: #e6edf3; border-color: #30363d; }' +
      '  .edit-new-text-input:focus, .edit-note-input:focus { border-color: #7c8aff; }' +
      '  .edit-card-actions { border-top-color: #21262d; }' +
      '  .edit-btn-cancel { background: #1c2128; color: #8b949e; }' +
      '  .edit-btn-cancel:hover { background: #21262d; }' +
      '  .edit-btn-save { background: #7c8aff; color: #161b22; }' +
      '  .edit-btn-save:hover { background: #8e9bff; }' +
      '  .edit-page-warning { background: rgba(245,165,36,0.08); color: #f5a524; border-bottom-color: rgba(245,165,36,0.15); }' +
      '  .export-card { background: #161b22; }' +
      '  .export-card-header { background: #1c2128; border-bottom-color: #21262d; }' +
      '  .export-card-title { color: #e6edf3; }' +
      '  .export-format-tabs { background: #21262d; }' +
      '  .export-format-tab { color: #8b949e; }' +
      '  .export-format-tab.active { background: #1c2128; color: #a5b0ff; }' +
      '  .export-textarea { background: #1c2128; color: #e6edf3; border-color: #30363d; }' +
      '  .export-card-actions { border-top-color: #21262d; }' +
      '}';
  }  function closeOverlays() {
    closeEditCard();
    closeExportOverlay();
  }

  return {
    create,
    destroy,
    show,
    hide,
    minimize,
    toggle,
    refreshList,
    closeOverlays
  };
})();
