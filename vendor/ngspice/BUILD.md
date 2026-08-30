# Build record

- Candidate: `@o.z/ngspice-wasm@0.0.0` built 2026-05-27
- ngspice tag: `ngspice-46`
- Emscripten: package `Command` header reports `Build Wed May 27 17:18:36 UTC 2026`
- Threading: single-thread, pthreads disabled, no COOP/COEP
- Memory: INITIAL_MEMORY 256MB, no WASM threads
- Glue flags observed: MODULARIZE=1, EXPORT_ES6=1, SINGLE_FILE wasm embedding later extracted
- Shared-library callbacks (`ngSpice_Init`) are not exported; Task 1 therefore pins `binary-rawfile`
- Batch ABI: one `_main(["-b","-r", raw, cir])` per freshly instantiated module. A second `_main` on the same instance hits ngspice `jump to zero`, so the Worker reinstantiates the module for each run
- Rebuild: follow https://github.com/z-wasm/ngspice-wasm `builder.sh` with `NGSPICE_TAG=ngspice-46`, `INITIAL_MEMORY=256MB`, then extract WASM with the same base64 split used here
- Patches: none beyond the adopted prebuilt
