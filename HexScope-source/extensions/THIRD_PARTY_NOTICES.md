# 扩展工坊第三方组件

扩展工坊内置 [CyberChef 11.5.0](https://github.com/gchq/CyberChef/tree/v11.5.0)，© Crown Copyright 2016–2026，Apache-2.0。上游网页、图片、脚本和各模块的第三方许可文件完整保留在 `vendor/cyberchef`。

`UPSTREAM.json` 记录发行 URL、提交和 SHA-256；`ASSET_HASHES.json` 记录每个内置文件的哈希。npm 上游源码发行包保存在 `vendor-source`，可离线查看具体操作实现。`OperationConfig.json` 和 `Categories.json` 来自同版源码，保留其许可。

HexScope 在正式构建时创建独立的 `index.html`，加入限制联网的 CSP 和本机父子页面数据桥接；没有修改上游 JavaScript 计算模块。新增桥接代码在 `bridge.js`，界面在 `ui.js`，本机资源映射在 `../desktop/extensions-protocol.cjs`。运行时禁止 HTTP/HTTPS/FTP/WebSocket 外联；地图、DNS、HTTP 请求等联网操作因此不可用。上游英文操作名与版权信息仍保留。

源码与第三方代码的原始许可证各自适用；本说明不将第三方版权归属改为 HexScope。许可证原文见 `vendor/cyberchef/LICENSE`、`assets/main.js.LICENSE.txt` 和各 `*.LICENSE.txt`。
