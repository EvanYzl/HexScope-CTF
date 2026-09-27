# 图文模块第三方组件

本目录为 HexScope 自行实现的界面、任务服务与处理流程。算法依赖来自可再分发的开源组件，未使用参考软件的程序文件、图标或专有代码。

| 组件 | 版本 / 来源 | 许可证 | 用途 |
|---|---|---|---|
| Tesseract.js / Tesseract.js-core | 7.0.0 | Apache-2.0 | CPU OCR 和可搜索 PDF |
| tessdata_fast | 87416418657359cb625c412a48b6e1d6d41c29bd | Apache-2.0 | 73 个语言 / 竖排模型 |
| ZXing WASM / ZXing-C++ | zxing-wasm 3.1.4 | MIT / Apache-2.0 | 多格式条码读取 |
| bwip-js / BWIPP | bwip-js 4.11.4 | MIT | 111 个条码生成入口 |
| pdf-lib | 1.17.1 | MIT | PDF 叠加、合并和图像副本 |
| @pdf-lib/fontkit | 1.1.1 | MIT | 字体处理基础库 |
| docx | 9.7.2 | MIT | DOCX 导出 |
| SheetJS | 沿用文件预览内置版本 | Apache-2.0 | XLSX 导出 |
| Noto Sans CJK SC | f8d157532fbfaeda587e826d4cd5b21a49186f7c | OFL-1.1 | 字体及中英文验证样本 |

上游地址、模型逐文件 SHA-256、字体来源、全部 npm 依赖版本和原始许可文本位于 `../desktop/vendor/vision/`。SheetJS 许可沿用 `../preview/vendor` 与 `../preview/THIRD_PARTY_NOTICES.md`。运行文件已经编译并随便携包分发，使用者不需要 npm、Python 或 Java。

构建锁文件位于 `vendor-build/package-lock.json`。开发者重新获取模型时运行 `vendor-build/fetch-models.py`，重新编译依赖时在 `vendor-build` 运行 `npm ci --ignore-scripts` 和 `node build.cjs`。模型和字体使用固定提交，不在运行时更新或联网下载。
