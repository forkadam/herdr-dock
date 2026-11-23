# beautiful-mermaid's limits — design

Date: 2026-11-23. Follows [Mermaid arrows without spaces](2026-11-23-mermaid-arrow-ids-design.md) and
[the Render follow-ups](2026-11-23-render-followups-design.md). Adam asked for beautiful-mermaid's remaining limits to
be fixed; he picked extending the bundle-time patch (`patchMermaidIds`, every rewritten line guarded: exactly once, or
the build fails) over copying the library's source in, and skipping the drawing of long links at a greater length.

## What gets fixed (all proven in a scratch bundle)

| Mermaid | Today | After |
| --- | --- | --- |
| `classDef my-cls …`, `class B my-cls` | the line draws a stray node `classDef`; no colour | the class applies |
| `A-. text -.->B` | only A | dotted arrow |
| `A-. text .-B` | not parsed | dotted line, no head |
| `A ~~~ B`, `A~~~B` | not parsed | laid out, not drawn (nor its label) |
| `A --o B`, `A --x B`, `A o--o B`, `A x--x B`, `==o`, `-.-o` | not parsed | circle / cross heads, in the link's style |

## How (rewrites of beautiful-mermaid's `dist/index.js`)

- Class names: the `classDef` and `class` patterns read a name as `[\w-]+` instead of `\w+`.
- Text arrows: the closing operator also accepts `-.->` (tried before `-.-`) and `.-`; the style lookup normalises
  them to `.->` and `-.-`.
- Arrows: the pattern accepts `o` / `x` at the start (`([<ox])?`), `-{2,}[ox]`, `-\.+-[ox]`, `={2,}[ox]` and `~{3,}`.
  The style lookup returns `invisible` for `~~~` and reads a head `o` / `x` as `>` for the line's style.
- The kind of head rides on the edge's existing `hasArrowStart` / `hasArrowEnd` (`true`, `"circle"`, `"cross"`), which
  the layout already copies to the drawn edge; the renderer picks `arrowhead`, `circlehead` or `crosshead` (and
  `-start`) from it, and the marker definitions gain the circle and cross markers (in the arrow's colour; links
  restyled by `linkStyle` keep plain circle / cross markers).
- An `invisible` edge draws no line and no label; the layout still places its nodes as if linked.

## Behaviour change to know

As in Mermaid, an unspaced open link before a node whose name starts with `o` or `x` reads as a circle / cross link:
`A---other` is `A` circle-linked to `ther`. Mermaid's docs say to add a space; `A --- other` is unchanged, and
`A-->o1` stays an arrow to `o1`.

## Not

Drawing a long link longer (ELK has no per-edge length; it would need hidden nodes in the layout). Text arrows with
`o` / `x` heads (`A-- text --o B`).

`LOOK_VERSION` 8 → 9. Branch `mermaid-limits` from `main` (6353b8a); deploy from `~/Dev/Workspace/herdr-dock` after the
merge.
