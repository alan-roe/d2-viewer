import { createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import {
  compile,
  render,
  type D2CompileResult,
  type LayerNode,
} from "./d2-service";
import "./App.css";

interface FileLoadResult {
  path: string;
  fs: Record<string, string>;
  content: string;
}

// WebSocket connection for live reload
function useD2FileWatcher(
  onFileLoad: (result: FileLoadResult) => void,
  onFileChange: (changedPath: string) => void
) {
  const [connected, setConnected] = createSignal(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  function connect() {
    ws = new WebSocket("ws://localhost:24680");

    ws.onopen = () => {
      setConnected(true);
      console.log("[d2-viewer] Connected to file watcher");
    };

    ws.onclose = () => {
      setConnected(false);
      console.log("[d2-viewer] Disconnected, reconnecting in 2s...");
      reconnectTimer = window.setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "file") {
          // File loaded with full filesystem
          onFileLoad({
            path: msg.path,
            fs: msg.fs ?? { [msg.path]: msg.content },
            content: msg.content,
          });
        } else if (msg.type === "change") {
          // A file changed - notify to reload
          onFileChange(msg.path);
        }
      } catch (err) {
        console.error("[d2-viewer] Error parsing message:", err);
      }
    };
  }

  onMount(() => {
    connect();
  });

  onCleanup(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  });

  function requestFile(path: string) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "load", path }));
    }
  }

  return { connected, requestFile };
}

