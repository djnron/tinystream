# Music Box (tinystream): project handoff

A briefing for picking this project up in a new conversation. It covers what exists, how it's set up,
the decisions made so far and why, what's known to be rough, and the three things the owner wants
next. Current as of the commit that added this file.

## What it is

A skinnable, retro (Winamp-inspired) music player that runs in the browser and plays music straight
from the listener's own **Google Drive**, **Dropbox**, or a **folder on their device**. No server holds
music or accounts. It installs as an app (PWA) on phones and desktops.

- **Live:** https://tinystream.vercel.app (main site, has link previews)
  and https://djnron.github.io/tinystream/ (GitHub Pages mirror, no link previews)
- **Repo:** https://github.com/djnron/tinystream, branch `main` (deploys automatically to both)
- **Started from:** the idea of https://github.com/ContentsViewer/cloud-music-box, rebuilt lean
- **Owner:** djnron. Not a developer by trade; prefers plain-language explanations and decides what
  goes live.

## Features today

- **Sources:** Google Drive (songs/folders picked in Google's picker), Dropbox (whole Dropbox,
  read-only), a local folder (File System Access API, with a fallback).
- **Playback:** continuous play, shuffle, repeat, skip-on-error, keyboard shortcuts, lock-screen
  controls (Media Session). Songs **stream** (start in about a second, seek instantly). Opening a
  folder pre-loads its songs into the player.
- **Offline:** optional. "Allow downloads" plus "Save every song as it plays" keeps copies on the
  device (IndexedDB). Off by default, and the user chooses whether stored music is deleted when it's
  turned off.
- **Skins:**
  - One-button generator (🎲, always on screen) built from 400 palettes of the Winamp Skin Museum.
  - Wild layouts (8 deck arrangements, button styles, screen frames, silhouettes, textures,
    animations).
  - Generated artwork drawn on canvas.
  - The whole library restyles to match the skin.
- **Skin Studio** (Settings → Skin → ✎ Skin Studio):
  - Quick tab: 5 colors (or colors taken from a picture), about 25 fonts (Google Fonts), your own
    pictures (upload or link; placed on the player, screen, playlist, page, or as a sticker, with
    effects), plus shape, artwork and effects.
  - Deep tab: every option and token, any Google Font, raw skin file.
  - Undo/redo, saved as "My skins".
- **Shared records:** share a folder as a link anyone can play without an account.
  - The link carries the song list, the sender's skin (and pictures), and a "disable downloads" flag
    (a deterrent, not DRM).
  - Songs are shared by link in the sender's Drive/Dropbox; "Stop sharing" undoes that.
  - Opening a record pre-loads it.
  - A Share button on the player offers copy, the system share sheet, email, SMS, WhatsApp.
- **Link previews:** pasting a record link in iMessage/WhatsApp/Slack shows a snapshot of the
  sender's actual player with the record's title (made at share time, stored next to the songs;
  a drawn fallback card otherwise).
