# Music Box: briefing for a business strategy conversation

This is for a new conversation with Claude about business strategy and whether (and how) to turn Music
Box into a product. It describes what exists today, how it works, what it costs, what limits it, and
the open questions. The technical handoff for development work is `docs/HANDOFF.md` in the same repo.

Current as of 27 October 2026.

## The short version

Music Box is a retro, Winamp-style music player that runs in the browser. It plays music people
already keep in their **Google Drive**, **Dropbox**, or a **folder on their device**. There is no
upload, no music library on a server, and no account system of its own. Its standout features are:

- **Generated skins:** one button rolls a new look for the whole player.
- **Skin Studio:** make your own look, with your own pictures.
- **Shared "records":** a link anyone can open and play without signing up, wearing the sender's skin.
- **Embeds:** the player can sit on any web page.

It was built in about two weeks (first commit 13 October 2026) by the owner working with Claude Code.
It works and is live, but it is used by the owner and a few friends, not the public.

## Links

- **Live app:** https://tinystream.vercel.app (main site; shared links show preview images here)
- **Mirror:** https://djnron.github.io/tinystream/ (GitHub Pages; no link preview images)
- **Code:** https://github.com/djnron/tinystream (branch `main` goes live automatically)
- **Technical handoff:** https://github.com/djnron/tinystream/blob/main/docs/HANDOFF.md
- **Inspiration:** https://github.com/ContentsViewer/cloud-music-box (the starting idea, rebuilt lean)
- **Skin palettes come from:** the Winamp Skin Museum, https://skins.webamp.org

## The owner

- djnron (Daniel). Not a developer by trade.
- Builds by directing Claude, and decides what goes live.
- Prefers plain-language explanations and the narrowest data access that still works.
- Has a strong taste for the retro look: wild generated skins, but never crooked or tilted.
- Has not decided who this is for. That's the point of the strategy conversation.

## What it does today

### Listening
- Play folders from Google Drive (files picked in Google's own picker), the whole of Dropbox
  (read-only), or a folder on the device.
- Songs stream, starting in about a second.
- Continuous play, shuffle, repeat, and lock-screen controls.
- Works as an installable app (PWA) on phones and computers.
- Optional offline listening: songs saved on the device as they play.

### Looks
- **🎲 button, always on screen.** Generates a new skin from 400 palettes taken from the Winamp Skin
  Museum.
  - Wild layouts: 8 deck arrangements, button styles, frames, textures, animations.
  - Generated artwork.
  - The whole library restyles to match.
- **Skin Studio** for making your own skin:
  - Quick mode: 5 colors (or colors taken from a photo), about 25 fonts, your own pictures placed on
    the player, shape and effects.
  - Deep mode: every option.
  - Skins are saved as "My skins".
- **Layouts:**
  - Phone: opens on the full player.
  - Tablet and desktop: player beside the library.
  - Stage mode: player fills the screen.
  - Pop-out: an always-on-top mini window in Chrome.

### Sharing (the most product-like part)
- **"Share as record":** turns a folder into a link anyone can play without an account or app.
  - The record carries the song list, the sender's skin (including their pictures), and an optional
    "disable downloads" flag.
  - "Disable downloads" only hides buttons. It discourages downloading; it isn't copy protection.
- **Share button on the player:** copy link, the phone's share sheet, email, SMS, WhatsApp.
- **Link previews:** pasting a record link in iMessage, WhatsApp or Slack shows a picture of the
  sender's actual player with the record's title.
- **Embed code:**
  - A record can be placed on any web page, full or compact.
  - It sizes itself to fit.
  - If a page has several players, starting one stops the others.

### How sharing works underneath
- The songs stay in the sender's Google Drive or Dropbox.
- Sharing turns on "anyone with the link" for those files. "Stop sharing" turns it off again.
- The record itself (song list, skin) is packed into the link, after the `#`, so no server stores or
  even sees it.

## How it's built, and what it costs to run

- Plain files (HTML, CSS, JavaScript), no framework, no build step. About 8,800 lines.
- **No database and no user accounts.** Sign-ins to Google and Dropbox happen in the browser and the
  tokens stay there.
- **Hosting:** Vercel (free tier today) plus a GitHub Pages mirror. Two tiny server functions only
  make link-preview pages and images.
- **Running cost today:** effectively zero.
  - Music is streamed straight from Google or Dropbox to the listener, so bandwidth costs land on
    those services, not on Music Box.
  - Costs would grow mainly with link-preview images (Vercel function calls) and Google API quota.
- **Pros:** cheap to run, private by design, almost nothing to break, no user data to protect.
- **Cons:** no accounts means no cross-device sync, no analytics on users, no payments, and nothing
  to stop someone copying the app.

## Third-party dependencies that limit growth

These are the real gates to going public. The details need checking against each company's current
rules.

- **Google:**
  - Uses the `drive.file` permission, the narrowest one: the app only sees files the user picks.
  - Going public means Google's OAuth app verification (brand and consent-screen review, privacy
    policy, home page).
  - Until then, Google shows an "unverified app" warning and limits the number of users.
