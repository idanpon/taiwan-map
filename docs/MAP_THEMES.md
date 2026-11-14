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
attribution control kept expanded in both layouts. The credits sit flush with
the bottom-left safe edge of the map and use 10 px text at default scaling.
Both right corners have the same radius. In portrait standalone mode, the
label can use up to 6 px of the bottom inset, retaining at least 28 px when
the system inset is large enough. The same offset determines the clearance
under a place sheet when the credits need to stay visible.
The primary style credits OpenMapTiles and OpenStreetMap, with both links also
available in Help under «Данные карты и лицензии». On compact screens, a place
sheet opened by interacting with the map or list covers the primary credits in
place. A place opened directly from a link leaves the credits visible beneath
the sheet on initial load. The reserve style uses standard OSM raster tiles.
Its credits always stay visible beneath the sheet at the same coordinates.
[OpenFreeMap attribution](https://openfreemap.org/#attribution) ·
[OSMF attribution guidelines](https://osmfoundation.org/wiki/Attribution_Guidelines#Interactive_maps) ·
[OSM raster tile policy](https://operations.osmfoundation.org/policies/tiles/#2-attribution-and-licensing)

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

Below zoom 10 the map shows city groups with a count. Their circles are 45 px
across, compared with 40 px for individual place markers. Both use a 2 px border.

## Lodging on the map

The private catalog returns `has_stay` for places linked as lodging to a
non-cancelled stay. The lodging category uses a muted rose-red (`#b66d7b`) with its existing bed icon.
The map adds a 1 px coral ring with a soft static halo and a 3 px gap around
the existing marker. The ring is `#c8505a` in light and `#e36a74` in dark.
The status badge and category icon use their usual appearance, including
dimmed status markers. City clusters
continue to show place counts. The anonymous projection omits `has_stay`.
[Planning rules](PLANNING.md#проживание).

## Marker overlap

When individual markers overlap, the map stacks them from highest to lowest:
confirmed lodging, want to visit, undecided, no status, and already visited.
Lodging without a linked non-cancelled stay uses its usual status priority.
Markers of equal priority keep catalog order. Selection, hover, and keyboard
focus still raise a marker above the default layers. The public map stacks
markers by status using the fields available in the anonymous catalog.

## Desktop places panel

Drag the right edge to resize the panel to 80–150% of its standard width at
the current breakpoint. Drag the divider above the results to resize the
filters to 25–70% of the panel height. Short windows lower the upper limit
to leave space for results. Tab focuses each divider. The arrow keys adjust
its size, and Home and End move it to either limit. Double-click a divider or
press Enter while it is focused to reset that dimension to its default.

By default, filters occupy up to 60% of the panel height. The compact results
and the filters scroll independently. Dimensions live in the page until
reload. At widths up to 1000 px, the list and filters share one scroll area
and the dividers are hidden.

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

## Place-card camera transitions

Opening a place uses one 300ms MapLibre easeTo with an absolute geographic
target. The offset uses the layout size of the sheet so the entry animation
does not affect framing.
Desktop cards reserve the right-hand strip, mobile cards the bottom strip.
Closing with the cross, outside click or Escape eases the same place to the
full map centre without changing zoom or bearing. Repeated or interrupted
transitions replace the target instead of adding pan deltas. MapLibre honours
prefers-reduced-motion; data and style loading remain independent of framing.
Links from the Plan use the same selection and framing on first load. The
basemap starts before the map applies any queued camera focus.

## Quick actions on mobile

Holding a place marker for 425 ms reveals a blue glow for opening the place
in Google Maps and a green glow for marking it visited. The upward swipe and
card button open the same destination. Google Maps searches by name and
address when available, or drops a pin at the saved coordinates. On iOS the
swipe first uses Google's app link. If the map is still visible after 1.5 s,
it navigates to the HTTPS version in the current window. When the map goes
into the background, the pending fallback is cancelled. Other platforms
open the HTTPS link immediately. Editors and admins get the visit action
for places they have yet to mark. A short tap opens the place card.
Moving before the hold threshold pans the map.

Release outside a 28 px radius in the top or bottom 120° sector to act.
Releasing within 28 px of the marker or toward either side dismisses the hints.
The glow fades in, with its brightest point near the marker and a gradual
falloff toward the outer edge. The light theme uses muted blue and green tints.
The chosen glow brightens and extends from 36 to 41.4 px. The visit action
uses the same version check and open-decision guard as the place card and
offers a rating after a successful change.

## Mobile place-card dismissal

The place card uses the shared bottom sheet and `public/sheet-swipe.js`.
A touch pull can start in the heading at any scroll position, or in the body
when it is at the top. A short or cancelled pull returns to the original
position. A complete pull follows the same dirty and busy checks as the
close button. A tap outside must start and finish outside the sheet.
Fields, links, text selection and scrolling keep their native behaviour.
[Overlay rules](DESIGN_SYSTEM.md#карточки-и-системные-окна)

## Initial framing and compact card details

The initial map view uses the same fit-to-places operation as “Все на карте”,
once both the map engine and places are ready. Later data refreshes, theme
changes and filtering do not reset a manually positioned camera. Explicit
focus, geolocation or fit requests take priority over initial framing.
Mobile opens the map; the places/filter panel is opened explicitly.

English and local names and the address are individually copyable. Temporary
copy feedback clears automatically; keyboard focus remains accessible. Additional
source links start collapsed, with the Google Maps action kept visible.

## Light clarity

The map, calendar and shared screens use semantic tokens and common buttons,
fields, chips, selection rows and panel surfaces. Floating map buttons use
the regular button fill and border, with the floating shadow above the tiles.
See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the component contract and gallery.

“Light layer” applies the same static panel gradient to place details and
shared dialogs as to planning cards. Dark surfaces are slightly darker behind
left-aligned text. Light surfaces stay almost white there and shade subtly
toward the right. Buttons use flat fills and a small shadow for raised actions.
Hover and press apply the same neutral tint from each control's resting fill.
Planning links use shared state badges, and a successful place save uses the
same green confirmation as completing a planning item. Category and user-defined
status colors remain data-owned. Light surfaces use warm milk and sand tones
that fit the beige basemap. The dark page uses `#141d24`, shared with the
browser theme color.

Above 1000 px the card sits flush with the bottom of the map and aligns with
the right edge of the toolbar. Its width scales between 380 and 480 px. The
card ends below the map controls. In short windows the zoom buttons move to
the left of the card to leave more height for reading. The card enters from
below in 220 ms with a quick start and a gradual stop, or appears immediately
with reduced motion. Its body scrolls independently. The camera centres the selected pin in the exposed
map to the left. The compact sheet leaves at least 8 px at each side and
pads its contents above the bottom safe area.
The zoom pair has a single rounded boundary, one shadow and one inner divider.
Its flat buttons and the other map controls share the app's press and hover feedback. Closing a
place sheet by touch leaves the map controls without a focus outline.
Keyboard dismissal restores focus.

The detail form labels its existing save request as busy, keeps an inline error
next to the save action and clears it on the next attempt. The existing version
conflict refresh retains the note and tag draft and now shows an inline prompt
to review and save again. Theme changes keep the same form DOM and draft.
