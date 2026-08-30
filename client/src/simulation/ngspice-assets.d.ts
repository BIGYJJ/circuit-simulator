declare module "../../../vendor/ngspice/ngspice.mjs" {
  const createNgspiceModule: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  export default createNgspiceModule;
}

declare module "../../../vendor/ngspice/ngspice.wasm?url" {
  const url: string;
  export default url;
}

declare module "../../../vendor/ngspice/QUALIFIED_VECTORS.json?raw" {
  const text: string;
  export default text;
}

declare module "../../../vendor/ngspice/VERSION?raw" {
  const text: string;
  export default text;
}
