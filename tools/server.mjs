import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { publicManifest, reviewedFile } from "./files.mjs";

/** Only reviewed demo assets are served; papers, recordings and arbitrary files are excluded. */
export async function createDemoServer(root) {
  const allowed = new Set((await publicManifest(root)).webFiles);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  return createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const path = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const name =
        path === "/" || path === "/demo/"
          ? "demo/index.html"
          : path.replace(/^\//, "");
      if (!allowed.has(name)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(await reviewedFile(root, name));
      response.writeHead(200, {
        "Content-Type": mime[extname(name)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}
