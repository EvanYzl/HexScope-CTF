# 文件预览组件与许可

所有运行代码和辅助二进制资源在本地使用；没有 CDN 或在线转换调用。上游归档、SHA-256 与 npm 完整性字段在 `vendor/SOURCES.json`，原归档保存在 `vendor/upstream-archives`。每项许可原文与版权声明均随源码和便携包提供。

| 组件 | 版本 | 许可、用途和来源 |
|---|---|---|
| Mammoth | 1.13.0 | BSD-2-Clause；DOCX 转换。[上游](https://github.com/mwilliamson/mammoth.js)。`vendor/mammoth.LICENSE`；此处由 esbuild 从官方 npm 源码和锁定依赖重建浏览器包，未修改算法源码。 |
| SheetJS CE | 0.20.3 | Apache-2.0；XLS/XLSX/XLSB/ODS/CSV 等。[上游](https://git.sheetjs.com/SheetJS/sheetjs)。`vendor/sheetjs.LICENSE`，使用官方 CDN 发布归档的 `xlsx.full.min.js`，未修改。 |
| Mozilla PDF.js | 6.3.289 | Apache-2.0；PDF 解析与页面绘制。[上游](https://github.com/mozilla/pdf.js)。`vendor/pdfjs/LICENSE`；官方 legacy ESM 经 esbuild 转为本地 IIFE，移除运行时 ESM 加载需要；上游 ESM 原件保留。 |
| core-js | 3.50.0 | MIT；PDF.js 官方 legacy 构建已经包含的兼容代码。`vendor/pdfjs/core-js.LICENSE`。 |

Mammoth 的完整锁定依赖及许可证保存在 `vendor/mammoth-licenses/MANIFEST.json` 和该目录内。包括 @xmldom/xmldom、base64-js、dingbat-to-unicode、JSZip、lop、option、underscore、xmlbuilder 以及压缩/流辅助组件。JSZip 使用其双重许可中的 MIT 选项，原双重许可文本也保留。

PDF.js 的 CMap、标准字体和 WASM 解码资源均随包保留。字体在 `vendor/pdfjs/standard_fonts`，相关 Foxit / Liberation 许可在同目录；JPEG2000、JBIG2、QCMS、QuickJS 等资源及按文件声明的许可位于 `vendor/pdfjs/wasm`。使用适用文件各自的原许可证，不能将字体和解码器统一视作 Apache-2.0。

主程序沿用已有 fflate 0.8.3（MIT）执行验证后的 Office ZIP 重打包；许可见上层 `vendor/fflate.LICENSE.txt`。

仅开发依赖：esbuild 0.25.5（MIT），jsdom 26.1.0（MIT），@napi-rs/canvas 1.0.9（MIT，及其分发中的其他许可）。这些测试/构建包不随用户运行组件引入。用于生成固定测试样本的 openpyxl、Pillow、pypdf 也不是产品运行依赖。

PDF 浏览器 IIFE 将 `process` 定义为 `undefined`，把未使用的 Node 分支 `import.meta.url` 替换为 `about:blank`。这属于构建封装变化；`vendor-build/build.cjs`、`package-lock.json` 和 `vendor/pdfjs/BUNDLE_INFO.json` 记录重建方式和产物哈希。
