# Portfolio — environment art & matte painting

A static site with plain HTML, CSS and a 6 KB vanilla JS file. A Node build script turns two JSON files into static pages and encodes responsive images. It has no framework and no client-side rendering, and every page works with JavaScript off.

```
npm install          # installs sharp (image encoding), the only dependency
npm run placeholders # makes stand-in images for any file named in the JSON that is missing
npm run build        # writes dist/
npm run serve        # previews dist/ at http://localhost:8080
```

Deploy by uploading `dist/` to any static host (Netlify, Cloudflare Pages, GitHub Pages, S3). All links are relative, so it also works from a sub-path. Only `404.html` assumes the site is at the domain root.

## Folder structure

```
content/
  projects.json      every project; array order = order in the work table
  site.json          name, tagline, email, links, reel, bio, credits, software
images/              source masters (JPG/PNG/TIFF, any size), one folder per project slug
  site/reel-poster.jpg
  rings-of-power/final-01.jpg, bd-01-plate.jpg, …
src/
  styles.css         all styles (inlined into each page at build time)
  site.js            reel click-to-load, hover preview, breakdown wipe
  fonts/             self-hosted Archivo 400/600 and IBM Plex Mono 400 (woff2)
scripts/
  build.mjs          validates JSON, encodes images, writes HTML
  placeholders.mjs   generates stand-in frames (never overwrites real files)
  serve.mjs          tiny local static server
dist/                build output (git-ignored)
  index.html, about/, work/<slug>/, img/, assets/
```

## Adding a project

1. Make a folder `images/<slug>/` (lowercase, digits and dashes, e.g. `images/foundation/`).
2. Put the master frames in it at full resolution. The build never upscales, and it caps output at 2400 px wide.
   - Final frames: any aspect ratio. They are shown uncropped and full-bleed.
   - Breakdown layers: **all layers of one project must have the same pixel dimensions**, because they are stacked for the wipe.
3. Add an entry to `content/projects.json` where you want it to appear in the table:

```json
{
  "slug": "foundation",
  "title": "Foundation",
  "code": "FDN_S02",
  "show": "Series, S02 — Apple TV+",
  "studio": "Studio name",
  "year": 2023,
  "role": "Senior Matte Painter",
  "tools": ["Photoshop", "Nuke", "Houdini"],
  "stills": [
    { "src": "foundation/final-01.jpg", "alt": "Describe what is in the frame." }
  ],
  "breakdownLayers": [
    { "label": "Plate",             "src": "foundation/bd-01-plate.jpg",  "alt": "…" },
    { "label": "Layout / blockout", "src": "foundation/bd-02-layout.jpg", "alt": "…" },
    { "label": "Render",            "src": "foundation/bd-03-render.jpg", "alt": "…" },
    { "label": "Matte paint",       "src": "foundation/bd-04-matte.jpg",  "alt": "…" },
    { "label": "Final comp",        "src": "foundation/bd-05-final.jpg",  "alt": "…" }
  ],
  "description": "Three to six plain sentences about what you did."
}
```

4. Run `npm run build`. Only new or changed images are encoded (roughly 1–2 s per image); everything else is cached in `dist/img/`.

Field notes:

- The key frame is the still marked `"featured": true`, or `stills[0]` if none is. It's used for the hero slide, the project's cards and tiles, and `og:image`. Choose your strongest frame for each project; one great frame is enough.
- `breakdownLayers` can have any number of layers (2 or more) and any labels. `Wistman's Wood` uses 4 layers with its own labels. With fewer than 2 layers, or no `breakdownLayers` at all, the Breakdown section is left out and the page still reads as complete (see `Bessie`).
- `code` is optional (a mono tag such as `ROP_S02`). `stills[].caption` is optional too; without one, the caption shows the frame size.
- `description` can be a string or an array of paragraphs. Text starting with `TODO:` renders with a visible TODO tag.
- The build stops with a clear message if a required field, an `alt`, or an image file is missing.

## Placeholders to replace

Everything marked `TODO` in the JSON, plus:

- `site.json`: `name`, `email`, `imdb`, `linkedin`, `reel.id` (currently a public Vimeo demo video; set `provider` to `youtube` or `vimeo`), `bio`, `availability`, and `url` (set it to enable absolute `og:image` tags).
- `projects.json`: every `studio` is `Studio TBC`, and the roles, tools and descriptions are stand-ins. Years and distributors are the real release details of each production. Check them against your own credits.
- `images/`: all frames are generated stand-ins with "PLACEHOLDER" burned in. Replace a file by overwriting it with the same name, or point `src` at a new file. `npm run placeholders` never overwrites existing files.

## How the site is laid out

- **Look**: dark theme, Figtree, rounded image cards, yellow for primary buttons and active filters. The colors are tokens at the top of `src/styles.css`.
- **Home**: a hero carousel. The first slide shows your name and a Watch reel button over the reel poster; the next slides show the projects listed in `site.json` `heroProjects`, or the first three if that's not set. It never moves by itself: viewers use the arrows, dots, swipe or arrow keys. Only slide 1's image loads with the page; the others load after it or when they're about to be shown. If `availability` is filled in (not starting with `TODO`), it appears under your name with a green dot. Next is **Plate to final**: one card per project with 2+ breakdown layers, showing the first layer and the last split down the middle, linking to that project's breakdown. Then **All work**: up to 4 across, with filter pills made from each project's `category` and a grid/list toggle. The browser remembers which view the viewer picked.
- **Project page**: category tag, title, show and role; studio, year and tools sit in the Details panel. Then the frames (one frame shows up to 960 px wide, two sit side by side, three or more go 3 across), which open full size in a viewer with arrow-key and prev/next navigation. Then the breakdown wipe, with the layer list on the left, "What I did" beside a Details panel, and a **More work** row.
- **Reel**: plays in a pop-up player; the Vimeo/YouTube player loads only when someone presses Watch reel. Without JavaScript the button links to the video page.
- **Breakdown wipe**: drag with mouse or touch. On the divider, arrow keys move it and Page Up / Page Down change layers. Without JavaScript the layers show as a plain sequence.
- **Images**: 320/640/1024/1600/2400 px in AVIF, WebP and JPG via `<picture>`, with `width`/`height` always set (CLS 0).
- **Lighthouse** (mobile, local server): index 99/100/100/100; project page and About 100 across Performance, Accessibility, Best Practices and SEO.

Extra fields: `category` on each project (`Series`, `Film`, `Personal`, or anything else; each becomes a filter pill) and optional `heroProjects` (an array of slugs) in `site.json`.
