import { createWebMCP, modelContext } from './webmcp.js';
import { createInterfaceAPI } from './editor-interface.js';

export function createEditorIntegration(host) {
  const context = modelContext(document, navigator),
    pointers = new Set();
  let enabled = true,
    api = null,
    adapter = null,
    loading = null,
    activity = null;
  let status = { state: context ? 'loading' : 'unsupported', count: 0 };
  try {
    enabled = localStorage.getItem('pixel-studio-site-tools') !== 'off';
  } catch {}
  document.addEventListener('pointerdown', (e) => pointers.add(e.pointerId), true);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    document.addEventListener(name, (e) => pointers.delete(e.pointerId), true);
  window.addEventListener('blur', () => pointers.clear());
  function update() {
    const label = document.querySelector('#ai-tools-status'),
      cancel = document.querySelector('#ai-tools-cancel');
    if (label)
      label.textContent = activity?.running
        ? `${activity.title}${activity.total ? ` · ${activity.done}/${activity.total}` : '…'}`
        : status.state === 'ready'
          ? `已就绪 · ${status.count} 个工具${activity?.message ? ` · ${activity.message}` : ''}`
          : {
              disabled: '已关闭',
              unsupported: '当前浏览器尚未提供站点工具',
              loading: '正在准备工具…',
              error: '注册失败，可关闭后重新开启',
            }[status.state];
    if (cancel) cancel.hidden = !activity?.running;
    const toggle = document.querySelector('#ai-tools-enabled');
    if (toggle) toggle.checked = enabled;
  }
  async function start() {
    if (!enabled) {
      status = { state: 'disabled', count: 0 };
      update();
      return;
    }
    if (!context) {
      update();
      return;
    }
    loading ||= import('./editor-api.js').then(({ createEditorAPI }) => {
      api = createEditorAPI({
        ...host,
        snapshot() {
          const s = host.snapshot(),
            active = document.activeElement;
          const enteringText = active?.matches(
            'input:not([type=checkbox]):not([type=range]):not([type=button]):not([type=file]),textarea,[contenteditable=true]',
          );
          return {
            ...s,
            busy:
              s.busy ||
              (pointers.size
                ? '请先结束当前触控或拖动'
                : enteringText
                  ? '请先完成正在输入的内容'
                  : null),
          };
        },
        activity(value) {
          activity = value;
          update();
        },
      });
      const ui = createInterfaceAPI({ ...host, pointerBusy: () => pointers.size > 0 });
      adapter = createWebMCP(
        {
          ...api,
          tools: [...api.tools, ...ui.tools],
          cancel: () => {
            api.cancel();
            ui.cancel();
          },
          execute: (name, args, options) => {
            const isUI = ui.tools.some((t) => t.name === name),
              read = name === 'pixel_get_interface' || name === 'pixel_get_document';
            if (!read && (isUI ? api.getDocument().operation : ui.busy))
              throw Object.assign(Error('另一个编辑操作正在执行'), { code: 'EDITOR_BUSY' });
            return isUI ? ui.execute(name, args, options) : api.execute(name, args, options);
          },
        },
        context,
        (value) => {
          status = value;
          update();
        },
      );
    });
    try {
      await loading;
      if (enabled) await adapter.start();
    } catch (e) {
      loading = null;
      status = { state: 'error', message: e.message, count: 0 };
      update();
    }
  }
  function settings(container) {
    const section = document.createElement('section');
    section.className = 'setting-group';
    section.innerHTML =
      '<h3>AI 协作</h3><label class="switch"><span>允许站点工具<small>让支持的 AI 操作当前作品；修改可撤销</small></span><input id="ai-tools-enabled" type="checkbox"></label><p id="ai-tools-status" class="help" role="status"></p><button id="ai-tools-cancel" class="panel-wide" hidden>取消当前 AI 操作</button><details class="settings-help"><summary>如何使用</summary><p>在支持 WebMCP 的浏览器或 AI 客户端中打开画室，然后让 AI 读取作品、绘制像素或设置动画。AI 与你使用同一份作品和撤销记录。操作期间你仍可编辑；作品改变后，旧版本的 AI 修改会被拒绝。</p><p>作品保存在当前设备。工具会向调用它的 AI 返回作品信息与预览图。浏览器不支持站点工具时，仍可正常绘画。</p></details>';
    container.append(section);
    section.querySelector('#ai-tools-enabled').onchange = async (e) => {
      enabled = e.target.checked;
      try {
        localStorage.setItem('pixel-studio-site-tools', enabled ? 'on' : 'off');
      } catch {}
      if (enabled) await start();
      else {
        await adapter?.stop();
        status = { state: 'disabled', count: 0 };
        update();
      }
    };
    section.querySelector('#ai-tools-cancel').onclick = () => api?.cancel();
    update();
  }
  window.addEventListener('pagehide', () => adapter?.stop());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && enabled) start();
  });
  return { start, settings };
}
