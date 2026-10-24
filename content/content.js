const ProtoAnnotator = (() => {
  let currentMode = 'off';

  function init() {
    Messaging.onMessage(handleMessage);
    mountHud();

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown, true);

    chrome.runtime.sendMessage({ type: 'GET_MODE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[ProtoAnnotator] GET_MODE error:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.active) {
        console.log('[ProtoAnnotator] Restoring active mode on init');
        setMode(response.mode || 'annotate');
      }
    });
  }

  // Esc 的执行顺序：编辑卡片 → 标注输入卡片 → 面板浮层（导出/编辑）。
  // 只关第一个命中的那一层；返回 true 表示"这一下已经用掉了"。
  function dismissTopmostLayer() {
    if (typeof Editor !== 'undefined' && Editor.closeCard && Editor.closeCard() === true) return true;
    if (typeof Annotator !== 'undefined' && Annotator.closeCard && Annotator.closeCard() === true) return true;
    if (typeof Panel !== 'undefined' && Panel.closeOverlays && Panel.closeOverlays() === true) return true;
    return false;
  }

  function handleKeyDown(e) {
    // Esc 一次只做一件事：关掉最上面那一层；什么都没有才收起胶囊。
    // 并且**绝不清除标注高亮** —— 那是用户的标注成果，
    // 不该因为随手按一下 Esc 就消失。
    if (e.key === 'Escape') {
      if (dismissTopmostLayer()) return;
      if (typeof Hud !== 'undefined' && Hud.collapse) Hud.collapse();
      return;
    }

    if (currentMode === 'off') return;

    if (currentMode === 'edit' && Editor.handleKeyDown(e)) return;

    // Enter: confirm card if open
    if (e.key === 'Enter' && !e.shiftKey) {
      const cardContainer = document.getElementById('__proto_annotator_card__');
      if (cardContainer) {
        const confirmBtn = cardContainer.shadowRoot?.querySelector('.btn-confirm');
        if (confirmBtn && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          confirmBtn.click();
        }
      }
    }

  }

  function handleMessage(message, sender) {
    switch (message.type) {
      case 'PING':
        return { pong: true };

      case 'MODE_CHANGED':
        console.log('[ProtoAnnotator] MODE_CHANGED:', message.mode || message.active);
        setMode(message.mode || (message.active ? 'annotate' : 'paused'));
        break;

      case 'EXPORT_ANNOTATIONS':
        if (Messaging.isTopFrame) Panel.exportAnnotations();
        break;

      case 'AUTH_COMPLETED':
        if (typeof Editor !== 'undefined' && Editor.onAuthCompleted) {
          Editor.onAuthCompleted(message.ok);
        }
        // 授权结果直接影响「能不能存」，立即刷新胶囊上的就绪指示
        if (Messaging.isTopFrame) refreshHudReadiness(currentMode);
        break;

      case 'MODE_SWITCH_FAILED':
        if (typeof Editor !== 'undefined' && Editor.showModeSwitchError) {
          Editor.showModeSwitchError(message.error);
        }
        break;

      case 'ANNOTATION_CREATED':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
          loadAnnotationCount();
        }
        if (message.annotation && message.annotation.pageName === ProtoStorage.getPageName()) {
          Annotator.restoreBadges().catch(() => {});
        }
        break;

      case 'ANNOTATION_DELETED':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
          loadAnnotationCount();
        }
        Annotator.restoreBadges().catch(() => {});
        break;

      case 'ANNOTATION_UPDATED':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
          loadAnnotationCount();
        }
        Annotator.restoreBadges().catch(() => {});
        break;

      case 'NAVIGATE_TO_ANNOTATION':
        handleNavigateToAnnotation(message.annotation);
        break;

      case 'CLEAR_ALL_ANNOTATIONS':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
          loadAnnotationCount();
        }
        Annotator.restoreBadges().catch(() => {});
        break;

      case 'HIGHLIGHT_ELEMENT':
        handleHighlightElement(message);
        break;
    }
    return false;
  }

  function handleNavigateToAnnotation(annotation) {
    if (!annotation) return;

    if (Messaging.isTopFrame) {
      const targetPage = annotation.pageName;
      const iframes = document.querySelectorAll('iframe');
      let targetIframe = null;

      iframes.forEach((iframe) => {
        try {
          const src = iframe.src || iframe.getAttribute('src');
          if (src && (src.endsWith('/' + targetPage) || src.endsWith('/' + encodeURIComponent(targetPage)))) {
            targetIframe = iframe;
          }
        } catch (e) {}
      });

      if (!targetIframe && iframes.length > 0) {
        targetIframe = iframes[0];
        const currentSrc = targetIframe.src || targetIframe.getAttribute('src') || '';
        const basePath = currentSrc.substring(0, currentSrc.lastIndexOf('/') + 1);
        targetIframe.src = basePath + targetPage;
        // iframe load will trigger content script init and MODE_CHANGED restore;
        // the NAVIGATE_TO_ANNOTATION broadcast from background will reach the new iframe
      } else if (targetIframe) {
        const currentSrc = targetIframe.src || targetIframe.getAttribute('src') || '';
        if (!currentSrc.endsWith(targetPage) && !currentSrc.endsWith(encodeURIComponent(targetPage))) {
          const basePath = currentSrc.substring(0, currentSrc.lastIndexOf('/') + 1);
          targetIframe.src = basePath + targetPage;
        }
        // Since background broadcasts to all frames, the target iframe will
        // also receive this message and handle it directly.
        // The top frame just needs to scroll the iframe into view if needed.
        targetIframe.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      // iframe receives NAVIGATE_TO_ANNOTATION directly from background
      if (annotation.pageName === ProtoStorage.getPageName()) {
        Annotator.highlightAnnotation(annotation.id);
      }
    }
  }

  function handleHighlightElement(message) {
    if (message.selector) {
      const el = SelectorUtils.findElement(message.selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        Annotator.highlightAnnotation(message.annotationId);
      }
    } else if (message.areaRect) {
      Annotator.highlightAnnotation(message.annotationId);
    }
  }

  function activateMode() {
    setMode('annotate');
  }

  function deactivateMode() {
    setMode('off');
  }

  // 三态：paused / edit / annotate。
  // 历史代码里的 'off' 一律归一化为 'paused'（用户可见文案是「暂停」）。
  function normalizeMode(mode) {
    if (mode === 'edit' || mode === 'annotate') return mode;
    return 'paused';
  }

  function setMode(rawMode) {
    const mode = normalizeMode(rawMode);
    if (currentMode === mode) {
      syncHud(mode);
      return;
    }

    if (currentMode === 'annotate') {
      Annotator.deactivate();
      if (Messaging.isTopFrame) {
        Panel.hide();
        Panel.destroy();
      }
    } else if (currentMode === 'edit') {
      Editor.deactivate();
    }

    currentMode = mode;

    if (mode === 'paused') {
      console.log('[ProtoAnnotator] Mode paused');
      syncHud(mode);
      return;
    }

    console.log('[ProtoAnnotator] Mode activated:', mode);

    if (mode === 'annotate') {
      Annotator.activate();
      if (Messaging.isTopFrame) {
        Panel.create();
        Panel.show();
      }
    } else if (mode === 'edit') {
      Editor.activate();
    }

    syncHud(mode);
  }

  // 胶囊只做展示，真相来源永远是 background 广播过来的 MODE_CHANGED
  function syncHud(mode) {
    if (!Messaging.isTopFrame) return;
    if (typeof Hud === 'undefined') return;
    if (Hud.setMode) Hud.setMode(mode);
    refreshHudReadiness(mode);
  }

  // 编辑态才需要关心授权就绪；其余模式一律 unknown（不显示小黄点）
  function refreshHudReadiness(mode) {
    if (typeof Hud === 'undefined' || !Hud.setEditReadiness) return;
    if (mode !== 'edit') {
      Hud.setEditReadiness('unknown');
      return;
    }
    Messaging.sendToBackground({ type: 'GET_EDIT_READINESS', fileUrl: window.location.href })
      .then((res) => {
        Hud.setEditReadiness(res && res.ready ? 'ready' : 'not-ready');
      })
      .catch(() => Hud.setEditReadiness('unknown'));
  }

  // 胶囊点击某一段 → 走 background，等 MODE_CHANGED 回来再真正生效
  function requestMode(mode) {
    if (!Messaging.isTopFrame) return;
    Messaging.sendToBackground({
      type: 'SET_MODE',
      mode: mode,
      active: mode !== 'paused',
      topLevelUrl: window.location.href
    });
  }

  // 胶囊：只在顶层 frame 挂一次，并把它和 background 连起来
  function mountHud() {
    if (!Messaging.isTopFrame) return;
    if (typeof Hud === 'undefined') return;
    Hud.onModeRequest = requestMode;
    Hud.onPanelToggle = () => {
      if (currentMode !== 'annotate') {
        requestMode('annotate');
        return;
      }
      Panel.toggle();
    };
    Hud.mount();
    Hud.setMode(normalizeMode(currentMode));
    loadShortcutHints();
    loadAnnotationCount();
  }

  // 胶囊角标显示「本页标注数量」。
  // 改字数量属于临时过程数据，不适合常驻；已移到扩展弹窗里显示。
  // 口径与标注面板一致：同一 pageName 才算本页。
  function loadAnnotationCount() {
    if (typeof Hud === 'undefined' || !Hud.setBadgeCount) return;
    if (!Messaging.isTopFrame) return;
    ProtoStorage.getAnnotations().then((list) => {
      const page = ProtoStorage.getPageName();
      const count = (list || []).filter((a) => a && a.pageName === page).length;
      Hud.setBadgeCount(count);
    }).catch(() => {});
  }

  // 把「实际生效」的键位显示到胶囊上，而不是硬编码文案——用户改过键、
  // 或 Chrome 因冲突未分配时都能如实反映。
  // 注意：必须向 background 要（content script 的隔离世界里没有 chrome.commands）。
  function loadShortcutHints() {
    if (typeof Hud === 'undefined' || !Hud.setShortcutHints) return;
    Messaging.sendToBackground({ type: 'GET_SHORTCUTS' })
      .then((res) => {
        Hud.setShortcutHints({
          edit: (res && res.edit) || '',
          annotate: (res && res.annotate) || '',
          export: (res && res.export) || ''
        });
      })
      .catch(() => {});
  }

  return { init, activateMode, deactivateMode, setMode, mountHud };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ProtoAnnotator.init);
} else {
  ProtoAnnotator.init();
}
