# Native component source and provenance

These archives are provided with the unmodified DLLs distributed in the official Sleuth Kit 4.15.0 Windows package. `SOURCES.json` records locations and SHA-256 values. Each component retains its own license.

- Sleuth Kit 4.15.0: official release source; CPL/IPL and file-specific licenses in `tsk/licenses` and the source archive.
- libewf 20130416: original upstream release imported by the Kali package repository; LGPL-3.0-or-later. The archive includes the upstream MSVC solution and supporting libyal code. Binary provenance remains the official TSK release.
- libvhdi 20240303: upstream commit `f594ed4d6744743cab0bfb581a4174857a1a75f2`.
- libvmdk 20240529: upstream commit `71b8943adbe10d70531f10544eea864888d23d68`.
- zlib 1.2.11: https://github.com/madler/zlib/tree/v1.2.11 ; permissive zlib license, complete copyright notice in `tsk/licenses/zlib-README.txt`.

For libyal repository snapshots, follow the bundled upstream build instructions, including synchronization of supporting libraries. Their library code uses LGPL-3.0-or-later; command-line tools in those upstream archives use GPL-3.0-or-later and are not invoked or shipped as native binaries by HexScope.

The seven TSK CLI EXEs are modified only by adding a UTF-8 activeCodePage manifest using the provided `enable-utf8.ps1` script. DLLs remain replaceable and separate from the application. HexScope does not restrict inspection, debugging or replacement of these components.

Microsoft Visual C++/UCRT redistributable DLLs are copied from the same official TSK distribution and remain governed by Microsoft's applicable redistribution terms. Windows system DLLs are supplied by the supported operating system. OpenSSL, the Java bindings, Perl tools and unused TSK executables are excluded from the release packages.
