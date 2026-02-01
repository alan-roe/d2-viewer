import { D2, type Diagram, type CompileResponse } from "@terrastruct/d2";
import { extractLayers, type LayerNode } from "./layer-utils.js";

export type { LayerNode };

export interface D2CompileResult {
  diagram: Diagram;
  renderOptions: CompileResponse["renderOptions"];
  layers: LayerNode[];
}

let d2Instance: D2 | null = null;

async function getD2(): Promise<D2> {
  if (!d2Instance) {
    d2Instance = new D2();
  }
  return d2Instance;
}

export interface CompileOptions {
  layout?: "dagre" | "elk";
  sketch?: boolean;
  themeID?: number;
}

/**
 * Compile D2 source code (simple, no imports)
 */
export async function compile(
  source: string,
  options?: CompileOptions
): Promise<D2CompileResult>;

/**
 * Compile D2 with filesystem for imports
 */
export async function compile(
  fs: Record<string, string>,
  inputPath: string,
  options?: CompileOptions
): Promise<D2CompileResult>;

export async function compile(
  sourceOrFs: string | Record<string, string>,
  inputPathOrOptions?: string | CompileOptions,
  maybeOptions?: CompileOptions
): Promise<D2CompileResult> {
  const d2 = await getD2();

  let result;

  if (typeof sourceOrFs === "string") {
    // Simple compile: compile(source, options?)
    const opts = (inputPathOrOptions as CompileOptions) ?? {};
    result = await d2.compile(sourceOrFs, {
      options: {
        layout: opts.layout ?? "dagre",
        sketch: opts.sketch ?? false,
        themeID: opts.themeID ?? 0,
      },
    });
  } else {
    // Filesystem compile: compile(fs, inputPath, options?)
    const fs = sourceOrFs;
    const inputPath = inputPathOrOptions as string;
    const options = maybeOptions ?? {};

    result = await d2.compile({
      fs,
      inputPath,
      options: {
        layout: options.layout ?? "dagre",
        sketch: options.sketch ?? false,
        themeID: options.themeID ?? 0,
      },
    });
  }

  return {
    diagram: result.diagram,
    renderOptions: result.renderOptions,
    layers: extractLayers(result.diagram),
  };
}

export interface RenderOptions {
  target?: string;
  sketch?: boolean;
  themeID?: number;
  center?: boolean;
  pad?: number;
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
 * Render a compiled diagram to SVG
 */
export async function render(
  diagram: Diagram,
  baseOptions: CompileResponse["renderOptions"],
  options: RenderOptions = {}
): Promise<string> {
  const d2 = await getD2();

  const svg = await d2.render(diagram, {
    ...baseOptions,
    target: options.target ?? "",
    sketch: options.sketch ?? baseOptions.sketch,
    themeID: options.themeID ?? baseOptions.themeID,
    center: options.center ?? true,
    pad: options.pad ?? 20,
    noXMLTag: true,
  });

  return ensureSvgDimensions(svg);
}

/**
 * Compile and render in one step
 */
export async function compileAndRender(
  source: string,
  options: CompileOptions & RenderOptions = {}
): Promise<{ svg: string; result: D2CompileResult }> {
  const result = await compile(source, options);
  const svg = await render(result.diagram, result.renderOptions, options);
  return { svg, result };
}
