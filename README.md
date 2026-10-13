# Music Box

A small, installable web app (PWA) that plays your music straight from **Google Drive** and **Dropbox**.
It's a lightweight take on [Cloud Music Box](https://github.com/ContentsViewer/cloud-music-box), written
from scratch as plain HTML/CSS/JavaScript with no build step and no dependencies.

- **Continuous play.** Tap a track or folder and it keeps going, track after track. You can shuffle, choose
  what happens when the list ends (start over / stop / repeat one), or play a folder *including all its
  subfolders*. The next track downloads while the current one plays, so switching is quick, and a track
  that fails to load is skipped instead of stopping the music. Lock-screen and headphone controls work
  through the Media Session API.
- **You decide whether anything is downloaded.** *Settings → Allow downloads to this device* is **off by
  default**. While it's off, music only streams and the app stores no audio or folder listings on the
  device. Turn it on to save single tracks, whole folders, or (optionally) every track as it plays, so it
  plays offline later. Turning it off stops downloads right away and asks whether to delete what's already
  saved.
- **Read-only access.** Google Drive uses the `drive.readonly` scope and Dropbox uses
  `files.metadata.read` + `files.content.read`. The app can't change or delete anything in your storage.
- **No server.** The browser talks directly to Google and Dropbox. Sign-in tokens stay in your browser.
- **Skins.** The player is a retro "deck": an LCD screen with segment digits, a scrolling title, a
  spectrum or oscilloscope visualizer, beveled transport buttons, and a playlist window. Seven built-in
  skins (Deck 98, Amber Terminal, Neon Arcade, Vaporwave, Brushed Steel, Bubblegum, Clean). You can
  also load your own skin file.
- **🎲 Skin generator.** One button (top bar, or Settings → Skin) makes a brand-new skin from the
  palettes of real classic skins in the [Winamp Skin Museum](https://skins.webamp.org/). Every
  generated skin gets a name and credits the museum skins it was inspired by.
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

Both services need a free developer key that you create once. Put them in [`config.js`](config.js).
A source with an empty key is shown as "Not set up".

The examples below assume the app is at `http://localhost:8080/`. Add your real URL too, e.g.
`https://<you>.github.io/<repo>/`.

### Google Drive

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name and your email,
   and add the scope `.../auth/drive.readonly`. Under **Test users**, add every Google account that will
   use the app. (While the app is in "Testing" mode, only those accounts can sign in. That's fine for
   personal use.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
   Under **Authorized JavaScript origins**, add `http://localhost:8080` and your hosted origin, e.g.
   `https://<you>.github.io`. No redirect URI is needed.
5. Copy the **Client ID** into `googleClientId` in `config.js`.

> Google browser sign-ins last one hour. Music Box renews it in the background whenever you tap something
> in the app. If an hour passes with no taps and the next track isn't saved on the device, you'll see a
> **Reconnect** button. If you listen for hours without touching the screen, turn on downloads and save
> the folder first.

### Dropbox

1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**.
2. Choose **Scoped access**, then **Full Dropbox** (or **App folder** if you'd rather keep music in
   `Apps/<your app>`), and give it a name.
3. On the **Permissions** tab, tick `files.metadata.read` and `files.content.read`, then **Submit**.
4. On the **Settings** tab:
   - **OAuth 2 → Redirect URIs**: add the exact app URL, e.g. `http://localhost:8080/` and
     `https://<you>.github.io/<repo>/` (including the trailing slash).
   - **Allow public clients (Implicit Grant & PKCE)**: **Allow**.
5. Copy the **App key** into `dropboxAppKey` in `config.js`. (Don't use the App secret. It isn't needed and
   must never go in a web page.)

> A Dropbox app in development mode can be used by its owner plus up to 500 users you link. Personal
> use doesn't need production approval.

## Deploy to GitHub Pages

The repo includes `.github/workflows/pages.yml`. In the GitHub repo, go to **Settings → Pages → Source**
and choose **GitHub Actions**. Every push to `main` then publishes the app. Remember to add the Pages URL
to the Google origins and Dropbox redirect URIs above.

Client IDs and app keys are public by design (they're visible in any web app that uses them), so it's fine
to commit `config.js`.

## Skins

Every color, bevel, gradient and font comes from a set of skin tokens (CSS custom properties) listed in
[`js/skins.js`](js/skins.js). To make your own:

1. **Settings → Skin → Download skin template.** You get a JSON file with every token, starting from the
   skin you're using.
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
4. Builds a dark or light page to match the deck.
5. Fixes contrast so everything stays readable: at least 4.5:1 for the LCD, playlist and title text,
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
