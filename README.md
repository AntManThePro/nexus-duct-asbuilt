# NEXUS Duct As-Built — NFPA 96 Field Kernel

> **Words draw the map.** Offline-first kitchen-exhaust duct as-built, hood/appliance schedule and NFPA 96 compliance audit — for iOS, Android and the web.

NEXUS v5 merges the original *NEXUS Duct As-Built* board (hoods, collars, appliances, §4.6.4 packet flags) with the
*NFPA 96 Compliance Engine* (wizard, trade-slang parser, CAD + redline canvas, rules kernel, binder) into a single
installable app, wrapped with [Capacitor](https://capacitorjs.com) for the App Store and Google Play.

| Step | Module | What it does |
|---|---|---|
| 01 | **Site & AHJ Dossier** | Facility, AHJ, technician, duty class, fan type, access-spacing rule (NFPA 96 12 ft / IMC 20 ft), cooking volume, hood type (wall / side-by-side / island), size, collars, appliances under canopy, §4.6 packet checklist |
| 02 | **Slang Parser** | Offline fuzzy NLP turns field talk (`"up 8ft dogleg 90 right horz 22ft w/ door slant 45 up 6 to hinged fan"`) — typos included — into duct geometry. Mic dictation via Web Speech where available |
| 03 | **CAD & Redline Canvas** | To-scale schematic (1 ft = 1 unit) with animated flow hood → fan, dimension tags, access-door markers, roof line; pinch/wheel zoom, pan, node drag, component library, node inspector; stylus/finger redline pen with colours, widths, undo |
| 04 | **NFPA 96 Audit** | 8 geometric rules (horizontal access spacing, access at every turn, riser access, fan hinge / in-line / sidewall, hood coverage, duty vs appliance class, collars, run integrity) + 9 §4.6 packet flags, compliance score, Table 12.4 inspection cadence |
| 05 | **Packet & Export** | Owner binder sheet (print / Save as PDF), PNG with title block, JSON save/import, native share sheet, record ID & run hash |

Everything runs on-device. No accounts, no network, no analytics.

## Repository layout

```
www/                 the web app (deployable as-is: PWA + Capacitor webDir)
  index.html         shell
  css/app.css        styling (no CDN, system fonts, safe-area aware)
  js/core.js         state, persistence, audio/haptics, layout engine
  js/parser.js       "words draw the map" fuzzy parser
  js/canvas.js       renderer, gestures, redline, PNG export
  js/audit.js        NFPA 96 rules kernel + packet flags
  js/ui.js           controller, wizard, binder, native bridges, boot
  sw.js              offline service worker (web only)
  manifest.webmanifest, icons/
resources/           icon/splash sources for @capacitor/assets + store artwork
scripts/             gen-icons.py (Pillow), lint.js
tests/               node:test unit tests for parser & audit
docs/                STORE_SUBMISSION.md, STORE_LISTING.md, PRIVACY_POLICY.md
capacitor.config.json, package.json
.github/workflows/   pages.yml (PWA), android.yml (APK/AAB), ios.yml (Xcode validation)
```

## Run it

```bash
# Web / PWA
npm start                  # http://localhost:4173
npm run lint && npm test   # syntax lint + unit tests

# Native (requires Node 20+, Android Studio and/or Xcode)
npm install
npm run cap:add:android    # once
npm run cap:add:ios        # once, macOS only
npm run cap:assets         # generate native icons & splash from resources/
npm run android            # sync + open Android Studio
npm run ios                # sync + open Xcode
```

See **docs/STORE_SUBMISSION.md** for signing, screenshots and the full App Store / Play Console checklist.

## Native plugins used

`@capacitor/app` (back button) · `@capacitor/share` (packet share sheet) · `@capacitor/filesystem` (write PNG/JSON before sharing) ·
`@capacitor/haptics` · `@capacitor/status-bar` · `@capacitor/splash-screen`. All are optional at runtime — the web build degrades gracefully.

## Code references

NFPA 96 (2024) §4.6 drawings/packet, §5.1 hood coverage, §7.1 duct construction, §7.4.1.1–7.4.3 access openings, §7.8.2.1 hinged upblast fans,
§7.8.3 in-line / sidewall termination, Table 12.4 inspection frequency; IMC 506.3.9 (20 ft horizontal access option). The engine is an aid for field
documentation — the AHJ's adopted code and the listing always govern.

---
DoubleA · AntManThePro · **N**Extended **X**perimental **US**ers · MIT
