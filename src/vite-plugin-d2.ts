import type { Plugin, ViteDevServer } from "vite";
import { watch } from "chokidar";
import { resolve, dirname, join } from "path";
import { readFile } from "fs/promises";
import { WebSocketServer, WebSocket } from "ws";

interface D2WatchPluginOptions {
  /** Directory to watch for .d2 files (default: process.cwd()) */
  watchDir?: string;
  /** WebSocket port (default: 24680) */
  wsPort?: number;
}

/**
 * Parse D2 imports from source content.
 * Matches patterns like:
 *   ...@path/to/file     (spread import)
 *   name: @path/to/file  (named import)
 */
function parseD2Imports(content: string): string[] {
  const imports: string[] = [];
  // Match ...@path or : @path patterns
  const importRegex = /(?:\.\.\.@|:\s*@)([\w\-\/\.]+)/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    let importPath = match[1];
    // Add .d2 extension if not present
    if (!importPath.endsWith(".d2")) {
      importPath += ".d2";
    }
    imports.push(importPath);
  }
  return imports;
}

/**
 * Load a D2 file and all its imports recursively.
 * Returns a filesystem object mapping paths to content.
 */
async function loadFileWithImports(
  watchDir: string,
  entryPath: string
): Promise<Record<string, string>> {
  const fs: Record<string, string> = {};
  const queue: Array<{ path: string; alternatives?: string[] }> = [
    { path: entryPath },
  ];
  const seen = new Set<string>();
  const failed = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift()!;

    // Normalize path (handle relative paths within imports)
    const normalizedPath = item.path.startsWith("/")
      ? item.path.slice(1)
      : item.path;

    if (seen.has(normalizedPath) || failed.has(normalizedPath)) continue;

    try {
      const absolutePath = resolve(watchDir, normalizedPath);
      const content = await readFile(absolutePath, "utf-8");
      fs[normalizedPath] = content;
      seen.add(normalizedPath);

      // Parse and queue imports
      const imports = parseD2Imports(content);
      for (const importPath of imports) {
        // Resolve relative to the current file's directory
        const currentDir = dirname(normalizedPath);
        const resolvedImport =
          currentDir === "."
            ? importPath
            : join(currentDir, importPath).replace(/\\/g, "/");

        // Try resolved path first, with root-relative as fallback
        if (!seen.has(resolvedImport) && !failed.has(resolvedImport)) {
          const alternatives =
            resolvedImport !== importPath ? [importPath] : undefined;
          queue.push({ path: resolvedImport, alternatives });
        }
      }
    } catch (err) {
      failed.add(normalizedPath);
      // Try alternative paths before warning
      if (item.alternatives && item.alternatives.length > 0) {
        const [next, ...rest] = item.alternatives;
        queue.unshift({ path: next, alternatives: rest });
      }
    }
  }

  return fs;
}

export function d2WatchPlugin(options: D2WatchPluginOptions = {}): Plugin {
  const watchDir = options.watchDir ?? process.cwd();
  const wsPort = options.wsPort ?? 24680;

  let wss: WebSocketServer | null = null;
  let clients: Set<WebSocket> = new Set();

  function broadcast(data: object) {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  return {
    name: "vite-plugin-d2",

    configureServer(server: ViteDevServer) {
      // Start WebSocket server
      wss = new WebSocketServer({ port: wsPort });
      console.log(`[d2-viewer] WebSocket server listening on ws://localhost:${wsPort}`);
      console.log(`[d2-viewer] Watching directory: ${watchDir}`);

      wss.on("connection", (ws) => {
        clients.add(ws);
        console.log(`[d2-viewer] Client connected (${clients.size} total)`);

        ws.on("close", () => {
          clients.delete(ws);
          console.log(`[d2-viewer] Client disconnected (${clients.size} total)`);
        });

        ws.on("message", async (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "load") {
              // Client requesting a specific file - load with all imports
              const fs = await loadFileWithImports(watchDir, msg.path);
              const importCount = Object.keys(fs).length - 1;
              if (importCount > 0) {
                console.log(`[d2-viewer] Loaded ${msg.path} with ${importCount} imports`);
              }
              ws.send(
                JSON.stringify({
                  type: "file",
                  path: msg.path,
                  fs,
                  content: fs[msg.path] ?? "",
                })
              );
            } else if (msg.type === "list") {
              // Client requesting file list - handled by glob on client
            }
          } catch (err) {
            console.error("[d2-viewer] Error handling message:", err);
          }
        });
      });

      // Watch for .d2 file changes
      const watcher = watch("**/*.d2", {
        cwd: watchDir,
        ignoreInitial: true,
        ignored: ["**/node_modules/**"],
      });

      watcher.on("change", async (path) => {
        console.log(`[d2-viewer] File changed: ${path}`);
        try {
          // Notify clients that a file changed - they will reload their entry file
          broadcast({
            type: "change",
            path,
          });
        } catch (err) {
          console.error(`[d2-viewer] Error handling file change ${path}:`, err);
        }
      });

      watcher.on("add", (path) => {
        console.log(`[d2-viewer] File added: ${path}`);
        broadcast({ type: "add", path });
      });

      watcher.on("unlink", (path) => {
        console.log(`[d2-viewer] File removed: ${path}`);
        broadcast({ type: "remove", path });
      });

      // Serve .d2 files as static assets
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.endsWith(".d2")) {
          try {
            const filePath = resolve(watchDir, req.url.slice(1));
            const content = await readFile(filePath, "utf-8");
            res.setHeader("Content-Type", "text/plain");
            res.end(content);
          } catch {
            next();
          }
        } else {
          next();
        }
      });
    },

    closeBundle() {
      if (wss) {
        wss.close();
      }
    },
  };
}
