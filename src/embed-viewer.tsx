/**
 * Static embed viewer for pre-rendered D2 diagrams
 *
 * Displays pre-rendered SVGs with zoom/pan and layer navigation.
 * No compilation - just display of pre-rendered content.
 *
 * Usage: Set window.D2_DIAGRAM before loading this script:
 *   window.D2_DIAGRAM = {
 *     title: "My Diagram",
 *     layers: [...],  // LayerNode tree
 *     svgs: { "": "<svg>...", "layers.auth": "<svg>...", ... }
 *   }
 */
import { render } from "solid-js/web";
import { createSignal, createEffect, For, Show, onMount } from "solid-js";

// CSS is inlined for the embed bundle
const styles = `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg-primary: #1a1a1a;
  --bg-secondary: #242424;
  --bg-tertiary: #2d2d2d;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --accent: #646cff;
  --accent-hover: #535bf2;
  --border: #3d3d3d;
  --error: #f87171;
  --layer-color: #60a5fa;
  --scenario-color: #a78bfa;
  --step-color: #34d399;
}

html, body, #app {
  height: 100%;
  width: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.embed-app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Header - minimal for embed */
.embed-header {
  display: flex;
  align-items: center;
  padding: 0.5rem 1rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.embed-header h1 {
  font-size: 1rem;
  font-weight: 600;
  white-space: nowrap;
}

/* Main layout */
.embed-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Sidebar */
.embed-sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.sidebar-header h2 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.root-btn {
  padding: 0.2rem 0.4rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s;
}

.root-btn:hover:not(:disabled) {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.root-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.current-path {
  padding: 0.375rem 0.75rem;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  font-size: 0.7rem;
}

.current-path .path-label {
  color: var(--text-secondary);
  margin-right: 0.375rem;
}

.current-path code {
  color: var(--accent);
  font-family: "SF Mono", Monaco, monospace;
}

/* Layer tree */
.layer-tree {
  list-style: none;
  overflow-y: auto;
  padding: 0.375rem;
}

.layer-tree li {
  margin: 0;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.375rem 0.5rem;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}

.layer-item:hover {
  background: var(--bg-tertiary);
}

.layer-item.active {
  background: var(--accent);
  color: white;
}

.layer-item.layer .layer-icon { color: var(--layer-color); }
.layer-item.scenario .layer-icon { color: var(--scenario-color); }
.layer-item.step .layer-icon { color: var(--step-color); }
.layer-item.active .layer-icon { color: white; }

/* Content area */
.embed-content {
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
  position: relative;
}

/* Diagram container */
.diagram-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  cursor: grab;
}

.diagram-container.panning {
  cursor: grabbing;
}

.diagram {
  position: absolute;
  top: 50%;
  left: 50%;
}

.diagram > svg {
  /* Dimensions set from viewBox by ensureSvgDimensions() */
  max-width: none;
  max-height: none;
}

/* Zoom controls */
.zoom-controls {
  position: absolute;
  bottom: 0.75rem;
  right: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.375rem;
}

.zoom-controls button {
  width: 1.75rem;
  height: 1.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zoom-controls button:hover {
  background: var(--accent);
  border-color: var(--accent);
}

.zoom-level {
  min-width: 2.5rem;
  text-align: center;
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.reset-btn {
  width: auto !important;
  padding: 0 0.5rem;
  font-size: 0.7rem !important;
}

.error-display, .empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.error-display {
  max-width: 500px;
  padding: 1rem;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid var(--error);
  border-radius: 8px;
}

.error-display h3 {
  color: var(--error);
  margin-bottom: 0.5rem;
}

.error-display pre {
  font-family: "SF Mono", Monaco, monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}

.empty {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

/* Collapsed sidebar state */
.embed-sidebar.collapsed {
  width: 0;
  min-width: 0;
  border-right: none;
}

.toggle-sidebar {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  padding: 0.375rem 0.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  z-index: 10;
}

.toggle-sidebar:hover {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
`;

// Types
interface LayerNode {
  name: string;
  path: string;
  type: "layer" | "scenario" | "step";
  title?: string;
  children: LayerNode[];
}

interface D2DiagramData {
  title: string;
  layers: LayerNode[];
  svgs: Record<string, string>; // path → SVG content ("" for root)
}

