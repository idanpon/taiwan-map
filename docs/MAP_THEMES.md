# MapLibre, themes and provider fallback

The browser uses MapLibre GL JS **6.15.0** directly. Its official npm archive
was checked against the registry's SHA-512 integrity value. The unchanged
standalone ES module, module worker, stylesheet and licence are vendored under
`public/vendor/maplibre-6.15.0/` (the modules use `.js` extensions for the
existing static server's JavaScript MIME type). `manifest.json` records their
SHA-256 hashes; Pages refuses to build if they differ. There is no Leaflet,
bridge, CDN script, runtime `latest`, extra API or tile server.

`public/map-config.js` contains the Bright/Fiord URLs, same-origin worker path,
OSM reserve URL and failure thresholds. Provider styles are used unchanged.
MapLibre reads attribution from the providers' source metadata, with the
attribution control kept expanded in both layouts. The reserve style is local
and has only standard OSM raster tiles and attribution.

`theme-init.js` is a small, blocking head script before all CSS. It selects a
stored light/dark preference or the system preference and applies color-scheme
and the browser theme color before the body renders. `theme.js` synchronizes
the login and app theme buttons. System changes apply until a manual choice is
made. Storage failures do not disable the controls. Shared CSS variables cover
the login, panels, dialogs, forms, markers' tooltips and map controls. Category
and status colors/symbols/opacity remain data-owned; text contrast can use a
neutral foreground without changing the stored semantic color.

## State boundaries

The app owns places, filters, selected place and forms independently of styles.
`map-view.js` owns a single MapLibre instance, DOM markers and synthetic user
accuracy geometry. `setStyle` retains the camera explicitly; DOM markers and
the user marker persist, and the accuracy source/layers are restored on
`style.load`. Theme/provider changes do not call `load`, rebuild forms or
reload the page. Without MapLibre/WebGL, the list and Google Maps links remain
available; mobile keeps the map view with an explicit action to open the list.

## Failure decisions

`basemap.js` observes actual Style, Source (TileJSON) and Tile requests with a
scoped MapLibre protocol. It returns original response cache-control/expiry/
ETag metadata, uses normal browser HTTP caching and sends the page's Referer.
Sprite and glyph errors never count toward provider failure. No reserve tiles
or health polling are requested during healthy primary use.

Defaults: request timeout 8 s; initial loading deadline 18 s; four distinct
failed relevant URLs in 20 s, with a 4 s grace period without a successful tile.
Initial style or TileJSON failures get at most three style attempts, separated by
1.5 s, and must have failed at least twice before the loading deadline can
trigger fallback. A failed same-origin network check reports connection loss
instead of proving that a tile provider is down. Offline/background time and
errors do not count toward a decision; interrupted initial work can restart
when the page becomes active again.

Fallback latches to OSM inside the same renderer. It never retries the primary
automatically. A manual retry preflights the selected primary style, TileJSON
and one tile in the current view while keeping the existing reserve intact.
An unsuccessful preflight never replaces it. A successful preflight changes
the style; a later failure returns to the reserve. A five-second button
cooldown prevents rapid duplicate attempts; it performs no network polling.
If the reserve also fails, show the error/list action and stop switching.

OSM remains light under a dark interface. Theme changes in reserve mode only
update the saved theme; a successful restoration uses the selected Bright or
Fiord. No offline-area downloads, cache bypass, background OSM prefetch or
extra rendering engine are provided.

## Build and security

Pages emits relative, cache-versioned app/helper/initial-theme files and the
versioned vendor directory. The module worker has an explicit same-origin URL.
CSP permits same-origin workers, provider connections and image blobs; no
`unsafe-eval` or blob workers are needed. Referrer-Policy remains
`strict-origin-when-cross-origin`. The API, database, account logic and VPS
configuration are unchanged; publishing requires only the existing Pages job.

## Verification

Node tests exercise healthy/no-reserve traffic, isolated/repeated tile errors,
ignored sprite/glyph errors, bounded initial failure, late provider failure,
offline/background suspension, connectivity loss, failed and successful manual
restoration, both providers failing, theme persistence/storage denial and
geolocation geometry. The local browser QA proxy injects faults against a
synthetic account/database, leaving production data untouched. It also provides
one synthetic location to test the normal geolocation UI without obtaining the
user's real location. Browser/device GPS permissions and performance on older
physical phones require a real-device check.

Sources: [OpenFreeMap quick start](https://openfreemap.org/quick_start/),
[MapLibre installation/CSP](https://maplibre.org/maplibre-gl-js/docs/),
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).
