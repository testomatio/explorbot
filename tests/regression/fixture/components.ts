const VARIANTS: Variant[] = ['native', 'aria', 'plain'];

export function createRegistry(opts: { mode: VariantMode; seed?: number }): Registry {
  let rng: (() => number) | null = null;
  if (opts.mode === 'random') rng = mulberry32(opts.seed || 42);

  function resolved(): Variant {
    if (opts.mode !== 'random') return opts.mode;
    return VARIANTS[Math.floor((rng as () => number)() * VARIANTS.length)];
  }

  function tag(kind: string, v: Variant): string {
    return `data-kind="${kind}" data-variant="${v}"`;
  }

  return {
    resolved,

    button(o) {
      const v = resolved();
      const type = o.submit ? 'submit' : 'button';
      const danger = when(o.danger, ' data-danger="1"');
      const action = attr('data-action', o.action);
      if (v === 'native') {
        return `<button type="${type}" ${tag('button', v)}${danger}${action}>${esc(o.label)}</button>`;
      }
      const submitAttr = when(o.submit, ' data-submit="1"');
      if (v === 'aria') {
        return `<span role="button" tabindex="0" aria-label="${esc(o.label)}" ${tag('button', v)}${submitAttr}${danger}${action}>${esc(o.label)}</span>`;
      }
      return `<span class="ui-btn" ${tag('button', v)}${submitAttr}${danger}${action}>${esc(o.label)}</span>`;
    },

    textField(o) {
      const v = resolved();
      const type = o.type || 'text';
      const value = attr('value', o.value);
      const required = when(o.required, ' required');
      const id = `f-${o.name}`;
      if (v === 'native') {
        return `<div class="field"><label for="${id}">${esc(o.label)}</label><input id="${id}" name="${o.name}" type="${type}"${value}${required} ${tag('textField', v)}></div>`;
      }
      if (v === 'aria') {
        return `<div class="field"><input name="${o.name}" type="${type}" aria-label="${esc(o.label)}"${value}${required} ${tag('textField', v)}></div>`;
      }
      return `<div class="field"><input name="${o.name}" type="${type}" placeholder="${esc(o.label)}"${value}${required} ${tag('textField', v)}></div>`;
    },

    textArea(o) {
      const v = resolved();
      const id = `f-${o.name}`;
      const value = esc(o.value || '');
      if (v === 'native') {
        return `<div class="field"><label for="${id}">${esc(o.label)}</label><textarea id="${id}" name="${o.name}" ${tag('textArea', v)}>${value}</textarea></div>`;
      }
      if (v === 'aria') {
        return `<div class="field"><textarea name="${o.name}" aria-label="${esc(o.label)}" ${tag('textArea', v)}>${value}</textarea></div>`;
      }
      return `<div class="field"><textarea name="${o.name}" placeholder="${esc(o.label)}" ${tag('textArea', v)}>${value}</textarea></div>`;
    },

    select(o) {
      const v = resolved();
      if (v === 'native') {
        const id = `f-${o.name}`;
        const opts = o.options.map((opt) => `<option value="${esc(opt.value)}"${when(opt.value === o.selected, ' selected')}>${esc(opt.label)}</option>`).join('');
        return `<div class="field"><label for="${id}">${esc(o.label)}</label><select id="${id}" name="${o.name}" ${tag('select', v)}>${opts}</select></div>`;
      }
      const current = o.options.find((opt) => opt.value === o.selected) || o.options[0];
      const hidden = `<input type="hidden" name="${o.name}" value="${esc(current.value)}" data-hidden>`;
      if (v === 'aria') {
        const options = o.options.map((opt) => `<div role="option" data-value="${esc(opt.value)}" aria-selected="${String(opt.value === current.value)}">${esc(opt.label)}</div>`).join('');
        return `<div class="field" data-widget="select"><span class="label">${esc(o.label)}</span><div role="combobox" tabindex="0" aria-expanded="false" aria-haspopup="listbox" data-trigger ${tag('select', v)}>${esc(current.label)}</div><div role="listbox" data-menu hidden>${options}</div>${hidden}</div>`;
      }
      const options = o.options.map((opt) => `<div class="opt" data-value="${esc(opt.value)}">${esc(opt.label)}</div>`).join('');
      return `<div class="field" data-widget="select"><span>${esc(o.label)}</span><div class="combo" data-trigger ${tag('select', v)}>${esc(current.label)}</div><div class="menu" data-menu hidden>${options}</div>${hidden}</div>`;
    },

    multiselect(o) {
      const v = resolved();
      const selected = o.selected || [];
      if (v === 'native') {
        const id = `f-${o.name}`;
        const opts = o.options.map((opt) => `<option value="${esc(opt.value)}"${when(selected.includes(opt.value), ' selected')}>${esc(opt.label)}</option>`).join('');
        const rows = Math.min(Math.max(o.options.length, 3), 6);
        return `<div class="field"><label for="${id}">${esc(o.label)}</label><select id="${id}" name="${o.name}" multiple size="${rows}" ${tag('multiselect', v)}>${opts}</select></div>`;
      }
      const hidden = selected.map((val) => `<input type="hidden" name="${o.name}" value="${esc(val)}">`).join('');
      const chips = selected.map((val) => chipFor(o.options, val)).join('');
      if (v === 'aria') {
        const options = o.options.map((opt) => `<div role="option" data-value="${esc(opt.value)}" aria-selected="${String(selected.includes(opt.value))}">${esc(opt.label)}</div>`).join('');
        return `<div class="field" data-widget="multiselect" data-name="${o.name}"><span class="label">${esc(o.label)}</span><div role="combobox" tabindex="0" aria-expanded="false" aria-haspopup="listbox" data-trigger ${tag('multiselect', v)}>Select ${esc(o.label)}</div><div class="chips" data-chips>${chips}</div><div role="listbox" aria-multiselectable="true" data-menu hidden>${options}</div><span data-hidden-inputs>${hidden}</span></div>`;
      }
      const options = o.options.map((opt) => `<div class="opt" data-value="${esc(opt.value)}">${esc(opt.label)}</div>`).join('');
      return `<div class="field" data-widget="multiselect" data-name="${o.name}"><span>${esc(o.label)}</span><div class="combo" data-trigger ${tag('multiselect', v)}>Select ${esc(o.label)}</div><div class="chips" data-chips>${chips}</div><div class="menu" data-menu hidden>${options}</div><span data-hidden-inputs>${hidden}</span></div>`;
    },

    dropdownMenu(o) {
      const v = resolved();
      if (v === 'native') {
        const items = o.items.map((it) => menuItemNative(it)).join('');
        return `<details class="dropdown" ${tag('dropdownMenu', v)}><summary>${esc(o.label)}</summary><div class="menu">${items}</div></details>`;
      }
      if (v === 'aria') {
        const items = o.items.map((it) => menuItemRole(it, 'menuitem')).join('');
        return `<div class="dropdown" data-widget="dropdown"><button type="button" aria-haspopup="menu" aria-expanded="false" data-trigger ${tag('dropdownMenu', v)}>${esc(o.label)}</button><div role="menu" data-menu hidden>${items}</div></div>`;
      }
      const items = o.items.map((it) => menuItemRole(it, '')).join('');
      return `<div class="dropdown" data-widget="dropdown"><div class="combo" data-trigger ${tag('dropdownMenu', v)}>${esc(o.label)}</div><div class="menu" data-menu hidden>${items}</div></div>`;
    },

    modal(o) {
      const v = resolved();
      const danger = when(o.danger, ' data-danger="1"');
      const confirmForm = `<form method="post" action="${o.confirmAction}"><button type="submit"${danger}>${esc(o.confirmLabel)}</button></form>`;
      if (v === 'native') {
        return `<button type="button" data-modal-open="${o.id}" ${tag('modal', v)}>${esc(o.triggerLabel)}</button><dialog id="${o.id}" hidden><h2>${esc(o.title)}</h2><p>${esc(o.body)}</p>${confirmForm}<button type="button" data-modal-close="${o.id}">Cancel</button></dialog>`;
      }
      if (v === 'aria') {
        return `<button type="button" data-modal-open="${o.id}" ${tag('modal', v)}>${esc(o.triggerLabel)}</button><div id="${o.id}" role="dialog" aria-modal="true" aria-labelledby="${o.id}-t" class="overlay" hidden><div class="dialog"><h2 id="${o.id}-t">${esc(o.title)}</h2><p>${esc(o.body)}</p>${confirmForm}<button type="button" data-modal-close="${o.id}">Cancel</button></div></div>`;
      }
      return `<div class="ui-btn" data-modal-open="${o.id}" ${tag('modal', v)}>${esc(o.triggerLabel)}</div><div id="${o.id}" class="overlay" hidden><div class="dialog"><strong>${esc(o.title)}</strong><p>${esc(o.body)}</p>${confirmForm}<div class="ui-btn" data-modal-close="${o.id}">Cancel</div></div></div>`;
    },

    tabs(o) {
      const v = resolved();
      const active = o.active || o.tabs[0]?.key;
      const panel = o.tabs.find((t) => t.key === active) || o.tabs[0];
      if (v === 'native') {
        const links = o.tabs.map((t) => `<a href="?tab=${t.key}"${when(t.key === active, ' aria-current="page"')}>${esc(t.label)}</a>`).join(' ');
        return `<div class="tabs" ${tag('tabs', v)}><nav>${links}</nav><section>${panel?.content || ''}</section></div>`;
      }
      if (v === 'aria') {
        const tabsHtml = o.tabs.map((t) => `<button type="button" role="tab" aria-selected="${String(t.key === active)}" data-tab="${t.key}">${esc(t.label)}</button>`).join('');
        const panels = o.tabs.map((t) => `<div role="tabpanel" data-panel="${t.key}"${when(t.key !== active, ' hidden')}>${t.content}</div>`).join('');
        return `<div class="tabs" data-widget="tabs" ${tag('tabs', v)}><div role="tablist">${tabsHtml}</div>${panels}</div>`;
      }
      const tabsHtml = o.tabs.map((t) => `<div class="tab" data-tab="${t.key}">${esc(t.label)}</div>`).join('');
      const panels = o.tabs.map((t) => `<div class="panel" data-panel="${t.key}"${when(t.key !== active, ' hidden')}>${t.content}</div>`).join('');
      return `<div class="tabs" data-widget="tabs" ${tag('tabs', v)}><div class="tablist">${tabsHtml}</div>${panels}</div>`;
    },
  };
}

