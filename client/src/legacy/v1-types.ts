/** FLUXLAB legacy boundary: permissive imported v1 JSON is converted only into an unsaved preview candidate. */
export interface LegacyV1Component { id: string; kind: string; refdes?: string; value?: number; dcV?: number; x?: number; y?: number; rotation?: number; }
export interface LegacyV1CircuitDocument { schemaVersion: 1; title?: string; components: LegacyV1Component[]; wires?: Array<{ id: string; from: { componentId: string; pin?: string }; to: { componentId: string; pin?: string } }>; }
