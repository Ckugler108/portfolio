# Portfolio — environment art & matte painting

A static site with plain HTML, CSS and a small vanilla JS file, plus an editor at `/admin` for changing content without touching code. A Node build script turns the content files into static pages and encodes responsive images. Every page works with JavaScript off.

## Editing content (the easy way)

Open **`https://<your-site>/admin`** once the site is live on Netlify.

1. **Sign in.** Choose **Sign In Using Access Token**. The dialog links to GitHub's token page with the right permission pre-selected (Contents: read and write on `Ckugler108/portfolio`). Create the token, paste it in, and your browser remembers it. It's a password, so don't share it.
2. **Projects** lists every project. Open one, or press **New Project**, and fill in the form:
   - **Final frames**: upload your best frames (full resolution, JPG or PNG, at least 2400 px wide if you have it). Tick **Use as the main frame** on your strongest one; it's used on the home page and the project's cards.
   - **Breakdown for this frame** (optional, inside each frame): upload a **Before**, usually the plate. The frame itself is the after, and the project page shows a before/after slider for it. Add **Other passes** such as Layout or CG render if you want visitors to be able to swap them in. Every breakdown image must be exactly the same size in pixels as its frame.
   - **Motion loop** (optional, inside each frame): a short silent clip of the shot. It plays on loop on the project page. If the frame also has a breakdown, a **Loop** button switches between the slider and the clip. Export H.264 MP4, 1920 px wide, 6–10 seconds, under 8 MB, with no audio. A clip that starts and ends on the same frame loops without a jump.
   - **Brief** (optional): three short lines (Problem, Approach, Result) shown above "What I did".
   - **How it was made** (optional, recommended for Generative work): rough shares such as Generated 40, Paint-over 35, Comp 25. They show as one bar.
   - **What I did**: 3–6 plain sentences. Delete the `TODO:` placeholder text.
   - **Order**: lower numbers appear first on the home page.
3. **Site settings** holds your name, one-line description, email, links, the reel link (paste the Vimeo or YouTube URL), the poster frame, an optional **Banner loop** (a short silent MP4 that plays behind your name on the home page), a **Currently** line for the About page, your bio, credits and software.
4. Press **Save**. That commits the change to GitHub, and Netlify rebuilds the site in 1–2 minutes.

If a build fails (for example, breakdown images of different sizes), the live site keeps the last working version, and Netlify's deploy log names the file and the problem.

## Running it locally

```
npm install          # installs sharp (image encoding) and the editor
npm run placeholders # makes stand-in images for any referenced file that is missing
npm run build        # writes dist/ (including dist/admin)
npm run serve        # previews dist/ at http://localhost:8080
```

Netlify builds automatically from `netlify.toml`. All site links are relative; only `404.html` assumes the site is at the domain root.

## Folder structure

```
admin/
  index.html, config.yml   the /admin editor (Sveltia CMS) and its form definitions
content/
  projects/<slug>.json     one file per project (what the editor writes)
  site.json                name, tagline, email, links, reel, bio, credits, software
images/                    source images, any size (the editor uploads here)
src/
  styles.css               all styles (inlined into each page at build time)
  site.js                  carousel, rows, filters, reel pop-up, lightbox, breakdown slider, layer build-up, loops, search
  features.css             project colour, layer build-up, motion loops, brief, search (loaded after the theme)
  themes/mono.css          the default look (monochrome, square, numbered); square.css is an alternative
  fonts/                   self-hosted Geist Sans and Geist Mono (woff2)
scripts/
  build.mjs                validates content, encodes images, writes HTML
  placeholders.mjs         generates stand-in frames (never overwrites real files)
  serve.mjs                tiny local static server
dist/                      build output (git-ignored)
```

## Project file format

This is what the editor writes. You can also edit these files directly on GitHub.

```json
{
  "order": 10,
  "slug": "foundation",
  "title": "Foundation",
  "category": "Series",
  "show": "Series, S02 — Apple TV+",
  "studio": "Studio name",
  "year": 2023,
  "role": "Senior Matte Painter",
  "tools": ["Photoshop", "Nuke", "Houdini"],
  "stills": [
    {
      "src": "/images/foundation-final.jpg", "alt": "What is in the frame", "featured": true,
      "breakdown": {
        "before": { "label": "Plate", "src": "/images/foundation-plate.jpg" },
        "passes": [ { "label": "CG render", "src": "/images/foundation-render.jpg" } ]
      }
    },
    { "src": "/images/foundation-final-2.jpg", "alt": "A second frame, without a breakdown" }
  ],
  "description": "Three to six plain sentences about what you did."
}
```

- Image paths can be `/images/x.jpg` or `x.jpg`; both mean `images/x.jpg`.
- Each frame's `breakdown` is optional. With it, that frame shows as a before/after slider on the project page (the before stays on the left; the frame itself, or any pass the viewer picks, shows on the right). `afterLabel` renames the frame in the slider (default "Final").
- `summary` (optional) is the one line on grid cards; without it the first sentence of the description is used.
- `category` becomes a filter pill and the tag on cards. The types are Film, Series, Commercial, Game, Generative, Assets and Personal; pills appear in that order, and only for types that have projects. `code` (e.g. `ROP_S02`) and `stills[].caption` are optional.
- Every project should have at least one frame with a before/after; the build prints a note for any project that doesn't.
- Text starting with `TODO:` shows a highlighted TODO tag on the site.
- The build stops with a clear message if a required field, an `alt`, or an image file is missing, or if a breakdown image isn't the same size as its frame.

