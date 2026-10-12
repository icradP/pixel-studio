export async function galleryView(host) {
  const root = document.querySelector('#gallery-list');
  const toolbar = document.querySelector('#gallery-selection');
  const selected = new Set();
  let records = await host.list(),
    selecting = false,
    busy = false;

  function update() {
    document.querySelector('#gallery-select').textContent = selecting ? '完成' : '选择';
    document.querySelector('#gallery-select').disabled = busy;
    toolbar.hidden = !selecting;
    document.querySelector('#gallery-selected-count').textContent = `已选 ${selected.size} 件`;
    toolbar
      .querySelectorAll('button')
      .forEach((button) => (button.disabled = busy || !selected.size));
    document.querySelector('#gallery-rename').disabled = busy || selected.size !== 1;
    root.setAttribute('aria-busy', String(busy));
    root.querySelectorAll('.project-card').forEach((card) => {
      const chosen = selected.has(card.dataset.id);
      card.classList.toggle('selected', chosen);
      const button = card.querySelector('.project-open');
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(chosen));
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
      // Refresh committed metadata even when a batch operation only partly succeeded.
      try {
        records = await host.list();
      } catch {
        /* Keep the last visible listing. */
      }
      selected.clear();
      busy = false;
      render();
    }
  }

  function render() {
    const fragment = document.createDocumentFragment();
    records.sort((a, b) => b.updated - a.updated);
    for (const record of records) {
      const card = document.createElement('article');
      card.className = 'project-card';
      card.dataset.id = record.id;
      const button = document.createElement('button');
      button.className = 'project-open';
      button.setAttribute('aria-label', '打开 ' + record.name);
      const image = document.createElement('img');
      image.src = record.preview;
      image.alt = record.name + '预览';
      image.loading = 'lazy';
      image.decoding = 'async';
      const meta = document.createElement('div');
      meta.className = 'project-meta';
      const name = document.createElement('strong');
      name.textContent = record.name;
      const detail = document.createElement('span');
      detail.textContent = `${record.w} × ${record.h} px · ${record.frameCount} 帧`;
      meta.append(name, detail);
      button.append(image, meta);
      button.onclick = () => {
        if (selecting) {
          selected.has(record.id) ? selected.delete(record.id) : selected.add(record.id);
          update();
        } else void run(() => host.open(record));
      };
      card.append(button);
      fragment.append(card);
    }
    root.replaceChildren(fragment);
    update();
  }

  document.querySelector('#gallery-select').onclick = () => {
    selecting = !selecting;
    selected.clear();
    update();
  };
  document.querySelector('#gallery-copy').onclick = () =>
    run(async () => {
      for (const record of records.filter((item) => selected.has(item.id))) {
        const copy = await host.get(record.id);
        if (!copy) throw Error('作品已被移除');
        copy.id = crypto.randomUUID();
        copy.project.name = copy.project.name.slice(0, 157) + ' 副本';
        copy.updated = Date.now();
        await host.store(copy);
      }
    });
  document.querySelector('#gallery-rename').onclick = () =>
    run(async () => {
      const record = records.find((item) => selected.has(item.id));
      if (!record) return;
      const name = await host.ask({ title: '作品名称', value: record.name });
      if (name?.trim()) await host.rename(record, name);
    });
  document.querySelector('#gallery-delete').onclick = () =>
    run(async () => {
      const targets = records.filter((item) => selected.has(item.id));
      if (targets.some((item) => item.id === host.current())) {
        host.toast('当前打开的作品请先切换后再删除');
        return;
      }
      if (
        targets.length &&
        (await host.ask({
          title: `删除 ${targets.length} 件作品？`,
          description: '将从此设备移除，无法撤销。请先导出需要保留的作品。',
          confirm: '删除作品',
          danger: true,
        }))
      ) {
        for (const record of targets) await host.remove(record.id);
      }
    });
  render();
}