- **Dropbox:**
  - The Dropbox app ("tinystream2") is in development status. Such apps are limited to a small number
    of users (around 500 linked users, with a production review expected as usage grows).
  - Going public needs Dropbox's production approval.
  - It currently asks for full-Dropbox read, sharing, and (for record pictures) write permissions.
    Reviewers may push back on the breadth.
- **Apple / Google app stores:**
  - Today it's a PWA, installed from the browser.
  - Store listing would need a wrapper: Trusted Web Activity on Android, Capacitor or similar on iOS.
    Apple is strict about apps that are thin web wrappers.
  - iPhone background audio in PWAs works, but has quirks.
- **Winamp Skin Museum palettes:**
  - Colors are derived from community skins.
  - Fine for a hobby. Check licensing and attribution before charging money.
- **Fonts:** Google Fonts (open licenses).

## Legal and trust questions

- **Sharing music:** records make people's music files playable by anyone with the link.
  - The app tells users to share only music they have the right to share.
  - A public product would need terms of use, a privacy policy, a copyright (DMCA) process, and
    possibly limits.
  - The files live in users' own cloud accounts, which may help, but Google and Dropbox have their
    own rules on sharing copyrighted content.
- **Privacy:** a strong story already.
  - No server-side user data.
  - Narrow permissions.
  - Record contents never reach a server.
- **Name:** "Music Box" is generic and likely crowded. "tinystream" is the repo and site name. A
  real product needs a name check and probably a custom domain.

## Who it might be for (ideas to test, not conclusions)

- **Independent musicians and DJs:**
  - Share demos, mixes or albums as a styled, playable link or website embed.
  - Music stays in the Dropbox they already use.
  - This is closest to what the sharing and embed features already do.
- **People with their own music collections:** listen to files in Drive or Dropbox with a fun player
  (the "Winamp nostalgia" crowd).
- **Gifting and personal mixtapes:** a skinned record as a modern mixtape for a friend or partner.
- **Small labels, podcasters, bands' websites:** an embeddable, brandable player that isn't
  SoundCloud or Bandcamp.
- **Communities around skins:** a public skin gallery, remixing skins, sharing looks.

## Possible business models to weigh

- A free hobby or open-source project (costs stay near zero).
- Freemium:
  - free player;
  - paid creator features: custom domains for records, analytics on plays, more embed styles, no
    Music Box branding, password-protected records, expiring links.
- One-time purchase (app stores) or "pay what you want".
- Tools for artists or labels (B2B embeds).
- Note: charging for creator features would need user accounts and a small backend, which the app
  deliberately doesn't have today. That is the biggest product and architecture fork.

## Landscape to research

- Players for your own cloud music: Evermusic, CloudBeats, Doppler, Plex/Plexamp, Jellyfin,
  Navidrome.
- Nostalgia players: Webamp (Winamp in the browser), Winamp's own revival.
- Sharing and embeds: Bandcamp, SoundCloud, Untitled (unreleased-music sharing), DISCO, Dropbox's own
  file previews.

These are names to look into, not a vetted competitive analysis.

## Known gaps before any launch

- Little testing on real iPhones and Android devices (built and tested in desktop Chrome with
  simulated Google and Dropbox).
- No automated test suite in the repo.
- No analytics, so no data on how people use it.
- No terms, privacy page, or support contact.
- Only one person (the owner) can change the Google and Dropbox app settings.

## Questions for the strategy conversation

1. Who is the first audience, and what job does Music Box do for them better than what they use now?
2. Is the hook the **player** (listening to your own music) or the **record** (sharing a styled,
   playable link)?
3. Hobby, open source, or business? What does success look like in 6 months?
4. Is it worth adding accounts and a backend to unlock paid features, or is "no servers, no accounts"
   the selling point?
5. What has to happen with Google and Dropbox approval, legal pages and naming before inviting
   strangers?
6. PWA only, or app stores too?
7. What's the cheapest way to test demand: a landing page, a few musicians, a Product Hunt or Reddit
   post?