// Layer tree component
function LayerTree(props: {
  nodes: LayerNode[];
  currentPath: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const depth = () => props.depth ?? 0;

  return (
    <ul class="layer-tree" style={{ "padding-left": depth() > 0 ? "1rem" : "0" }}>
      <For each={props.nodes}>
        {(node) => (
          <li>
            <button
              class="layer-item"
              classList={{
                active: props.currentPath === node.path,
                layer: node.type === "layer",
                scenario: node.type === "scenario",
                step: node.type === "step",
              }}
              onClick={() => props.onSelect(node.path)}
              title={node.title ? `${node.name}: ${node.title}` : node.name}
            >
              <span class="layer-icon">
                {node.type === "layer" ? "◇" : node.type === "scenario" ? "◈" : "▸"}
              </span>
              {node.title ?? node.name}
            </button>
            <Show when={node.children.length > 0}>
              <LayerTree
                nodes={node.children}
                currentPath={props.currentPath}
                onSelect={props.onSelect}
                depth={depth() + 1}
              />
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

function App() {
  const [filePath, setFilePath] = createSignal<string>("");
  const [fileSystem, setFileSystem] = createSignal<Record<string, string>>({});
  const [svg, setSvg] = createSignal<string>("");
  const [compileResult, setCompileResult] = createSignal<D2CompileResult | null>(null);
  const [currentTarget, setCurrentTarget] = createSignal<string>("");
  const [error, setError] = createSignal<string>("");
  const [loading, setLoading] = createSignal(false);
  const [layout, setLayout] = createSignal<"dagre" | "elk">("dagre");
  const [sketch, setSketch] = createSignal(false);
  const [importCount, setImportCount] = createSignal(0);

  // Zoom/pan state
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = createSignal(false);
  const [panStart, setPanStart] = createSignal({ x: 0, y: 0 });
  const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 }); // Track mouse for scroll-while-panning

  // Get file path from URL hash
  onMount(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const [path, target] = hash.split("@");
      setFilePath(path);
      if (target) setCurrentTarget(target);
    }
  });

  // Update URL when target changes
  createEffect(() => {
    const path = filePath();
    const target = currentTarget();
    if (path) {
      window.location.hash = target ? `${path}@${target}` : path;
    }
  });

  // Handle file changes from watcher
  const { connected, requestFile } = useD2FileWatcher(
    // onFileLoad - file loaded with full filesystem
    (result) => {
      if (result.path === filePath() || !filePath()) {
        setFilePath(result.path);
        setFileSystem(result.fs);
        setImportCount(Object.keys(result.fs).length - 1);
      }
    },
    // onFileChange - a file changed, reload if it might affect us
    (changedPath) => {
      const path = filePath();
      const fs = fileSystem();
      // Reload if the changed file is our entry or one of its imports
      if (path && (changedPath === path || fs[changedPath])) {
        requestFile(path);
      }
    }
  );

  // Load file when path changes
  createEffect(() => {
    const path = filePath();
    if (path && connected()) {
      requestFile(path);
    }
  });

  // Compile when filesystem changes
  createEffect(async () => {
    const fs = fileSystem();
    const path = filePath();
    if (!path || Object.keys(fs).length === 0) return;

    setLoading(true);
    setError("");

    try {
      const result = await compile(fs, path, {
        layout: layout(),
        sketch: sketch(),
      });
      setCompileResult(result);

      // Render with current target
      const svgOutput = await render(result.diagram, result.renderOptions, {
        target: currentTarget(),
        sketch: sketch(),
      });
      setSvg(svgOutput);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSvg("");
    } finally {
      setLoading(false);
    }
  });

  // Re-render when target changes (sketch is baked into renderOptions from compile)
  createEffect(async () => {
    const result = compileResult();
    const target = currentTarget();
    if (!result) return;

    try {
      const svgOutput = await render(result.diagram, result.renderOptions, {
        target,
      });
      setSvg(svgOutput);
      setError("");
      // Reset zoom/pan when navigating to different target
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  });

  function handleSelectLayer(path: string) {
    setCurrentTarget(path);
  }

  function handleGoToRoot() {
    setCurrentTarget("");
  }

  // Manual file input
  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.value) {
      setFilePath(input.value);
    }
  }

  // Intercept SVG link clicks for layer navigation
  function handleDiagramClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');

    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    // Check if this is a layer/scenario/step link
    // D2 generates: "layers.name", "scenarios.name", "steps.name", or "root.layers.name"
    const layerPattern = /^(root\.)?(layers|scenarios|steps)\./;

    if (layerPattern.test(href)) {
      e.preventDefault();
      e.stopPropagation();

      // Extract the target path (remove "root." prefix if present)
      const targetPath = href.replace(/^root\./, '');
      setCurrentTarget(targetPath);
    }
    // External links (http://, https://) pass through normally
  }

  // Scroll/zoom handlers
  function handleWheel(e: WheelEvent) {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey || isPanning()) {
      // Ctrl/Cmd + scroll = zoom, or scroll while panning = zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(zoom() * delta, 0.1), 10);

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = rect.width / 2;   // Container center X
      const cy = rect.height / 2;  // Container center Y

      // Cursor position relative to container top-left
      const cursorX = isPanning() ? mousePos().x - rect.left : e.clientX - rect.left;
      const cursorY = isPanning() ? mousePos().y - rect.top : e.clientY - rect.top;

      // Convert to position relative to container CENTER (matches diagram anchor)
      const cursorFromCenterX = cursorX - cx;
      const cursorFromCenterY = cursorY - cy;

      const zoomRatio = newZoom / zoom();
      // Adjust pan to keep point under cursor stable during zoom
      const newPan = {
        x: cursorFromCenterX - (cursorFromCenterX - pan().x) * zoomRatio,
        y: cursorFromCenterY - (cursorFromCenterY - pan().y) * zoomRatio,
      };
      setPan(newPan);
      setZoom(newZoom);

      // When zooming while panning, update panStart to maintain grab invariant
      if (isPanning()) {
        setPanStart({ x: mousePos().x - newPan.x, y: mousePos().y - newPan.y });
      }
    } else {
      // Pan: use deltaX for horizontal, deltaY for vertical
      // Note: macOS swaps axes when Shift is held, so this handles both cases
      setPan(p => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    }
  }

  // Pan handlers
  function handleMouseDown(e: MouseEvent) {
    // Only pan with left button, not on links
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('a')) return;

    setIsPanning(true);
    setPanStart({ x: e.clientX - pan().x, y: e.clientY - pan().y });
  }

  function handleMouseMove(e: MouseEvent) {
    // Always track mouse position for scroll-while-panning zoom
    setMousePos({ x: e.clientX, y: e.clientY });

    if (!isPanning()) return;

    setPan({
      x: e.clientX - panStart().x,
      y: e.clientY - panStart().y,
    });
  }

  function handleMouseUp() {
    setIsPanning(false);
  }

  function handleResetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div class="app">
      {/* Header */}
      <header class="header">
        <h1>D2 Viewer</h1>
        <div class="header-controls">
          <input
            type="text"
            class="file-input"
            placeholder="Enter .d2 file path..."
            value={filePath()}
            onInput={handleFileInput}
          />
          <select
            class="layout-select"
            value={layout()}
            onChange={(e) => setLayout(e.target.value as "dagre" | "elk")}
          >
            <option value="dagre">Dagre</option>
            <option value="elk">ELK</option>
          </select>
          <label class="sketch-toggle">
            <input
              type="checkbox"
              checked={sketch()}
              onChange={(e) => setSketch(e.target.checked)}
            />
            Sketch
          </label>
          <Show when={importCount() > 0}>
            <span class="import-count" title="Resolved imports">
              {importCount()} imports
            </span>
          </Show>
          <span class="connection-status" classList={{ connected: connected() }}>
            {connected() ? "●" : "○"}
          </span>
        </div>
      </header>

      <div class="main">
        {/* Sidebar */}
        <aside class="sidebar">
          <div class="sidebar-header">
            <h2>Navigation</h2>
            <button class="root-btn" onClick={handleGoToRoot} disabled={!currentTarget()}>
              ← Root
            </button>
          </div>

          <Show when={currentTarget()}>
            <div class="current-path">
              <span class="path-label">Current:</span>
              <code>{currentTarget()}</code>
            </div>
          </Show>

          <Show when={compileResult()}>
            <LayerTree
              nodes={compileResult()!.layers}
              currentPath={currentTarget()}
              onSelect={handleSelectLayer}
            />
          </Show>

          <Show when={!compileResult() && !loading() && !error()}>
            <p class="sidebar-empty">
              Enter a .d2 file path or wait for file changes...
            </p>
          </Show>
        </aside>

        {/* Main content */}
        <main class="content">
          <Show when={loading()}>
            <div class="loading">Compiling...</div>
          </Show>

          <Show when={error()}>
            <div class="error">
              <h3>Error</h3>
              <pre>{error()}</pre>
            </div>
          </Show>

          <Show when={svg() && !loading()}>
            <div
              class="diagram-container"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              classList={{ panning: isPanning() }}
            >
              <div
                class="diagram"
                style={{
                  transform: `translate(calc(-50% + ${pan().x}px), calc(-50% + ${pan().y}px)) scale(${zoom()})`,
                  "transform-origin": "center",
                }}
                innerHTML={svg()}
                onClick={handleDiagramClick}
              />
            </div>
            <div class="zoom-controls">
              <button onClick={() => setZoom(z => Math.min(z * 1.2, 10))}>+</button>
              <span class="zoom-level">{Math.round(zoom() * 100)}%</span>
              <button onClick={() => setZoom(z => Math.max(z / 1.2, 0.1))}>−</button>
              <button onClick={handleResetView} class="reset-btn">Reset</button>
            </div>
          </Show>

          <Show when={!svg() && !loading() && !error()}>
            <div class="empty">
              <p>No diagram loaded</p>
              <p class="hint">
                Enter a path like <code>diagrams/index.d2</code> or run with a
                watch directory
              </p>
            </div>
          </Show>
        </main>
      </div>
    </div>
  );
}

export default App;
