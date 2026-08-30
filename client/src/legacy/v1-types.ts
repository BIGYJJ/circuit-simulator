import { z } from "zod";

const port = z.enum(["top", "bottom"]);

export const circuitDocumentV1Schema = z
  .object({
    version: z.literal(1),
    name: z.string(),
    updatedAt: z.string(),
    components: z.array(
      z
        .object({
          id: z.string(),
          kind: z.enum(["voltageSource", "resistor", "capacitor", "switch", "diode", "led", "probe", "ground"]),
          label: z.string(),
          x: z.number().finite(),
          y: z.number().finite(),
          value: z.number().finite().optional(),
          initialValue: z.number().finite().optional(),
          closed: z.boolean().optional(),
          switchMode: z.enum(["charge", "hold", "discharge"]).optional(),
          forwardVoltage: z.number().finite().optional(),
          targetComponentId: z.string().optional(),
        })
        .strict()
    ),
    wires: z.array(
      z
        .object({
          id: z.string(),
          from: z.object({ componentId: z.string(), port }).strict(),
          to: z.object({ componentId: z.string(), port }).strict(),
        })
        .strict()
    ),
  })
  .strict();

export type CircuitDocumentV1 = z.infer<typeof circuitDocumentV1Schema>;
