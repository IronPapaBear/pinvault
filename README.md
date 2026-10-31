# PinVault

A free web app for tracking **Hidden Disney / Hidden Mickey** pins: see what you have and what you need in every wave, add pins by photographing them, and scan a cast member lanyard or trade board to see which pins you still need (★ chasers highlighted).

**Open it:** https://ironpapabear.github.io/pinvault/

## Install on your phone
- **iPhone:** open the link in **Safari** → tap **Share** → **Add to Home Screen**.
- **Android:** open the link in **Chrome** → menu **⋮** → **Install app** (or **Add to Home screen**).

It then opens full-screen with its own icon and works offline in the parks.

## How it works
- The first time you open it, each phone downloads the set photos from [Disney Pins Blog](https://disneypinsblog.com/pages/hidden-disney-pin-series) and boxes the pins on them automatically. Tap a box to name it, set its theme, mark chasers, split a box that covers several pins, or mark it owned.
- **Add Pins:** photograph pins you own. PinVault tells you which series and wave each is from. If it isn't sure, tap **Find on a board** and pick it from the set photo; it learns from your photo.
- **Trade Board:** use **Live scan** or a photo. Red = you need it, orange = a chaser you need, green = you have it, gray = not recognised.
- Your collection is stored **only on your phone**. Use **Settings → Save backup** now and then.

## Sharing a tidied-up layout with friends
After you've fixed the boxes, names, themes and chasers: **Settings → Export layout**, then upload the downloaded `layout.json` to this repository (replacing the existing one). Everyone's PinVault picks it up the next time they open it. The layout contains no photos and nothing about what anyone owns.

## Notes
- Set photos belong to Disney Pins Blog and are not stored in this repository; each phone downloads them for personal reference.
- Optional smarter matching uses Google's MediaPipe image model, downloaded once from a public CDN.
- Fan-made; not affiliated with Disney or Disney Pins Blog.
