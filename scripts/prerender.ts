#!/usr/bin/env bun
/**
 * Pre-render D2 diagrams to embeddable HTML
 *
 * Usage: bun run scripts/prerender.ts input.d2 [-o output.html] [--title "Title"]
 *
 * This script:
 * 1. Parses the D2 file to extract layer/scenario/step structure
 * 2. Renders each target to SVG using the d2 CLI
 * 3. Generates an HTML file with embedded SVGs
 */

import { parseArgs } from "util";
import { readFile, writeFile } from "fs/promises";
import { basename, dirname, resolve } from "path";
import { execSync } from "child_process";

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
  svgs: Record<string, string>;
}

// Parse command line arguments
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string", short: "o" },
    title: { type: "string", short: "t" },
    layout: { type: "string", short: "l", default: "dagre" },
    theme: { type: "string", default: "0" },
    sketch: { type: "boolean", short: "s", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Usage: bun run scripts/prerender.ts <input.d2> [options]

Options:
  -o, --output <file>   Output HTML file (default: input.html)
  -t, --title <title>   Diagram title (default: filename)
  -l, --layout <engine> Layout engine: dagre, elk (default: dagre)
  --theme <id>          Theme ID (default: 0)
  -s, --sketch          Enable sketch mode
  -h, --help            Show this help

Example:
  bun run scripts/prerender.ts diagram.d2 -o viewer.html --title "System Architecture"
`);
  process.exit(0);
}

const inputPath = resolve(positionals[0]);
const outputPath = values.output
  ? resolve(values.output)
  : inputPath.replace(/\.d2$/, ".html");
const title = values.title ?? basename(inputPath, ".d2");

/**
 * Parse D2 source to extract layer/scenario/step declarations
 * This is a simple regex-based parser that finds top-level declarations
 */
function extractTargetsFromSource(source: string): string[] {
  const targets: string[] = [];

  // Match layers: { ... }, scenarios: { ... }, steps: { ... }
  // This is a simplified parser - it finds top-level declarations
  const blockPattern = /(layers|scenarios|steps)\s*:\s*\{/g;

  let match;
  while ((match = blockPattern.exec(source)) !== null) {
    const type = match[1] as "layers" | "scenarios" | "steps";
    const startIdx = match.index + match[0].length;

    // Find matching closing brace
    let depth = 1;
    let idx = startIdx;
    while (depth > 0 && idx < source.length) {
      if (source[idx] === "{") depth++;
      else if (source[idx] === "}") depth--;
      idx++;
    }

    const blockContent = source.slice(startIdx, idx - 1);

    // Extract names from the block - look for "name: {" patterns
    const namePattern = /^\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*\{/gm;
    let nameMatch;
    while ((nameMatch = namePattern.exec(blockContent)) !== null) {
      const name = nameMatch[1];
      targets.push(`${type}.${name}`);
    }
  }

  return targets;
}

/**
 * Build layer tree from flat target list
 */
function buildLayerTree(targets: string[]): LayerNode[] {
  const nodes: LayerNode[] = [];

  for (const target of targets) {
    const parts = target.split(".");
    if (parts.length < 2) continue;

    const type = parts[0] as "layers" | "scenarios" | "steps";
    const name = parts[1];

    // Map type string to LayerNode type
    const nodeType: LayerNode["type"] =
      type === "layers" ? "layer" : type === "scenarios" ? "scenario" : "step";

    nodes.push({
      name,
      path: target,
      type: nodeType,
      children: [], // Could recurse for nested layers, but keeping simple for now
    });
  }

  return nodes;
}

/**
 * Render a specific target using d2 CLI
 */
function renderTarget(
  inputPath: string,
  target: string,
  options: { layout: string; theme: string; sketch: boolean }
): string {
  const args = [
    inputPath,
    "-",
    `--layout=${options.layout}`,
    `--theme=${options.theme}`,
    "--no-xml-tag",
    "--center",
    `--target=${target || ""}`,
  ];

  if (options.sketch) {
    args.push("--sketch");
  }

  try {
    const svg = execSync(`d2 ${args.join(" ")}`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diagrams
      cwd: dirname(inputPath), // Run from input directory for relative imports
    });
    return svg;
  } catch (error) {
    console.error(`Error rendering target "${target || "root"}":`, error);
    throw error;
  }
}

/**
 * Generate HTML with embedded diagram data
 */
function generateHtml(data: D2DiagramData): string {
  const escapedData = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.title)}</title>
  <style>body { background: #1a1a1a; margin: 0; }</style>
</head>
<body>
  <div id="app"></div>
  <script>
    window.D2_DIAGRAM = ${escapedData};
  </script>
  <script src="https://alan-roe.github.io/d2-viewer/d2-viewer.js"></script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Main
async function main() {
  console.log(`Reading ${inputPath}...`);
  const source = await readFile(inputPath, "utf-8");

  // Extract targets from source
  console.log("Parsing D2 source...");
  const targets = extractTargetsFromSource(source);
  console.log(`Found ${targets.length} targets: ${targets.join(", ") || "(root only)"}`);

  // Build layer tree
  const layers = buildLayerTree(targets);

  // Render all targets
  const svgs: Record<string, string> = {};
  const renderOptions = {
    layout: values.layout!,
    theme: values.theme!,
    sketch: values.sketch!,
  };

  // Render root
  console.log("Rendering root...");
  svgs[""] = renderTarget(inputPath, "", renderOptions);

  // Render each target
  for (const target of targets) {
    console.log(`Rendering ${target}...`);
    svgs[target] = renderTarget(inputPath, target, renderOptions);
  }

  // Generate HTML
  const data: D2DiagramData = {
    title,
    layers,
    svgs,
  };

  console.log(`Writing ${outputPath}...`);
  await writeFile(outputPath, generateHtml(data));

  // Report sizes
  const htmlSize = Buffer.byteLength(generateHtml(data), "utf-8");
  console.log(`\nDone! Generated ${outputPath}`);
  console.log(`  SVGs: ${Object.keys(svgs).length}`);
  console.log(`  Size: ${(htmlSize / 1024).toFixed(1)} KB`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
