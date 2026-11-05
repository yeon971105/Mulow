# Trusted static React build toolchain

Exact official npm packages, copied without modification or install scripts:

- react 19.3.1 (MIT)
- react-dom 19.3.1 (MIT)
- scheduler 0.28.0 (MIT)
- esbuild-wasm 0.25.12 (MIT)

`MANIFEST.json` records official registry tarball URLs, npm SHA-512 integrity,
and SHA-256/byte count for every package file. Each package retains its license.
The package lock records exact resolution. No native platform binary is bundled.

This is a build-only toolchain, not an authorization to execute generated source.
Mulo's restricted compiler supplies its own fixed resolver and build options;
project package scripts, plugins and dependency installation are not used.
No network fetch is required to use these vendored packages.

The official WebAssembly Node API launches the installed `node` from PATH to
run its trusted JS/WASM loader. Mulo requires Node 24.8 or newer. Linux Node
24.22.1 passed actual JSX/CSS compilation and denied-import smoke checks.
macOS and Windows compatibility is intended by the upstream cross-platform
WASM package but has NOT been verified on those operating systems here.

Keep this directory outside browser-served static paths. Package files must
travel together with their relative paths intact. Compile success alone proves
neither application behavior nor backend/Docker compatibility.
