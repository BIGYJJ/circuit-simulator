import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVersionedStaticServer } from "../tests/browser/support/versioned-static-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "public");
const server = await startVersionedStaticServer({
  root,
  host: "127.0.0.1",
  port: Number(process.env.FLUXLAB_LOCAL_RC_PORT ?? 4173),
  allowImmutableCache: true,
});
process.stdout.write(`${server.url}\n`);
