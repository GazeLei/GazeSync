import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "./server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(
  process.env.GAZESYNC_PORT ?? process.env.GAZE_TOOLS_PORT ?? 5194,
);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("GAZESYNC_PORT must be a valid port");
const server = await createDemoServer(root);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `GazeSync simulation: http://127.0.0.1:${server.address().port}/demo/`,
  ),
);