## Placeholders to replace

- **Site settings**: name, email, IMDb and LinkedIn links, reel link (currently a public Vimeo demo video), poster, bio, availability, website address.
- **Projects**: every studio is `Studio TBC`, and the roles, tools and descriptions are stand-ins. Years and distributors are the real release details of each production. Check them against your own credits.
- **Loops**: the banner loop and the Rings of Power frame-1 loop are generated stand-ins.
- **Brief / How it was made / Currently**: the Rings of Power brief, the Generative Worlds bar and the About page "Currently" line are TODO examples.
- **Images**: all frames are generated stand-ins. Replace them through the editor, or overwrite a file on GitHub with the same name.

## How the site is laid out

- **Look**: dark and monochrome. Geist is used for titles and text, and Geist Mono for uppercase labels and metadata. Corners are square with 1px rules, sections are labelled "/ Work", and projects are numbered 01, 02, 03…. This comes from `src/themes/mono.css`, the default theme, layered over `src/styles.css`. `node scripts/build.mjs --theme=none` builds the plain base look, and `--theme=square` builds the square-corner variant. Those two go to `dist-none/` and `dist-square/`.
- **Home**: a hero carousel. The first slide shows your name and a Watch reel button over the reel poster; the next slides show the projects picked in Site settings, or the first three. It never moves by itself: viewers use the arrows, dots, swipe or arrow keys, and only slide 1's image loads with the page. If an availability line is set, it appears under your name with a green dot. Then **Work**, with filter pills and two views. The **Work** link in the top bar opens a separate Work page (`/work/`) with the same section, no banner, and every project listed. **All** shows 6 projects picked at random on every visit, with a "Show all" button for the rest; **Film / Series / Generative / Assets / Personal** show every project of that type. Every card is the same size and every row the same height (long text is cut with …), so switching filters never reflows the layout. **List** (default): one row per project with the main frame, title, role, type, year, tool chips, show and studio, and the breakdown's layer names. **Grid**: cards with the key frame, a type tag and the title over the image, role and studio, a one-line summary, and the year. The browser remembers which view the viewer picked.
- **Project page**: every project uses the same layout and the same frame stage, so nothing moves from project to project. On desktop, a text column on the left (type and year, title, one line with show, studio and role, tool chips, "What I did") beside the frames on the right: a thumbnail strip at the top left, then the stage, then one fixed-height controls row. The stage's size depends only on the screen; each frame sits centred inside it at its own aspect ratio, letterboxed in black. A frame with a breakdown is a before/after slider (plus pass buttons if it has passes). On phones: thumbnails, then the frame edge to edge at half the screen height (cropped at the sides for wide frames; "View full size" shows the whole frame), then the title and description. The page ends with **More work**.
- **Navigation**: every page opens at the top, including after Back/Forward. No link jumps partway down another page.
- **Reel**: plays in a pop-up player; the Vimeo/YouTube player loads only when someone presses Watch reel.
- **Breakdown slider**: drag with mouse or touch. On the divider, arrow keys move it and Page Up / Page Down switch passes.
- **Interactive touches**:
  - **Slider demo**: the first time a project's before/after slider scrolls into view, it sweeps once to show that it moves. It stops as soon as the viewer touches it, and is skipped for people who have set their device to reduce motion.
  - **Frame readouts**: each frame on a project page shows a small label with its frame number, aspect ratio and pixel size (for example `FRAME 01/02 · 2.39:1 · 2400×1004`). The before/after slider also shows its position (`WIPE 050%`).
  - **Fade-in**: images fade in as they load.
- **Project colour**: the build picks the strongest colour in each project's main frame. It is used on that project's page (the slider handle, active buttons, the type line, a faint glow at the top) and as the hover colour of its card and row. Frames that are nearly grey get no colour. To force one, add `"tint": "hsl(30 72% 66%)"` to the project file.
- **Build-up**: a frame with three or more breakdown layers also gets a Build-up section under the description. The stage stays on screen while the layers wipe in one after another as you scroll: Plate, then each pass, then Final.
- **Motion loops**: loops start only once the page has loaded and only while they are on screen. They never start by themselves for people who prefer reduced motion or have Data Saver on. Every loop has a pause button, and project loops show a running timecode. The two clips in the repo (`images/site/reel-loop.webm`, `images/rings-of-power/final-01-loop.webm`) are stand-ins; replace or remove them.
- **Quick search**: press Cmd+K (Ctrl+K on Windows) or `/` on any page, or use the search button in the top bar, to jump to a project by title, type, year, studio or tool.
- **Images**: 320/640/1024/1600/2400 px in AVIF, WebP and JPG via `<picture>`, with `width`/`height` always set (no layout shift).
- **Lighthouse** (mobile, local server): 99–100 on Performance and 100 on Accessibility, Best Practices and SEO.
