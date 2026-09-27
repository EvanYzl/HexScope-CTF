# 密码模块第三方组件

| 组件 | 固定版本 | 使用范围 | 许可 |
|---|---|---|---|
| [CryptoJS](https://github.com/brix/crypto-js) | 4.2.0 | AES/DES/3DES/Blowfish 原始分组实现 | MIT |
| [noble-hashes](https://github.com/paulmillr/noble-hashes) | 1.8.0 | 摘要、HMAC、PBKDF2 | MIT |
| [noble-ciphers](https://github.com/paulmillr/noble-ciphers) | 1.3.0 | Salsa20、ChaCha20、AEAD | MIT |
| [noble-curves](https://github.com/paulmillr/noble-curves) | 1.9.7 | Ed25519/X25519、P-256、secp256k1 | MIT |
| [twofish-ts](https://github.com/gliese1337/twofish) | 1.0.2 | Twofish 原始分组实现 | MIT（上游 package.json 声明） |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | 压缩格式解析，来自 HexScope 基础版本 | MIT |

许可证原文与声明保存在 `vendor` 和 `vendor/licenses`。Twofish 包未附独立 LICENSE 文件；保留其发布元数据和 MIT 标准文本，并明确标注来源，没有伪造上游许可证文件。

`vendor/SOURCES.json` 包含下载来源、npm 完整性字段、版本及 bundle 哈希；`vendor-build/package-lock.json` 固定构建依赖。CryptoJS 使用其已发布的兼容实现，没有将其当作新设计的密码系统。Blowfish 字节密钥适配在本模块中实现，第三方分发文件本身未被修改。

esbuild 0.25.5 与 jsdom 26.1.0 仅供开发构建/测试，最终使用不需要安装它们。新写的兼容算法代码位于 `src`；公开标准和算法参数的来源见《题型覆盖与限制》。

当前正式构建的 EXIF 和压缩库来自主源码 `vendor/`，不使用旧 4.0 HTML 底座。本目录保留的 `vendor/hexscope-core.js`、`vendor/hexscope-ctf.js`、`vendor/fflate.js` 是独立模块来源快照，实际密码 Worker 使用主项目当前 `src/core.js`、`src/ctf.js`、`vendor/fflate.js`。

便携包密码许可与来源位于 `licenses-and-libraries/crypto/vendor/`，源码对应 `HexScope-source/crypto/vendor/`。Electron、The Sleuth Kit、hash-wasm 和相关库的原有许可与对应材料继续保留，详见便携包根目录 `THIRD_PARTY_NOTICES.md`。
