# D2 Viewer

Web-based D2 diagram viewer with layer navigation, zoom/pan, and embeddable HTML generation.

## Components

| Component | Description |
|-----------|-------------|
| `src/` | SolidJS viewer app (~20KB bundled) |
| `scripts/prerender.ts` | CLI to generate standalone HTML files |
| Deployed JS | `https://alan-roe.github.io/d2-viewer/d2-viewer.js` |

## Prerender Script

Generate standalone HTML files with pre-rendered SVGs that work offline from `file://` URLs:

```bash
bun run prerender diagram.d2 -o output.html --title "My Diagram"
```

**Options:**
- `-o, --output <file>` - Output HTML file (default: input.html)
- `-t, --title <title>` - Diagram title (default: filename)
- `-l, --layout <engine>` - Layout engine: dagre, elk (default: dagre)
- `--theme <id>` - Theme ID (default: 0)
- `-s, --sketch` - Enable sketch mode

**Features:**
- Multi-file support (resolves `@imports` recursively)
- Full nested layer discovery
- Interactive viewer with zoom/pan
- URL hash navigation: `file.html#layers.detail`

## Development

```bash
bun install
bun run dev          # Development server
bun run build        # Build viewer
bun run build:embed  # Build embeddable JS
bun run typecheck    # Type check
```

## Related

- **Skill:** `~/.claude/skills/d2-diagrams/` or `~/workspace/skills/d2-diagrams/`
- **Skill ZIP:** Generate with `cd ~/.claude/skills && zip -r d2-diagrams.zip d2-diagrams`

## Claude Desktop Integration

The D2 skill can be imported into Claude Desktop:

1. Generate ZIP: `cd ~/.claude/skills && zip -r ~/Desktop/d2-diagrams.zip d2-diagrams`
2. Open Claude Desktop → Settings → Capabilities
3. Upload `d2-diagrams.zip`
4. Toggle the skill on

The skill provides D2 syntax patterns and references the prerender script for HTML generation.
