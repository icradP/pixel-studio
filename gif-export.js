import { gifPlan, encodeGifAsync } from './gif.js';
import { showDialog, hideDialog } from './dialogs.js';

export async function openGifExport(
  project,
  host,
  { from = 0, to = project.frames.length - 1, suffix = '.gif' } = {},
) {
  if (document.querySelector('#gif-export-dialog')) return;
  const d = document.createElement('dialog');
  d.id = 'gif-export-dialog';
  d.className = 'gif-export-dialog';
  d.innerHTML = `<h2>导出 GIF</h2><p class="help">自动压缩重复内容，合并相同帧。降低尺寸、颜色或帧率可进一步减小文件。</p><div id="gif-options"><label>导出预设<select id="gif-preset"><option value="original">原尺寸 · 保留帧率</option><option value="balanced">均衡 · 512 px / 15 FPS / 128 色</option><option value="small">更小 · 384 px / 12 FPS / 64 色</option></select></label><div class="scene-two"><label>起始帧<input id="gif-from" type="number" min="1" max="${project.frames.length}" value="${from + 1}"></label><label>结束帧<input id="gif-to" type="number" min="1" max="${project.frames.length}" value="${to + 1}"></label><label>最长边 / px<input id="gif-edge" type="number" min="1" max="${Math.max(project.w, project.h)}" value="${Math.max(project.w, project.h)}"></label><label>颜色上限<select id="gif-colors">${[256, 128, 64, 32, 16].map((n) => `<option value="${n}">${n} 色</option>`).join('')}</select></label></div><label>导出帧率<select id="gif-fps"><option value="0">保留原帧率</option>${[30, 24, 20, 15, 12, 10, 6].map((n) => `<option value="${n}">${n} FPS 上限</option>`).join('')}</select></label></div><p id="gif-plan" class="help"></p><p class="help">最近邻缩放保留像素边缘；GIF 不支持半透明。减少帧数保持总时长，可能降低动作流畅度。</p><progress id="gif-progress" max="1" value="0" hidden></progress><p id="gif-status" role="status"></p><img id="gif-preview" alt="导出 GIF 实际预览" hidden><div class="scene-two"><button id="gif-generate" class="primary">生成预览</button><button id="gif-download" disabled>下载 GIF</button></div><button id="gif-close">关闭</button>`;
  document.body.append(d);
  const $ = (sel) => d.querySelector(sel),
    options = () => ({
      from: Number($('#gif-from').value) - 1,
      to: Number($('#gif-to').value) - 1,
      maxEdge: Number($('#gif-edge').value),
      colors: Number($('#gif-colors').value),
      fps: Number($('#gif-fps').value),
    });
  let bytes = null,
    url = null,
    controller = null,
    closed = false;
  function discard() {
    bytes = null;
    $('#gif-download').disabled = true;
    $('#gif-preview').hidden = true;
    $('#gif-preview').removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    url = null;
  }
  function estimate() {
    discard();
    $('#gif-status').textContent = '';
    try {
      const plan = gifPlan(project, options());
      $('#gif-plan').textContent =
        `${plan.width} × ${plan.height} · ${plan.samples.length} 个采样帧 / 原 ${plan.sourceFrames} 帧 · ${(plan.duration / 1000).toFixed(2)} 秒。生成后显示实际文件大小。`;
      $('#gif-generate').disabled = false;
    } catch (e) {
      $('#gif-plan').textContent = e.message;
      $('#gif-generate').disabled = true;
    }
  }
  $('#gif-options').addEventListener('input', estimate);
  $('#gif-preset').onchange = () => {
    const preset = $('#gif-preset').value,
      edge = Math.max(project.w, project.h);
    $('#gif-edge').value =
      preset === 'original' ? edge : Math.min(edge, preset === 'balanced' ? 512 : 384);
    $('#gif-colors').value = preset === 'original' ? 256 : preset === 'balanced' ? 128 : 64;
    $('#gif-fps').value = preset === 'original' ? 0 : preset === 'balanced' ? 15 : 12;
    for (const id of ['#gif-colors', '#gif-fps'])
      $(id).dispatchEvent(new Event('change', { bubbles: true }));
    estimate();
  };
  $('#gif-generate').onclick = async () => {
    if (controller) {
      controller.abort();
      return;
    }
    discard();
    controller = new AbortController();
    const signal = controller.signal;
    $('#gif-options').inert = true;
    $('#gif-close').disabled = true;
    $('#gif-progress').hidden = false;
    $('#gif-generate').textContent = '取消生成';
    try {
      bytes = await encodeGifAsync(project, options(), {
        signal,
        progress: ({ stage, done, total }) => {
          $('#gif-progress').value = (stage === 'palette' ? 0 : 0.5) + (done / total) * 0.5;
          $('#gif-status').textContent =
            `${stage === 'palette' ? '分析全局颜色' : '压缩动画'} ${done} / ${total}`;
        },
      });
      if (closed) return;
      url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
      $('#gif-preview').src = url;
      $('#gif-preview').hidden = false;
      $('#gif-status').textContent =
        `实际文件 ${(bytes.length / 1024).toFixed(1)} KiB${bytes.length >= 1048576 ? ` · ${(bytes.length / 1048576).toFixed(2)} MiB` : ''}`;
      $('#gif-download').disabled = false;
    } catch (e) {
      if (!closed) $('#gif-status').textContent = e.message;
    } finally {
      controller = null;
      $('#gif-options').inert = false;
      $('#gif-close').disabled = false;
      $('#gif-progress').hidden = true;
      $('#gif-generate').textContent = '重新生成预览';
    }
  };
  $('#gif-download').onclick = () => {
    if (bytes) host.download(bytes, suffix, 'image/gif');
  };
  async function close() {
    if (closed) return;
    closed = true;
    controller?.abort();
    discard();
    await hideDialog(d);
    d.remove();
  }
  $('#gif-close').onclick = close;
  d.oncancel = (e) => {
    e.preventDefault();
    if (controller) controller.abort();
    else close();
  };
  estimate();
  await showDialog(d);
}
