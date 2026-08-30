declare module "../ngspice.mjs" {
  const createNgspiceModule: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  export default createNgspiceModule;
}
