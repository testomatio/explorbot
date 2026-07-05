(() => {
  const closest = (start, sel) => {
    let node = start;
    while (node && node !== document) {
      if (node.matches?.(sel)) return node;
      node = node.parentNode;
    }
    return null;
  };

  document.addEventListener('click', (e) => {
    const target = e.target;

    const submitBtn = closest(target, '[data-kind="button"][data-submit]');
    if (submitBtn) {
      const form = closest(submitBtn, 'form');
      if (form) form.requestSubmit();
      return;
    }

    const modalOpen = closest(target, '[data-modal-open]');
    if (modalOpen) {
      const dlg = document.getElementById(modalOpen.getAttribute('data-modal-open'));
      if (dlg?.showModal) dlg.showModal();
      else if (dlg) dlg.hidden = false;
      return;
    }

    const modalClose = closest(target, '[data-modal-close]');
    if (modalClose) {
      const dlg = document.getElementById(modalClose.getAttribute('data-modal-close'));
      if (dlg?.close) dlg.close();
      else if (dlg) dlg.hidden = true;
      return;
    }

    const trigger = closest(target, '[data-trigger]');
    if (trigger) {
      const widget = closest(trigger, '[data-widget]');
      const menu = widget?.querySelector('[data-menu]');
      if (menu) {
        menu.hidden = !menu.hidden;
        trigger.setAttribute('aria-expanded', String(!menu.hidden));
      }
      return;
    }

    const option = closest(target, '[data-menu] [data-value]');
    if (option) {
      const widget = closest(option, '[data-widget]');
      const kind = widget?.getAttribute('data-widget');
      if (kind === 'select') selectSingle(widget, option);
      else if (kind === 'multiselect') selectMulti(widget, option);
      return;
    }

    const tab = closest(target, '[data-tab]');
    if (tab) {
      const tabsWidget = closest(tab, '[data-widget="tabs"]');
      if (tabsWidget) switchTab(tabsWidget, tab.getAttribute('data-tab'));
    }
  });

  const selectSingle = (widget, option) => {
    const trigger = widget.querySelector('[data-trigger]');
    const hidden = widget.querySelector('[data-hidden]');
    if (hidden) hidden.value = option.getAttribute('data-value');
    if (trigger) trigger.textContent = option.textContent;
    widget.querySelectorAll('[role="option"]').forEach((o) => {
      o.setAttribute('aria-selected', String(o === option));
    });
    const menu = widget.querySelector('[data-menu]');
    if (menu) menu.hidden = true;
  };

  const selectMulti = (widget, option) => {
    const value = option.getAttribute('data-value');
    const name = widget.getAttribute('data-name');
    const container = widget.querySelector('[data-hidden-inputs]');
    const existing = container.querySelector(`input[value="${value}"]`);
    if (existing) {
      existing.remove();
      option.setAttribute('aria-selected', 'false');
    } else {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      container.appendChild(input);
      option.setAttribute('aria-selected', 'true');
    }
    renderChips(widget);
  };

  const renderChips = (widget) => {
    const chips = widget.querySelector('[data-chips]');
    if (!chips) return;
    chips.innerHTML = '';
    widget.querySelectorAll('[data-hidden-inputs] input').forEach((input) => {
      const opt = widget.querySelector(`[data-value="${input.value}"]`);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = opt ? opt.textContent : input.value;
      chips.appendChild(chip);
    });
  };

  const switchTab = (widget, key) => {
    widget.querySelectorAll('[data-tab]').forEach((t) => {
      t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === key));
    });
    widget.querySelectorAll('[data-panel]').forEach((p) => {
      p.hidden = p.getAttribute('data-panel') !== key;
    });
  };

  const autoOpen = document.querySelector('[data-open-on-load]');
  if (autoOpen) {
    if (autoOpen.showModal) autoOpen.showModal();
    else autoOpen.hidden = false;
  }
})();
