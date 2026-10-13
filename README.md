# Music Box

A small, installable web app (PWA) that plays your music from a **folder on your device**, **Google Drive**
and **Dropbox**.

**Live at https://djnron.github.io/tinystream/**. The device folder works right away; Google Drive and
Dropbox need keys (see Setup).
It's a lightweight take on [Cloud Music Box](https://github.com/ContentsViewer/cloud-music-box), written
from scratch as plain HTML/CSS/JavaScript with no build step and no dependencies.

- **Continuous play.** Tap a track or folder and it keeps going, track after track. You can shuffle, choose
  what happens when the list ends (start over / stop / repeat one), or play a folder *including all its
  subfolders*. The next track downloads while the current one plays, so switching is quick, and a track
  that fails to load is skipped instead of stopping the music. Lock-screen and headphone controls work
  through the Media Session API.
- **Switch music folders in one tap.**
  - **Pin folders:** pin any folder while browsing (☆ Pin). Pinned folders appear under **My folders** on
    the home screen, and in the **FOLDER** switcher at the top of the player's playlist. Picking one plays
    everything in it, subfolders included.
  - **Folder on this device:** plays music straight from your computer or phone, with no account. Use
    **Change folder** to switch.
  - **Browser support:** Chrome and Edge remember the folder between visits. Other browsers ask for it
    again each visit.
- **Share a record.** Open a Google Drive collection or a Dropbox folder and press **⤴ Share as record**.
  You get one link that carries the song list and your skin; anyone can open it and listen, with no
  account. Tick **Disable downloads** to remove every download and save option for listeners.
- **You decide whether anything is downloaded.** *Settings → Allow downloads to this device* is **off by
  default**. While it's off, music only streams and the app stores no audio or folder listings on the
  device. Turn it on to save single tracks, whole folders, or (optionally) every track as it plays, so it
  plays offline later. Turning it off stops downloads right away and asks whether to delete what's already
  saved.
- **Minimal, read-only access.**
  - **Dropbox:** created as an "App folder" app, it only sees `Dropbox/Apps/<app name>/`, read-only.
  - **Google Drive:** it only sees songs you pick in Google's picker (`drive.file`).
  - **Either way:** the app can't change or delete anything.
- **No server.** The browser talks directly to Google and Dropbox. Sign-in tokens stay in your browser.
- **Skins.** The player is a retro "deck": an LCD screen with segment digits, a scrolling title, a
  spectrum or oscilloscope visualizer, beveled transport buttons, and a playlist window. Seven built-in
  skins (Deck 98, Amber Terminal, Neon Arcade, Vaporwave, Brushed Steel, Bubblegum, Clean). You can
  also load your own skin file.
