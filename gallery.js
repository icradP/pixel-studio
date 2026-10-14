import { createGalleryLayout } from './gallery-layout.js';
import { itemGestures } from './item-gestures.js';

export async function galleryView(host) {
  const q = (selector) => document.querySelector(selector);
  const root = q('#gallery-list'),
    toolbar = q('#gallery-selection'),
    selected = new Set();
  let records = await host.list(),
    selecting = false,
    busy = false,
    folder = null,
    saved = {};
  records.sort((a, b) => b.updated - a.updated);
  try {
    saved = JSON.parse(localStorage.getItem('pixel-studio-gallery-layout') || '{}');
  } catch {}
  let layout = createGalleryLayout(records, saved);
  const members = (entry) => entry.members || [entry.id];
  function persist() {
    try {
      localStorage.setItem('pixel-studio-gallery-layout', JSON.stringify(layout.state));
    } catch {
      host.toast('画廊排序未能保存，作品数据不受影响');
    }
  }
  function update() {
    q('#gallery-select').textContent = selecting ? '完成' : '选择';
    q('#gallery-select').disabled = busy;
    toolbar.hidden = !selecting;
    q('#gallery-selected-count').textContent = `已选 ${selected.size} 件`;
    toolbar
      .querySelectorAll('button')
      .forEach((button) => (button.disabled = busy || !selected.size));
    q('#gallery-rename').disabled = busy || selected.size !== 1;
    q('#gallery-unstack').hidden = !folder;
    q('#gallery-examples').hidden = selecting || !!folder;
    root.setAttribute('aria-busy', String(busy));
    root.querySelectorAll('.project-card').forEach((card) => {
      const stack = layout.state.stacks.find((s) => s.id === card.dataset.id);
      const chosen = (stack?.members || [card.dataset.id]).every((id) => selected.has(id));
      card.classList.toggle('selected', chosen);
      card.querySelectorAll('button').forEach((button) => (button.disabled = busy));
      card.querySelector('.project-open').setAttribute('aria-pressed', String(chosen));
    });
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    update();
    try {
      await action();
    } catch (error) {
      host.toast(error.message || '作品操作失败，请重试');
    } finally {
      try {
        records = await host.list();
      } catch {
        /* Keep the last committed listing. */
      }
      layout = createGalleryLayout(records, layout.state);
      if (!layout.state.stacks.some((s) => s.id === folder)) folder = null;
      selected.clear();
      busy = false;
      persist();
      render();
    }
  }
  const targets = () => records.filter((record) => selected.has(record.id));
  async function rename(record) {
    if (!record) return;
    const name = await host.ask({
      title: record.members ? '堆叠名称' : '作品名称',
      value: record.name,
    });
    if (!name?.trim()) return;
    if (record.members) record.name = name.trim().slice(0, 80);
    else await host.rename(record, name);
  }
  async function copy(items) {
    for (const record of items) {
      const next = await host.get(record.id);
      if (!next) throw Error('作品已被移除');
      next.id = crypto.randomUUID();
      next.project.name = next.project.name.slice(0, 157) + ' 副本';
      next.updated = Date.now();
      await host.store(next);
    }
  }
  async function remove(items) {
    if (items.some((record) => record.id === host.current())) {
      host.toast('当前打开的作品请先切换后再删除');
      return;
    }
    if (
      items.length &&
      (await host.ask({
        title: `删除 ${items.length} 件作品？`,
        description: '将从此设备移除，无法撤销。请先导出需要保留的作品。',
        confirm: '删除作品',
        danger: true,
      }))
    )
      for (const record of items) await host.remove(record.id);
  }
  function render() {
    const stack = layout.state.stacks.find((s) => s.id === folder);
    const byId = new Map(records.map((record) => [record.id, record]));
    const entries = [],
      emitted = new Set();
    for (const id of layout.state.order) {
      if (stack) {
        if (stack.members.includes(id)) entries.push(byId.get(id));
        continue;
      }
      const group = layout.state.stacks.find((s) => s.members.includes(id));
      if (!group) entries.push(byId.get(id));
      else if (!emitted.has(group.id)) {
        entries.push(group);
        emitted.add(group.id);
      }
    }
    q('#gallery-back').hidden = !stack;
    q('#gallery-stack-name').textContent = stack?.name || '';
    q('#gallery-total').textContent = `${stack ? stack.members.length : records.length} 件作品`;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const record = entry.members ? byId.get(entry.members[0]) : entry;
      const card = document.createElement('article');
      card.className = 'project-card' + (entry.members ? ' stack-card' : '');
      card.dataset.id = card.dataset.dragKey = entry.id;
      const button = document.createElement('button');
      button.className = 'project-open';
      button.dataset.itemTouch = '';
      button.setAttribute(
        'aria-label',
        '打开 ' + entry.name + (entry.members ? `，堆叠，${entry.members.length} 件作品` : ''),
      );
      const preview = document.createElement('span');
      preview.className = 'project-preview';
      const covers = entry.members ? entry.members.slice(0, 3).map((id) => byId.get(id)) : [record];
      for (let i = covers.length - 1; i >= 0; i--) {
        const image = document.createElement('img');
        image.src = covers[i].preview;
        image.alt = i ? '' : entry.name + '预览';
        image.className = i ? 'stack-sheet stack-sheet-' + i : 'project-cover';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.draggable = false;
        preview.append(image);
      }
      if (entry.members) {
        const badge = document.createElement('span');
        badge.className = 'stack-count';
        badge.textContent = entry.members.length;
        badge.setAttribute('aria-hidden', 'true');
        preview.append(badge);
      }
      button.append(preview);
      button.onclick = () => {
        if (selecting) {
          const all = members(entry).every((id) => selected.has(id));
          members(entry).forEach((id) => (all ? selected.delete(id) : selected.add(id)));
          update();
        } else if (entry.members) {
          folder = entry.id;
          render();
        } else void run(() => host.open(record));
      };
      const meta = document.createElement('div');
      meta.className = 'project-meta';
      const name = document.createElement('button');
      name.className = 'project-name';
      name.textContent = entry.name;
      name.setAttribute('aria-label', '重命名 ' + entry.name);
      name.onclick = () => run(() => rename(entry));
      const detail = document.createElement('span');
      detail.textContent = entry.members
        ? `${entry.members.length} 件作品 · 堆叠`
        : `${record.w} × ${record.h} px · ${record.frameCount} 帧`;
      meta.append(name, detail);
      const actions = document.createElement('div');
      actions.className = 'project-card-actions';
      actions.hidden = true;
      for (const [label, action] of [
        ['分享', () => host.share(members(entry))],
        ['复制', () => copy(records.filter((r) => members(entry).includes(r.id)))],
        ['删除', () => remove(records.filter((r) => members(entry).includes(r.id)))],
      ]) {
        const actionButton = document.createElement('button');
        actionButton.textContent = label;
        actionButton.onclick = () => run(action);
        actions.append(actionButton);
      }
      const more = document.createElement('button');
      more.className = 'project-more';
      more.textContent = '···';
      more.setAttribute('aria-label', '管理 ' + entry.name);
      const showActions = () => {
        const show = actions.hidden;
        root.querySelectorAll('.project-card-actions').forEach((el) => (el.hidden = true));
        actions.hidden = !show;
      };
      more.onclick = showActions;
      card.append(button, meta, more, actions);
      itemGestures(card, {
        scroller: q('#gallery-dialog'),
        swipe: () => showActions(),
        drop: (destination) => {
          if (busy) return;
          if (layout.state.stacks.some((s) => s.id === destination))
            layout.moveToStack(members(entry), destination);
          else for (const id of members(entry)) layout.reorder(id, destination);
          persist();
          render();
        },
      });
      fragment.append(card);
    }
    root.replaceChildren(fragment);
    update();
  }
  q('#gallery-select').onclick = () => {
    selecting = !selecting;
    selected.clear();
    update();
  };
  q('#gallery-back').onclick = () => {
    folder = null;
    selected.clear();
    render();
  };
  q('#gallery-copy').onclick = () => run(() => copy(targets()));
  q('#gallery-rename').onclick = () => run(() => rename(targets()[0]));
  q('#gallery-delete').onclick = () => run(() => remove(targets()));
  q('#gallery-share').onclick = () => run(() => host.share([...selected]));
  q('#gallery-stack').onclick = () =>
    run(async () => {
      const name = await host.ask({ title: '新建堆叠', value: '堆叠', confirm: '堆叠作品' });
      if (name) {
        layout.stack([...selected], name, 'stack-' + crypto.randomUUID());
        folder = null;
      }
    });
  q('#gallery-unstack').onclick = () => run(() => layout.unstack([...selected]));
  render();
}