// Declare the global D2_DIAGRAM variable
declare global {
  interface Window {
    D2_DIAGRAM?: D2DiagramData;
  }
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
    <ul class="layer-tree" style={{ "padding-left": depth() > 0 ? "0.75rem" : "0" }}>
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

/**
 * Ensure SVG has explicit width/height attributes based on viewBox.
 * SVGs with only viewBox collapse to 0x0 with CSS width/height: auto.
 */
function ensureSvgDimensions(svg: string): string {
  // Match the opening <svg tag
  const svgTagMatch = svg.match(/^(<svg\s+[^>]*)(>)/);
  if (!svgTagMatch) return svg;

  const [fullMatch, openTag, closeAngle] = svgTagMatch;

  // Check if it already has width attribute
  if (/\swidth\s*=/.test(openTag)) return svg;

  // Extract viewBox dimensions
  const viewBoxMatch = openTag.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (!viewBoxMatch) return svg;

  const parts = viewBoxMatch[1].split(/\s+/);
  if (parts.length < 4) return svg;

  const [, , w, h] = parts;
  if (!w || !h) return svg;

  // Insert width and height attributes
  const newOpenTag = `${openTag} width="${w}" height="${h}"`;
  return svg.replace(fullMatch, newOpenTag + closeAngle);
}

function EmbedViewer() {
  const [currentTarget, setCurrentTarget] = createSignal<string>("");
  const [error, setError] = createSignal<string>("");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);

  // Zoom/pan state
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = createSignal(false);
  const [panStart, setPanStart] = createSignal({ x: 0, y: 0 });
  const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 });

  // Get diagram data
  const diagramData = () => window.D2_DIAGRAM;

  // Get current SVG based on target (with dimensions ensured)
  const currentSvg = () => {
    const data = diagramData();
    if (!data) return "";
    const svg = data.svgs[currentTarget()] ?? "";
    return svg ? ensureSvgDimensions(svg) : "";
  };

  // Get initial target from URL hash
  onMount(() => {
    if (!diagramData()) {
      setError("No diagram data found. Set window.D2_DIAGRAM before loading this script.");
      return;
    }

    const hash = window.location.hash.slice(1);
    if (hash && diagramData()?.svgs[hash]) {
      setCurrentTarget(hash);
    }
  });

  // Update URL when target changes
  createEffect(() => {
    const target = currentTarget();
    window.location.hash = target || "";
  });

  // Reset zoom/pan when target changes
  createEffect(() => {
    currentTarget(); // track dependency
    setZoom(1);
    setPan({ x: 0, y: 0 });
  });

  function handleSelectLayer(path: string) {
    setCurrentTarget(path);
  }

  function handleGoToRoot() {
    setCurrentTarget("");
  }

  // SVG link click handler for layer navigation
  function handleDiagramClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    const layerPattern = /^(root\.)?(layers|scenarios|steps)\./;
    if (layerPattern.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      const targetPath = href.replace(/^root\./, "");
      // Only navigate if we have that SVG
      if (diagramData()?.svgs[targetPath]) {
        setCurrentTarget(targetPath);
      }
    }
  }

  // Zoom/pan handlers
  function handleWheel(e: WheelEvent) {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey || isPanning()) {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(zoom() * delta, 0.1), 10);

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      const cursorX = isPanning() ? mousePos().x - rect.left : e.clientX - rect.left;
      const cursorY = isPanning() ? mousePos().y - rect.top : e.clientY - rect.top;

      const cursorFromCenterX = cursorX - cx;
      const cursorFromCenterY = cursorY - cy;

      const zoomRatio = newZoom / zoom();
      const newPan = {
        x: cursorFromCenterX - (cursorFromCenterX - pan().x) * zoomRatio,
        y: cursorFromCenterY - (cursorFromCenterY - pan().y) * zoomRatio,
      };
      setPan(newPan);
      setZoom(newZoom);

      if (isPanning()) {
        setPanStart({ x: mousePos().x - newPan.x, y: mousePos().y - newPan.y });
      }
    } else {
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a")) return;

    setIsPanning(true);
    setPanStart({ x: e.clientX - pan().x, y: e.clientY - pan().y });
  }

  function handleMouseMove(e: MouseEvent) {
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

  const hasLayers = () => (diagramData()?.layers.length ?? 0) > 0;
  const title = () => diagramData()?.title ?? "D2 Diagram";

  return (
    <div class="embed-app">
      {/* Header */}
      <header class="embed-header">
        <h1>{title()}</h1>
      </header>

      <div class="embed-main">
        {/* Sidebar - only show if there are layers */}
        <Show when={hasLayers()}>
          <aside class="embed-sidebar" classList={{ collapsed: !sidebarVisible() }}>
            <Show when={sidebarVisible()}>
              <div class="sidebar-header">
                <h2>Navigation</h2>
                <button
                  class="root-btn"
                  onClick={handleGoToRoot}
                  disabled={!currentTarget()}
                >
                  ← Root
                </button>
              </div>

              <Show when={currentTarget()}>
                <div class="current-path">
                  <span class="path-label">Current:</span>
                  <code>{currentTarget()}</code>
                </div>
              </Show>

              <LayerTree
                nodes={diagramData()?.layers ?? []}
                currentPath={currentTarget()}
                onSelect={handleSelectLayer}
              />
            </Show>
          </aside>
        </Show>

        {/* Main content */}
        <main class="embed-content">
          {/* Toggle sidebar button */}
          <Show when={hasLayers()}>
            <button
              class="toggle-sidebar"
              onClick={() => setSidebarVisible((v) => !v)}
            >
              {sidebarVisible() ? "◀" : "▶"}
            </button>
          </Show>

          <Show when={error()}>
            <div class="error-display">
              <h3>Error</h3>
              <pre>{error()}</pre>
            </div>
          </Show>

          <Show when={currentSvg() && !error()}>
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
                innerHTML={currentSvg()}
                onClick={handleDiagramClick}
              />
            </div>
            <div class="zoom-controls">
              <button onClick={() => setZoom((z) => Math.min(z * 1.2, 10))}>+</button>
              <span class="zoom-level">{Math.round(zoom() * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.max(z / 1.2, 0.1))}>−</button>
              <button onClick={handleResetView} class="reset-btn">
                Reset
              </button>
            </div>
          </Show>

          <Show when={!currentSvg() && !error()}>
            <div class="empty">No diagram to display</div>
          </Show>
        </main>
      </div>
    </div>
  );
}

// Inject styles
function injectStyles() {
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
}

// Initialize
function init() {
  injectStyles();

  const root = document.getElementById("app");
  if (!root) {
    console.error("[d2-viewer] No #app element found");
    return;
  }

  render(() => <EmbedViewer />, root);
}

// Auto-initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
