# HexScope 4.1 内置密码模块

本目录是正式源码的一部分。根目录 `build.cjs` 从当前 `src/template.html` 构建 4.1，再通过本目录 `build.cjs` 组合密码 Worker、样式、示例、78 项工具目录和界面。没有旧 4.0 HTML 底座依赖。

- `src/`：原模块完整算法、启发式分析、Worker、目录和界面。UI 使用 `HexApp.showWorkspace` 切换工作区，通过 `HexApp.addFiles` 将原始字节交给文件分析。
- `vendor/`：CryptoJS、noble / Twofish bundle、固定来源和许可证。主项目自己的 core、CTF、fflate 由当前主源码提供；此处旧模块带来的三份副本仅保留作来源核对，不参与构建。
- `vendor-build/`：第三方 bundle 的入口、精确版本和锁文件。正常构建直接内嵌现成 bundle；修改依赖时可在此目录执行 `npm ci --ignore-scripts`、`npm run build`。同版本重建已与原 bundle 做 SHA-256 一致性检查。
- `tests/`：197 项原模块测试和 12 项集成用例。算法、Worker、界面全部从主项目刚生成的 `../HexScope.html` 读取（路径由测试辅助文件相对根目录解析），并校验 `HexScope.build.json` 的输入哈希；不会回退到旧页面。
- `history/`：独立版本的原始验证记录，仅保留来历。里面的 197 项历史结果不能替代本次集成验证。

从 `HexScope-source` 根目录执行 `npm ci --ignore-scripts`、`npm test`，会先重建再运行全部测试；`npm run test:crypto` 只重建并运行密码相关测试。测试使用开发用 Node.js 和 jsdom，成品用户不需要安装它们。

完整重建及打包入口是 `desktop/package-portable.py`。它核对发行组件哈希、运行完整测试、打包并在便携 Electron 内再次执行密码与镜像冒烟检查。具体命令见 `desktop/PACKAGING-CRYPTO.md`。

题型范围、密钥及样本要求、预算和未实现高级变体见 `使用说明.md`、`题型覆盖与限制.md`；对应许可见 `THIRD_PARTY_NOTICES.md`。