- **🎲 Skin generator.** One floating button, always on screen, makes a brand-new skin, with new colors and
  a new layout. Colors come from the palettes of real classic skins in the
  [Winamp Skin Museum](https://skins.webamp.org/). The arrangement, buttons, screen, frame and
  visualizer are rolled fresh, so no two presses in a row look or sit the same. Every generated skin
  gets a name and credits the museum skins it was inspired by.
- **One layout for every screen.** On wide screens the deck and playlist sit in a column next to the
  library. On phones there's a compact bar at the bottom that opens the deck full screen.
- Works offline for saved music and installs to the home screen or desktop.

## Run it locally

Any static file server works:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

`localhost` counts as a secure origin, so sign-in and the service worker work without HTTPS. Anywhere
else, serve it over **HTTPS**.

## Setup: add your keys

Both services need free developer keys that you create once. Put them in [`config.js`](config.js).
A source with empty keys is shown as "Not set up".

These keys are **public identifiers, not secrets**. They're visible in the page either way, and on their
own they can't open anyone's files. Every visitor signs in to their *own* account. Never put a Dropbox
**App secret** or a Google **client secret** in this repo; the app doesn't need either.

Both sources use the **narrowest access** each service offers:

- **Dropbox:** only one app folder.
- **Google Drive:** only the songs you pick.

Use your real addresses below. This repo is served at `https://tinystream.vercel.app/` and
`https://djnron.github.io/tinystream/`. Add `http://localhost:8080` too if you run it locally.

### Dropbox (App folder: the app only sees `Dropbox/Apps/<app name>/`)

1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**.
2. Choose **Scoped access**, then **App folder**, and give it a name, e.g. `tinystream`. This can't be
   changed later; if you already made a "Full Dropbox" app, create a new one.
3. On the **Permissions** tab, tick `files.metadata.read` and `files.content.read`, then **Submit**.
4. On the **Settings** tab:
   - **OAuth 2 → Redirect URIs**: add each address exactly, including the trailing slash:
     `https://tinystream.vercel.app/` and `https://djnron.github.io/tinystream/`.
   - **Allow public clients (Implicit Grant & PKCE)**: **Allow**.
5. Copy the **App key** into `dropboxAppKey` in `config.js`.
6. After you connect once, a folder appears at **Dropbox → Apps → tinystream** (named after your app).
   Put your music there, and subfolders work. The rest of your Dropbox stays invisible to the app.

> Keep the app in **development** status and don't "enable additional users" if it's just for you.

### Google Drive (only the songs you pick)

The app asks for Google's narrowest Drive permission, `drive.file`. It can only open files you choose in
Google's own picker window, never the rest of your Drive.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Picker API**.
3. **OAuth consent screen** (called **Google Auth Platform** in newer consoles):
   - Choose **External** and fill in the app name and your email.
   - Under **Data access / Scopes**, add `.../auth/drive.file`.
   - Under **Audience / Test users**, add your Google account. While the app is in "Testing", only the
     accounts listed there can sign in.
4. **Credentials → Create credentials → OAuth client ID**, type **Web application**. Under
   **Authorized JavaScript origins**, add `https://tinystream.vercel.app` and `https://djnron.github.io`.
   Copy the **Client ID** into `googleClientId`.
5. **Credentials → Create credentials → API key.** Restrict it:
   - **Application restrictions → Websites:** `https://tinystream.vercel.app/*` and
     `https://djnron.github.io/*`.
   - **API restrictions:** Google Picker API and Google Drive API.

   Copy it into `googleApiKey`.
6. Find the **Project number** (project settings, or the Dashboard's Project info card) and put it in
   `googleAppId`.

**Adding music:** in the app, go to **Google Drive → ＋ Add music from Google Drive**.

- **Picking songs:** you can pick individual songs, and shift-click selects a range.
- **Picking a folder:** this adds the songs inside it, subfolders included (confirmed with a real Drive). If
  Google ever doesn't share a folder's contents, the app says so; open the folder and select the songs
  instead.
- **Collections:** what you pick is saved as a named collection in your browser (just names and ids), which
  you can pin, rename, add to, or remove. Removing it never touches your Drive.

> Google browser sign-ins last one hour. Music Box renews it in the background whenever you tap something
> in the app. If an hour passes with no taps and the next track isn't saved on the device, you'll see a
> **Reconnect** button.

### Taking access away

You can cut the app off at any time, from any device:

- **Google:** [myaccount.google.com/permissions](https://myaccount.google.com/permissions) → remove the app.
- **Dropbox:** Settings → **Connected apps** → remove it.

On a shared computer, use **Disconnect** (or **Settings → Reset app**) when you're done.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` copies the app into the `gh-pages` branch on every push to `main`. If the site
doesn't appear, go to **Settings → Pages**, set **Source: Deploy from a branch**, and choose **Branch: gh-pages /
(root)**. That's a one-time step. Remember to add the Pages URL
to the Google origins and Dropbox redirect URIs above.

Client IDs and app keys are public by design (they're visible in any web app that uses them), so it's fine
to commit `config.js`.

## Sharing records

**⤴ Share as record** does two things:

1. **Shares the songs by link.**
   - **Google Drive:** turns on "anyone with the link" for just those songs, using the same `drive.file`
     permission.
   - **Dropbox:** creates share links for them.

   Nothing else in your Drive or Dropbox is shared.
2. **Makes a link** whose part after `#` holds the title, the song list and your skin, compressed. No
   server is involved; the link *is* the record.

**Your friend's side:** they open the link and see the record in your skin, with **Play**, **Shuffle**
and **Keep this skin**.

- **Playback:** songs stream straight from Google (via the site's API key) or Dropbox
  (`dl.dropboxusercontent.com`), with no sign-in.
- **Untrusted links:** everything in a link is checked before use. A skin that tries to load anything is
  ignored, and malformed tracks are dropped.

**Disable downloads** hides download buttons, save-for-offline and direct file links for that record.
It's a deterrent, not protection: a browser that can play a song has its data, so someone technical
could still save it.

**Stop sharing** (Settings → Shared records) turns link access back off for those songs. A song that's
also in another shared record stays shared until that record is stopped too. Only share music you have
the right to share.

**One-time Dropbox step:**

1. In your Dropbox app's **Permissions** tab, tick `sharing.read` and `sharing.write`, then click
   **Submit**.
2. The first time you share, the app asks Dropbox for that permission once.

Google Drive needs nothing extra. If your Google Workspace blocks sharing outside the organization, Google
refuses, and the app says so.

## Skins

A skin has two parts, both defined in [`js/skins.js`](js/skins.js):

- **Tokens:** every color, bevel, gradient and font, as CSS custom properties.
- **A layout:** options applied as `data-*` attributes on `<html>`, which `css/app.css` turns into
  different arrangements:

| Layout key | Options |
| --- | --- |
| `deck` | `classic` · `orbit` (round screen, buttons on an arc) · `split` (floating pods) · `hero` (big centered time) · `rack` (controls in a column) · `boombox` (speakers that thump with the beat) · `cassette` (reels that spin while playing) · `strip` (visualizer behind the display) |
| `buttons` | `bevel` · `round` · `pill` · `flat` · `keys` (chunky 3D keys) · `labels` (PLAY / STOP text instead of icons) |
| `titlebar` | `grips` · `center` · `left` · `slim` |
| `lcd` | `sunken` · `pill` · `crt` (scanlines) · `dots` (dot matrix) · `outline` |
| `seek` | `trough` · `line` · `led` (segmented) · `thick` |
| `frame` | `bevel` · `outline` (hard shadow) · `soft` · `double` |
| `vis` | `bars` · `mirror` · `blocks` · `dots` |
| `list` | `plain` · `zebra` · `compact` |
| `shape` | `box` · `blob` · `notch` · `arch` · `wave` (windows always sit straight) |
| `pattern` | `none` · `stripes` · `checker` · `polka` · `zigzag` · `plaid` · `sunburst` · `scan` |
| `fx` | `none` · `hue-drift` · `glow` · `float` · `glitch` · `rainbow` · `jelly` (wobbles to the beat) |
| `type` | `plain` · `wide` · `slanted` · `chunky` |
| `emblem` | `none` · `top` · `bottom`: a big generated logo panel on the player |
| `side`, `order`, `width` | player left or right of the library, playlist above or below it, column width 300–460 px |

### Artwork

Skins can also carry generated artwork (`art` in a skin file), drawn by
[`js/skin-art.js`](js/skin-art.js) in the spirit of late-90s player skins:

- **Base:** `chrome`, `plasma`, `dither`, `grid` (synthwave horizon), `contour`, `halftone`.
- **Up to four overlays:** `rain` (falling code), `circuit`, `hexdump`, `hud`, `waves`, `stars`, `glyphs`
  (unreadable tech text), `barcode`, `logotype` (the skin's name), `hazard`, `grille`.
- **Extras:** optional `glitch` and corner `rivets`.

Everything is drawn from the skin's own colors and a `seed`, so a skin looks the same every time and
nothing is copied from real skins. The player, playlist, title bars, screen and emblem each get their own
image at their own size. Labels that sit on artwork get a small screen-colored plate so they stay
readable.

Every combination has been checked to fit at phone width and on desktop. The built-in skins each use
a different layout. To make your own:

1. **Settings → Skin → Download skin template.** You get a JSON file with every token and the layout,
   starting from the skin you're using. The allowed layout values are listed in `layoutOptions`.
2. Edit the values. Any CSS color, gradient, `px` size or font list works.
3. **Load skin file…** applies it, and it stays selected.

### The generator

`js/skin-corpus.js` holds the color palettes of 400 classic skins from the Winamp Skin Museum, built by
[`tools/build_skin_corpus.py`](tools/build_skin_corpus.py) through the museum's public API. For each
skin, the script takes:

- the playlist colors from its `pledit.txt`;
- the visualizer colors from its `viscolor.txt`;
- the title bar, frame, LCD, digit and button colors, sampled from fixed spots in its screenshot.

Only colors are stored, no skin artwork. Each press of 🎲 (`js/skin-generator.js`) works like this:

1. Picks a skin's palette. One time in three, it also borrows the LCD and playlist colors from a
   second skin.
2. Sometimes rotates all the hues, slightly or dramatically.
3. Rolls the style: deck gradient (flat, shaded, brushed, diagonal or split), title bar style,
   corner radius, fonts and LCD glow.
4. Rolls a whole layout: arrangement, buttons, title bar, screen, seek bar, frame, visualizer,
   playlist, side and width. The arrangement and button style never repeat the previous skin's.
   It also rolls an artwork recipe; green-on-black screens lean toward code rain and hex dumps.
5. Builds a dark or light page to match the deck.
6. Fixes contrast so everything stays readable: at least 4.5:1 for the LCD, playlist and title text,
   and 3:1 for button icons and accents.

It's tested over 10,000 random skins. Undo is in the toast. To keep a generated skin, use Download skin
template. To rebuild the palette data (for example with more skins), run
`python3 tools/build_skin_corpus.py 600` (needs Pillow).

For safety, unknown tokens are ignored, and values that could load something from the network
(`url(...)`) are rejected. To add a built-in skin, add an entry to `SKINS` in `js/skins.js`.

Keyboard: <kbd>Space</kbd> play/pause, and the classic <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd>
<kbd>V</kbd> <kbd>B</kbd> for previous / play / pause / stop / next. Tap the time to switch between
elapsed and remaining. Tap the visualizer to cycle bars → oscilloscope → off.

## How it's built

```
index.html            app shell
config.js             your Google client ID / Dropbox app key
sw.js                 service worker: caches the app so it opens offline
css/app.css
js/app.js             views, routing, the deck + playlist UI
js/skins.js           skin tokens, built-in skins, skin-file loading
js/skin-generator.js  the 🎲 generator
js/share.js           shared records: making links, opening them, stop sharing
js/skin-corpus.js     palettes sampled from 400 museum skins (generated, loaded on first 🎲)
tools/build_skin_corpus.py   rebuilds skin-corpus.js from the Winamp Skin Museum API
js/lcd.js             seven-segment LCD digits (SVG)
js/player.js          queue, continuous play, prefetching, Media Session
js/store.js           settings (localStorage) + saved music (IndexedDB)
js/downloads.js       "save to device" queue (refuses to run while downloads are off)
js/visualizer.js      optional spectrum / oscilloscope (Web Audio)
js/providers/gdrive.js   Google Identity Services + Drive v3 REST
js/providers/dropbox.js  OAuth 2 PKCE + Dropbox HTTP API
```

When you ship changes, bump `VERSION` in `sw.js` so installed copies update.

### Notes and limits

- Each track is downloaded whole before it plays, because Google and Dropbox both need an
  `Authorization` header that an `<audio>` element can't send. Large lossless files take a moment to
  start. The next track is always fetched ahead of time.
- Track titles come from file names. Folder names are used as the album/artist line.
- Playable formats depend on the browser. MP3, AAC/M4A, WAV and FLAC work almost everywhere. OGG/Opus
  don't play on older iOS versions.
- The visualizer routes audio through Web Audio. Some mobile browsers pause that in the background, so
  it's off by default. Once turned on, it stays connected until the app is reloaded.