- **Layouts:**
  - Phone: opens on the full player, mini player at the bottom.
  - Tablet/desktop (≥768px): player column beside the library.
  - Stage mode (F): player fills the screen, library in a drawer.
  - Pop-out (Chrome's always-on-top Picture-in-Picture window), with a collapsible song list.

## How it's built

Plain ES modules, **no build step**, no framework. Open `index.html` through any static server.

```
index.html, css/app.css      the page and all styles (skins are CSS variables + data-* attributes)
js/app.js                    routing, views, the deck UI, sharing UI, stage/pop-out (largest file)
js/player.js                 queue, streaming/download playback, prefetch, media session
js/store.js                  settings (localStorage) + IndexedDB (saved songs, folder handles, pictures)
js/providers/                gdrive.js (OAuth + Picker), dropbox.js (PKCE), local.js, index.js
js/share.js                  shared records (link encoding), picture/cover upload, playing records
js/skins.js, skin-art.js, skin-generator.js, skin-corpus.js   skins, artwork, generator, museum palettes
js/studio.js, pictures.js    Skin Studio and picture layers
js/cover.js                  link-preview snapshot (loads html-to-image from jsdelivr when sharing)
js/visualizer.js, lcd.js     spectrum/scope visualizer, LCD digits
api/record.js, api/card.js   Vercel functions: preview page for /r?c=… and the preview image
sw.js                        service worker: offline app shell + streaming proxy for Google Drive
vercel.json, package.json    /r → api/record rewrite; @vercel/og for the fallback card
tools/build_skin_corpus.py   rebuilds the museum palette corpus
.github/workflows/pages.yml  copies the site to the gh-pages branch on each push to main
```

Bump `VERSION` in `sw.js` with every shipped change, or installed apps keep old files.

## Accounts and settings (all owned by djnron)

Keys in `config.js` are public identifiers, not secrets. **Never commit an app secret, client secret
or access token.**

- **Google Cloud project 497071777165:**
  - OAuth client (web).
  - API key restricted to the site addresses (Drive API + Picker).
  - Scope `drive.file` only: the app sees just the files picked or created.
  - Consent screen: External.
- **Dropbox app "tinystream2"** (key `nmjcq8ad1u1qfyh`):
  - Full Dropbox, scopes `files.metadata.read`, `files.content.read`, `sharing.read`,
    `sharing.write` and `files.content.write` (for pictures in records).
  - If sharing says "Dropbox didn’t allow share links" or "…saving pictures", one of those is
    switched off. Fix: App Console → tinystream2 → Permissions, tick it, click **Submit** (the tick
    doesn't count until then), then Try again in Music Box. Only the owner can do this, so the app
    doesn't show these steps to listeners.
  - "Allow public clients (PKCE)" on.
  - Redirect URIs for both sites.
  - Chooser domains set.
  - "Additional users" enabled.
  - The previous "App folder" app (`ix7vqz4cgby83e6`) is kept for rollback. The code migrates old
    sign-ins and pins.
- **Vercel:**
  - Builds `main` as production, other branches as previews (team slug `m-c-m1`).
  - Preview URLs need a Vercel login (Deployment Protection), so link previews only work on
    production.
- **Every new site address** (a preview branch, a custom domain) must be added to:
  - the Google API key's website restrictions;
  - the OAuth client's JavaScript origins;
  - Dropbox redirect URIs and Chooser domains.

## Security and privacy model

- Sign-ins (OAuth tokens) live only in the browser. Everything runs client-side except the two
  preview functions.
- **Read-only, narrowest practical access:**
  - Drive: only picked files.
  - Dropbox: read-only (write scopes only on request, for record pictures).
- **Shared records:**
  - Songs are link-shared ("anyone with the link"). The record payload lives after `#` in the URL,
    so servers never see it.
  - The `?c=` part (title, count, skin colors, cover location) is all the preview server sees.
  - Record data is validated as untrusted. Skins can't load arbitrary URLs except user-chosen
    picture links, which listeners must opt in to.
- **Not protected:** "disable downloads" only hides buttons. Anyone with a record link can get the
  songs. Users are told to share only music they have the right to share.

## Owner preferences (learned along the way)

- **Look and feel:**
  - Retro Winamp aesthetic, wild and experimental generated skins, never crooked/tilted.
  - The dice button stays on screen.
  - No extra steps or "fit" buttons in the UI.
- **Security:** prefers the narrowest access that still works.
- **Workflow:**
  - Wants to see changes before they go live. Try risky work on a branch / Vercel preview, show
    screenshots, and only merge to `main` when they say "merge it".
  - Explain in plain language. Ask before pushing when there's doubt.

## Known rough edges / to verify on real devices

- Streaming has only been tested against simulated servers. Verify on real Google Drive (seeking
  through the service worker) and real Dropbox (temporary links + visualizer CORS).
- Safari/iOS is untested (no WebKit in the build environment). Check:
  - picture upload;
  - streaming and background playback;
  - PWA install;
  - the phone layout.
- Pop-out sizing was fixed in a separate local session (commit `98fe2fb`); re-check in Chrome.
- Songs inside folders added with the old Dropbox picker can't go in records. Not relevant with
  full-Dropbox access, but the code path remains.
- **Testing:** done with Playwright scripts kept outside the repo (now gone). There's no automated
  test suite in the repo yet.
- **Large file:** `js/app.js` is about 1,900 lines and would benefit from splitting.

## What the owner wants next

1. **Distribution and app strategy:** what to do with this.
   - Who is it for (just friends, the public, a product)?
   - How do people get it?
     - PWA as-is.
     - Custom domain.
     - App stores via a wrapper (Trusted Web Activity for Google Play, Capacitor/WKWebView for iOS;
       note Apple's rules on music apps and web wrappers).
   - **Scaling limits:**
     - Google OAuth verification / brand review for a public app.
     - Dropbox production approval (development apps are limited to a small number of users).
   - Legal (music sharing, DMCA, terms/privacy pages).
   - Costs (Vercel functions, Google API quotas).
   - Naming ("Music Box" vs "tinystream").
2. **Documentation, probably a slide deck:**
   - Audiences: users (how to set up and use), friends/partners (what it is, why it's cool),
     maybe developers (architecture).
   - Material: the live app, generated skins, Skin Studio, the link-preview card, the share flow.
     Screenshots can be taken from the live site.
3. **Next steps for development:**
   - Candidates:
     - a real test suite in the repo;
     - device testing (iOS Safari, Android Chrome);
     - splitting `app.js`;
     - search across the library;
     - playlists/queue editing;
     - song metadata and album art (ID3);
     - equalizer;
     - gapless/crossfade;
     - more sources (OneDrive, Box, Jellyfin/Plex, WebDAV);
     - importing real Winamp `.wsz` skins;
     - a public skin gallery;
     - collaborative records;
     - security headers (CSP) in `vercel.json`;
     - a custom domain.
   - Ranking these is part of the ask.
