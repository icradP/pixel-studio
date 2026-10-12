像素画室 · Pixel Studio v0.9.1

在线画室：https://icradP.github.io/pixel-studio/

使用 iPad Safari 打开，分享 → 添加到主屏幕。
源码位于 dist/，开发预览 npm run dev，测试 npm test。
作品保存在浏览器本地；换设备前导出 .pixel 或 .aseprite 备份。
Apple Pencil 与触控手势仍需 iPad 真机验证。
详见 使用说明.txt 和 验证结果.txt。

开发与检查
------------
使用 Node.js 22.13+（CI 使用 Node.js 24）。首次开发运行 npm ci。
本项目没有运行时 npm 依赖；新增依赖仅用于代码检查和测试。

npm run dev             启动 http://127.0.0.1:13838
npm test                运行 Node 单元测试
npm run lint            ESLint 检查，不允许警告
npm run format          统一代码格式
npm run precache        更新离线资源清单及内容版本
npm run check           格式、Lint、单元测试、离线清单一致性检查
npm run test:browser    Playwright 浏览器回归

首次运行浏览器测试需 npx playwright install chromium；也可通过
PIXEL_BROWSER_PATH 指定本机浏览器可执行文件，避免重复下载。
PIXEL_TEST_OUTPUT 可指定测试输出目录。PIXEL_PORT 可修改开发服务端口。
临时缓存与浏览器下载位置可通过 TMPDIR、npm_config_cache 和
PLAYWRIGHT_BROWSERS_PATH 指定；本工作区应使用 /Volumes/ssd01/tmp/codex/。

发布前依次运行：npm run format、npm run precache、npm run check、
npm run test:browser。将 dist/ 原样发布到静态托管服务即可。
GitHub Actions 会对 push / pull request 自动执行上述检查及浏览器回归。
生成的 dist/precache.js 需要提交；CI 检测遗漏的资源或过期版本号。
不要手动修改生成文件；不要将 node_modules、测试输出或私有素材提交到仓库。

架构与约定
------------
保留原生 ES Modules 与静态部署。dist/ 是可读源码，不是构建产物。

app.js：协调编辑状态、界面、输入事件及保存；功能模块通过回调访问当前状态。
engine.js：纯数据模型、像素算法、合成、文件项目校验。
project-store.js：IndexedDB 事务与版本升级。projects 保存完整作品，
  summaries 保存画廊元数据，两者在同一事务中写入和删除。
  v1 数据升级到 v2 时逐条迁移；只有用户打开或复制作品时才加载完整像素。
history.js：撤销/重做快照的所有权、分支和容量控制。
  两个栈合计最多 30 个快照、64 MiB 像素数据；不保留超过预算的快照。
render-scheduler.js：高频输入合并到 requestAnimationFrame，像素编辑仍同步执行。
controls.js / controls.css：统一按钮、滑条、开关和可键盘操作的选择菜单。
  select 保留表单值与 change 事件；代理控件同步 disabled / hidden，支持对话框顶层。
floating.js / motion.js：浮窗的开关、层级、位置记忆、拖动与可中断的合成动画。
  重复点击切换显示；收起后再次点击展开；支持 Escape、焦点返回和减少动态效果。
limits.js：画布、图层、帧、历史和预览缓存预算，容量界面与数据校验使用相同常量。
brushes.js：笔刷预设、参数校验、固定画布相位的抖色与笔尖覆盖算法。
  brush-library.js / brushes.css 按需加载笔刷库、分类调校和独立试画板。
  Magic Pencil 共用笔刷状态，每支笔刷的参数单独保存到本设备。
canvas-resize.js：先校验尺寸与总像素预算，再逐行复制所有帧/图层，保留 RGBA。
  canvas-expansion.js 按需加载四向扩展预览；应用纳入现有历史与自动保存。
pixel-renderer.js：WebGL 像素边缘采样，不能使用时回退 Canvas 2D。
  Canvas 显示插值只影响预览，不修改项目像素。
animation*.js / selection*.js：动画与选区算法和界面。
  selection-ui.js：连续添加、减选、阈值拖动及取样设置，按屏幕刷新合并重算。
  selection-history.js：选区与取样状态的独立撤销/重做，最多 30 次 / 4 MiB。
  selection-overlay.js：缓存选区几何，编辑时反色预览，绘画时遮罩选区外区域。
pixel-worker.js：图片转换计算；主线程负责文件读取与交互。
precache.js / sw.js：完整缓存同一版本资源，保存后手动应用更新。
  缓存名称包含部署路径；清理旧版本时只处理本部署路径的缓存。

改动数据算法时补充纯函数测试；改动保存、导入或交互链路时补充浏览器回归。
保存成功以 IndexedDB transaction complete 为准，不能以 request success 代替。
当前作品保存失败时停止切换，保持未保存内容可导出。
不要把作品名、导入内容直接拼接到 HTML；优先使用 textContent 或显式转义。
第三方 perfect-pixel.js 保留原有许可证与格式。

浏览器回归包含绘画/撤销/重做/刷新恢复、旧库迁移、画廊操作、
保存失败保护、离线启动及 Worker，以及 iPad 横竖屏尺寸的浮窗可用性。
桌面 Chromium 的视口回归不能替代真实 iPad Safari、Apple Pencil 和触控实测。

交互与性能约定
------------
本项目原本就是 Vanilla JavaScript，不需要进行 React 迁移。
采用按需加载：ASE、GIF、SVG 编解码、图片导入与插件界面在使用时动态加载；
离线资源清单仍提前缓存这些文件，因此安装完成后离线也能使用。
普通笔画只使当前帧缓存失效，帧按钮复用；图层与帧结构改变时完整失效。
缩略图最大边长 96 像素，剩余帧按约 4 ms 的批次准备；色环静态部分缓存，
滑动只更新选择标记及颜色区域，每个屏幕刷新周期最多更新一次。
避免 pointermove 中反复读取布局；窗口拖动使用 translate3d，结束后提交位置。
主题使用中性灰表面与透明棋盘，保持项目自身颜色；缩放插值仍只影响显示。

画布左上角的「容量」和偏好设置均可打开容量面板。
画布不超过 512 × 512、32 图层、240 帧，且总计不超过 800 万像素；
这些限制同时生效。例如较大的画布不能同时达到最大图层数和最大帧数。
撤销与重做共用 30 步 / 64 MiB 像素预算，帧预览缓存预算 32 MiB，
单个导入文件最大 60 MiB。界面显示当前占用、动态剩余图层/帧数与接近上限提示。
这些数字是应用数据预算，不是 Safari 或设备总内存上限；转换、纹理和系统另有开销。