function menuItemNative(it: MenuItem): string {
  if (it.href) return `<a href="${it.href}">${esc(it.label)}</a>`;
  return `<form method="post" action="${it.action}"><button type="submit">${esc(it.label)}</button></form>`;
}

function menuItemRole(it: MenuItem, role: string): string {
  const roleAttr = when(role, ` role="${role}"`);
  if (it.href) return `<a${roleAttr} href="${it.href}" data-item>${esc(it.label)}</a>`;
  return `<form method="post" action="${it.action}"><button type="submit"${roleAttr} data-item>${esc(it.label)}</button></form>`;
}

function chipFor(options: Opt[], value: string): string {
  const opt = options.find((o) => o.value === value);
  const label = opt?.label || value;
  return `<span class="chip" data-chip="${esc(value)}">${esc(label)}</span>`;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(name: string, value?: string): string {
  if (!value) return '';
  return ` ${name}="${esc(value)}"`;
}

function when(cond: unknown, str: string): string {
  if (cond) return str;
  return '';
}

export type Variant = 'native' | 'aria' | 'plain';
export type VariantMode = Variant | 'random';

interface Opt {
  value: string;
  label: string;
}

interface MenuItem {
  label: string;
  href?: string;
  action?: string;
}

interface Tab {
  key: string;
  label: string;
  content: string;
}

export interface Registry {
  resolved(): Variant;
  button(o: { label: string; action?: string; submit?: boolean; danger?: boolean }): string;
  textField(o: { label: string; name: string; type?: string; value?: string; required?: boolean }): string;
  textArea(o: { label: string; name: string; value?: string }): string;
  select(o: { label: string; name: string; options: Opt[]; selected?: string }): string;
  multiselect(o: { label: string; name: string; options: Opt[]; selected?: string[] }): string;
  dropdownMenu(o: { label: string; items: MenuItem[] }): string;
  modal(o: { id: string; triggerLabel: string; title: string; body: string; confirmLabel: string; confirmAction: string; danger?: boolean }): string;
  tabs(o: { id: string; tabs: Tab[]; active?: string }): string;
}
