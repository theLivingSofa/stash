---
version: 1
slug: "src-app-app-page-tsx"
primary_target: "src/app/(app)/page.tsx"
related_targets: ["src/components/IdeaCard.tsx","src/components/Feed.tsx","src/app/globals.css"]
---

# Surface brief: Stash app (feed, card back, Explore, Library, Settings, login)

Scope: the whole reading app; primary surface is the feed of idea cards (mode: read; Explore/Library/Settings operate inside the same world). Audience: owner and invited friends on an iPhone home-screen app, in bed at night and on short breaks in daylight. Constraint: 60 fps, no per-frame blur on scrolling cards, WCAG AA, reduced motion respected. Chosen direction: Lightbox & Slide (assigned by the roll, user-confirmed). Memorable moment: the light behind each slide takes the topic's colour; the flip turns the mount over.

## Direction contract
THESIS: Every idea is a 35mm slide on backlit glass; Stash refuses the gradient quote-card feed and the cream-and-serif book app.
OWN-WORLD: Night is a warm darkroom (#14110F) lit from behind in the topic's film-dye colour; day is an opal lightbox (#EEF3EF) with white mounts. Cards are frosted slide mounts: translucent frame, inner highlight, printed band with literal labels (topic, slide number, source). Grease-pencil red ticks mark seen, yellow tape flags mark saved. Archivo (variable width) for mount labels and UI; Source Serif 4 for reading. Floating glass dock and top pills.
STORY: The reader sees one idea under light, reads it in a calm window, turns the mount over for the deep dive, keeps what matters on their own slide sheet (Library).
FIRST VIEWPORT: Wordmark top-left, streak pill top-right; one mount fills the screen between them and a floating glass dock; band on top, idea in the window centre, actions and "Turn over" on the mount's foot.
FORM: Lightbox & Slide, position 3 of my ordered list; seed:dfb2facce05db1bf
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
