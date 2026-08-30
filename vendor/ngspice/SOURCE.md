# ngspice WASM provenance

- Upstream project: ngspice
- Upstream homepage: https://ngspice.sourceforge.io/
- Immutable tag: `ngspice-46`
- Upstream source archive: https://sourceforge.net/projects/ngspice/files/ngspice-46/
- Adopted prebuilt: `@o.z/ngspice-wasm@0.0.0` (`https://github.com/z-wasm/ngspice-wasm`)
- npm pack integrity: sha512-KEhzzO+jIMGiR[...] recorded locally as package shasum `d8b356f3dcb8365348fc3d72663a8fad9b93aedd`
- Prebuilt is a single-thread Emscripten build of official `ngspice-46` with 256 MiB memory
- WASM bytes were extracted from the official package `findWasmBinary()` base64 payload so `ngspice.wasm` can be hash-verified independently of the glue module
- Runtime loading: same-origin `wasmBinary` only. No CDN `locateFile`.
