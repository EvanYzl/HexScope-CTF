# 文件预览开发说明

`core.js` 负责识别、Office ZIP 校验、DOCX 转换、表格分页和文本编码；`worker.js` 在可停止的 Worker 内执行 Office 解析。`ui.js` 管理只读 DOM、DOCX 标签重建、表格、图片/媒体及资源生命周期。`pdf.js` 使用内嵌 PDF Worker 和固定资源字典，不从 URL 取文件。`panel.html`、`style.css` 和 `build.cjs` 接入正式 4.1 构建。

从源码根目录执行 `node build.cjs` 即可重建，已有 vendor 产物不要求 npm 安装。开发验证先 `npm ci --ignore-scripts`，再 `npm run test:preview` 或完整 `npm test`。Windows 原生镜像测试使用附带引擎。用户运行成品不安装任何开发环境。

需要重建第三方浏览器包时，在 `preview/vendor-build` 执行 `npm ci --ignore-scripts` 和 `npm run build`；使用锁定的 esbuild / Mammoth 依赖及保留的 PDF.js legacy ESM。SheetJS 沿用官方归档字节。若更新供应商文件，必须同步核对 `vendor/SOURCES.json` 中的文件哈希和许可，而不是让校验静默通过。

`tests/preview*.test.cjs` 从真实生成 HTML 读取代码，使用 Node Worker 执行嵌入的浏览器 Worker。PDF 绘制测试使用开发用的 @napi-rs/canvas 离屏画布；不启动或伪称验证了桌面窗口。`runtime-smoke.cjs` 仅依赖内置运行时，供正式打包脚本再验证产品里的 DOCX、Excel 和 PDF 解析代码。

覆盖用例包含：独立生成的 DOCX / XLSX、XLS/XLSB/ODS/CSV、无 BOM 中文、GB18030、UTF-16、UTF-8 截断、恶意节点/链接、XML 实体、路径穿越、膨胀预算、CRC 错误、加密 PDF 重试、标准字体/CMap/WASM、本地 E01 推送、密码恢复回送、停止/超时/切换与资源回收。固定样本不包含用户隐私数据。

更多功能范围与用户限制见上级交付目录 `文件预览说明.md`，依赖许可见本目录 `THIRD_PARTY_NOTICES.md`。
