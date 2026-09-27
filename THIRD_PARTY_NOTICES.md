# HexScope CTF 4.1 — 第三方组件

本程序离线内置以下开源组件，各项分发或构建封装变更在下文及对应模块声明中列明。各组件许可原文随源码及便携包保留。

| 组件 | 版本 | 用途 | 许可 / 源码 |
|---|---|---|---|
| exifr | 7.1.3 | EXIF、GPS、XMP、IPTC、ICC 元数据读取 | MIT；[项目源码](https://github.com/MikeKovarik/exifr)，许可 `HexScope-source/vendor/exifr.LICENSE.txt` |
| fflate | 0.8.3 | Zlib / GZIP / Deflate、原始 PNG 数据解压 | MIT；[项目源码](https://github.com/101arrowz/fflate)，许可 `HexScope-source/vendor/fflate.LICENSE.txt` |
| Electron | 44.4.5 | Windows 便携版自带桌面运行组件 | MIT 及其第三方许可；[源码与发行版](https://github.com/electron/electron/releases/tag/v44.4.5)，便携包中的 `LICENSE` 与 `LICENSES.chromium.html` |

元数据及压缩库来自对应版本的 npm 发行内容。源码目录 `vendor` 提供完整 UMD 分发文件与许可证。Windows 包的 `licenses-and-libraries` 提供相同副本。Electron 使用官方 win32-x64 构建，并核对官方发布的 SHA-256 清单。

jsdom 26.1.0（MIT）仅用于开发阶段的内存 DOM 测试，不是程序运行依赖，不打入成品页面和桌面程序。

GIF 和 Graphics Interchange Format 为 CompuServe 的格式及服务标记。

## 取证镜像组件（4.0）

The Sleuth Kit 4.15.0 来自 [官方 Windows 发行包](https://github.com/sleuthkit/sleuthkit/releases/tag/sleuthkit-4.15.0)，上游 ZIP SHA-256 已核对为 `c2ebab8105b893d97bd8ce35b88e01985e2a106efc97f03adf95840a631b20ce`。

内置该发行版匹配的 **libewf 20130416**（LGPL-3.0-or-later）、libvhdi 20240303、libvmdk 20240529（两者库代码为 LGPL-3.0-or-later）和 zlib 1.2.11（zlib 许可）。TSK 包含 CPL、IPL 及其他按文件列明的许可。源代码归档、许可证原文和来源记录在 `HexScope-source/desktop/engines`；便携版的相同内容位于 `resources/app/engines`。

TSK 的七个被调用 EXE（img_stat、img_cat、mmls、fls、icat、fsstat、istat）增加了 UTF-8 `activeCodePage` 进程清单，机器代码未修改，DLL 未修改。补丁源码为 `HexScope-source/desktop/enable-utf8.ps1`。此变更遵循 [Microsoft 的进程 UTF-8 清单说明](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page)，要求 Windows 10 1903 或更新版本。`ENGINE_INFO.json` 同时保留原发行包哈希和修改后各执行文件哈希，不能把修改后的 EXE 称为与原发行版逐字节相同。

程序只调用固定组件并以文件为输入，不需要用户安装命令行环境。不附带或调用 Perl、Java、OpenSSL 或其他未使用的 TSK 工具。所需微软运行库从同一官方 TSK 发行包附带，适用其原有条款；Windows 系统库由目标操作系统提供。

HexScope 没有对这些 LGPL 组件施加替换、调试或重新链接限制。所有第三方组件仍归各自作者所有，使用不代表其作者认可本程序。


## 多算法哈希组件（4.1）

[hash-wasm 4.12.0](https://github.com/Daninet/hash-wasm) 提供 SHA3、BLAKE2 与 SM3 的增量 WebAssembly 实现，解决桌面运行组件未提供这些算法的问题。JS 包为 MIT 许可，所嵌入 C 实现的许可见原发行包的 `src/` 文件头。原始 UMD 分发文件未改代码，仅将扩展名改为 `.cjs`。

原始 npm 发行包、许可证与 SHA-512 / SHA-256 来源记录随 `HexScope-source/desktop/vendor/` 提供；便携版对应位置是 `resources/app/vendor/`。所有 WASM 字节已经内置，运行时不下载任何资源。

固定 VHD 格式依据 [Microsoft VHD 规格](https://www.microsoft.com/en-us/download/details.aspx?id=23850)；挂载通过 [Windows Mount-DiskImage](https://learn.microsoft.com/en-us/powershell/module/storage/mount-diskimage) 的 ReadOnly 选项与系统 Storage 模块。VHD 写入与挂载辅助代码由本项目提供，没有引入额外内核驱动。

## 密码分析组件（4.1 集成版）

新增 CryptoJS 4.2.0、noble-hashes 1.8.0、noble-ciphers 1.3.0、noble-curves 1.9.7 和 twofish-ts 1.0.2；全部本地内嵌，运行时不从 CDN 下载。原始许可、版本、完整性和构建锁文件均保留。详见同目录《密码模块第三方许可.md》、便携目录 `licenses-and-libraries/crypto/vendor/` 与源码 `HexScope-source/crypto/vendor/`。

Twofish 上游包以 package.json 声明 MIT，未附独立 LICENSE；随包保留发布元数据和明确说明的 MIT 文本。正常构建使用已有 bundle；在同一锁文件下已重复构建并得到一致 SHA-256。esbuild 和 jsdom 仅用于开发。

## 文件预览组件（4.1 增强）

新增 Mammoth 1.13.0、SheetJS CE 0.20.3、PDF.js 6.3.289 及其 core-js 3.50.0、字体、CMap 和 WASM。详细许可、重建变化与按文件声明见 **文件预览第三方许可.md**；源码对应 `HexScope-source/preview/THIRD_PARTY_NOTICES.md` 与 `preview/vendor`，便携包对应 `licenses-and-libraries/preview`。所有运行依赖内置。开发用 @napi-rs/canvas 1.0.9 不作为用户运行依赖。

## 图文与扩展组件（4.1 r8）

图文组件包括 Tesseract.js / core 7.0.0、固定提交的 tessdata_fast、zxing-wasm 3.1.4、bwip-js 4.11.4、pdf-lib 1.17.1、docx 9.7.2 与 Noto CJK 字体；原始许可证、依赖版本、字体来源、73 个模型的逐文件 SHA-256 在源码 `HexScope-source/desktop/vendor/vision`，便携版位置为 `resources/app/vendor/vision`。构建与许可概览见源码 `vision/THIRD_PARTY_NOTICES.md`。

扩展工坊使用 CyberChef 11.5.0（Apache-2.0，Crown Copyright），保留上游资源、各模块第三方许可与 npm 源码发行归档；来源、提交和 SHA-256 见 `HexScope-source/extensions/UPSTREAM.json`，便携目录为 `resources/app/extensions`。HexScope 仅在独立入口加入离线 CSP 与数据桥接。详见同目录 `THIRD_PARTY_NOTICES.md`。未使用未获再分发许可的软件二进制。
