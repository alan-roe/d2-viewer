/**
 * Shared utilities for extracting layer trees from D2 diagrams
 * Used by both d2-service.ts (browser) and prerender.ts (build tool)
 */

import type { Diagram } from "@terrastruct/d2";

export interface LayerNode {
  name: string;
  path: string;
  type: "layer" | "scenario" | "step";
  title?: string;
  children: LayerNode[];
}

/**
 * Extract a clean title from a markdown label.
 * Returns the first heading (# ...) or first non-empty line.
 */
export function extractMarkdownTitle(label: string): string {
  // Remove the |md prefix if present
  const content = label.replace(/^\|md\s*\n?/, "");

  // Look for first markdown heading
  const headingMatch = content.match(/^#+\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  // Fall back to first non-empty line
  const firstLine = content.split("\n").find((line) => line.trim());
  return firstLine?.trim() ?? label;
}

/**
 * Extract title from a diagram by looking for a shape with id "title".
 * Skips d2-config shapes which should not be treated as titles.
 */
export function extractTitle(diagram: Diagram): string | undefined {
  // Find shape with id "title" or nested ".title", but not d2-config
  const titleShape = diagram.shapes?.find((s) => {
    // Skip d2-config shapes entirely
    if (s.id === "d2-config" || s.id.startsWith("d2-config.")) {
      return false;
    }
    // Match "title" or nested titles like "container.title"
    return s.id === "title" || s.id.endsWith(".title");
  });

  if (!titleShape) {
    return undefined;
  }

  if ("label" in titleShape) {
    const label = (titleShape as { label: string }).label;

    // Handle markdown labels - extract just the heading
    if (label.startsWith("|md") || label.includes("#")) {
      return extractMarkdownTitle(label);
    }

    return label;
  }
  return undefined;
}

/**
 * Extract the layer tree from a compiled diagram
 */
export function extractLayers(
  diagram: Diagram,
  parentPath: string = ""
): LayerNode[] {
  const nodes: LayerNode[] = [];

  // Process layers
  for (const layer of diagram.layers ?? []) {
    if (!layer) continue;
    const path = parentPath ? `${parentPath}.${layer.name}` : `layers.${layer.name}`;
    const title = extractTitle(layer);
    nodes.push({
      name: layer.name,
      path,
      type: "layer",
      ...(title && { title }),
      children: extractLayers(layer, path),
    });
  }

  // Process scenarios
  for (const scenario of diagram.scenarios ?? []) {
    if (!scenario) continue;
    const path = parentPath
      ? `${parentPath}.${scenario.name}`
      : `scenarios.${scenario.name}`;
    const title = extractTitle(scenario);
    nodes.push({
      name: scenario.name,
      path,
      type: "scenario",
      ...(title && { title }),
      children: extractLayers(scenario, path),
    });
  }

  // Process steps
  for (const step of diagram.steps ?? []) {
    if (!step) continue;
    const path = parentPath ? `${parentPath}.${step.name}` : `steps.${step.name}`;
    const title = extractTitle(step);
    nodes.push({
      name: step.name,
      path,
      type: "step",
      ...(title && { title }),
      children: extractLayers(step, path),
    });
  }

  return nodes;
}

/**
 * Flatten layer tree into list of target paths for rendering
 */
export function flattenTargets(layers: LayerNode[]): string[] {
  const targets: string[] = [];

  function traverse(nodes: LayerNode[]) {
    for (const node of nodes) {
      targets.push(node.path);
      traverse(node.children);
    }
  }

  traverse(layers);
  return targets;
}
