#!/usr/bin/env bun
/**
 * Pre-render D2 diagrams to embeddable HTML
 *
 * Usage: bun run scripts/prerender.ts input.d2 [-o output.html] [--title "Title"]
 *
 * This script:
 * 1. Builds a filesystem map by resolving @imports recursively
 * 2. Compiles the D2 diagram using @terrastruct/d2 to get full layer tree
 * 3. Renders each target (root + all layers) to SVG
 * 4. Generates an HTML file with embedded SVGs
 */

import { parseArgs } from "util";
import { readFile, writeFile, access } from "fs/promises";
import { basename, dirname, resolve, join, relative } from "path";
import { D2, type Diagram, type CompileResponse } from "@terrastruct/d2";
import { extractLayers, flattenTargets, type LayerNode } from "../src/layer-utils.js";

// Types
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
 * Build filesystem map for d2.compile by resolving @imports recursively
 */
async function buildFileSystem(entryPath: string): Promise<Record<string, string>> {
  const fs: Record<string, string> = {};
  const baseDir = dirname(entryPath);
  const processed = new Set<string>();

  async function processFile(filePath: string): Promise<void> {
    // Normalize and check if already processed
    const normalizedPath = resolve(filePath);
    if (processed.has(normalizedPath)) return;
    processed.add(normalizedPath);

    // Read file content
    let content: string;
    try {
      content = await readFile(normalizedPath, "utf-8");
    } catch (error) {
      console.warn(`Warning: Could not read ${normalizedPath}`);
      return;
    }

    // Store with path relative to baseDir
    const relativePath = relative(baseDir, normalizedPath);
    fs[relativePath] = content;

    // Find @imports and process them recursively
    // Patterns:
    // - "...@path/to/file" (spread import)
    // - "@path/to/file" (direct import)
    // - "name: @path/to/file" (layer import)
    const importPattern = /(?:\.\.\.)?@([^\s\n;{}]+)/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const importRef = match[1];

      // Resolve the import path relative to the current file's directory
      const currentDir = dirname(normalizedPath);
      let importPath = join(currentDir, importRef);

      // Add .d2 extension if not present
      if (!importPath.endsWith(".d2")) {
        importPath += ".d2";
      }

      // Check if file exists
      try {
        await access(importPath);
        await processFile(importPath);
      } catch {
        // Try without .d2 extension (in case it's already a full path)
        const altPath = join(currentDir, importRef);
        try {
          await access(altPath);
          await processFile(altPath);
        } catch {
          console.warn(`Warning: Import not found: ${importRef} (from ${relativePath})`);
        }
      }
    }
  }

  await processFile(entryPath);
  return fs;
}

/**
 * Ensure SVG has explicit width/height attributes based on viewBox.
 * D2 generates outer SVGs with only viewBox, which collapse to 0x0
 * when CSS uses width: auto; height: auto.
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

  const [, , w, h] = viewBoxMatch[1].split(/\s+/);
  if (!w || !h) return svg;

  // Insert width and height attributes
  const newOpenTag = `${openTag} width="${w}" height="${h}"`;
  return svg.replace(fullMatch, newOpenTag + closeAngle);
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

  // Build filesystem map with all imports resolved
  console.log("Building filesystem (resolving imports)...");
  const fsMap = await buildFileSystem(inputPath);
  const fileCount = Object.keys(fsMap).length;
  console.log(`Found ${fileCount} file${fileCount === 1 ? "" : "s"}`);

  // Initialize D2
  const d2 = new D2();

  // Compile diagram with full filesystem
  console.log("Compiling D2 diagram...");
  const inputBasename = basename(inputPath);

  let compileResult: { diagram: Diagram; renderOptions: CompileResponse["renderOptions"] };
  try {
    compileResult = await d2.compile({
      fs: fsMap,
      inputPath: inputBasename,
      options: {
        layout: (values.layout as "dagre" | "elk") ?? "dagre",
        sketch: values.sketch ?? false,
        themeID: parseInt(values.theme ?? "0", 10),
      },
    });
  } catch (error) {
    console.error("Compilation error:", error);
    throw error;
  }

  // Extract layer tree from compiled diagram
  const layers = extractLayers(compileResult.diagram);
  const targets = flattenTargets(layers);
  console.log(`Found ${targets.length} layer${targets.length === 1 ? "" : "s"}: ${targets.join(", ") || "(root only)"}`);

  // Render all targets
  const svgs: Record<string, string> = {};
  const renderOptions = {
    ...compileResult.renderOptions,
    center: true,
    pad: 20,
    noXMLTag: true,
  };

  // Render root
  console.log("Rendering root...");
  try {
    const rootSvg = await d2.render(compileResult.diagram, {
      ...renderOptions,
      target: "",
    });
    svgs[""] = ensureSvgDimensions(rootSvg);
  } catch (error) {
    console.error("Error rendering root:", error);
    throw error;
  }

  // Render each layer target
  for (const target of targets) {
    console.log(`Rendering ${target}...`);
    try {
      const svg = await d2.render(compileResult.diagram, {
        ...renderOptions,
        target,
      });
      svgs[target] = ensureSvgDimensions(svg);
    } catch (error) {
      console.error(`Error rendering ${target}:`, error);
      throw error;
    }
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
