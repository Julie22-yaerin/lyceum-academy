# Vendored font

`InstrumentSerif-Regular.ttf` — Instrument Serif, by Rodrigo Fuenzalida and
Jordan Egstad. Downloaded from Google Fonts
(`https://fonts.gstatic.com/s/instrumentserif/`).

Licensed under the SIL Open Font License, Version 1.1, which permits
redistribution and bundling. The full licence text ships with the font's
upstream release at <https://fonts.google.com/specimen/Instrument+Serif/license>
— it could not be fetched from this environment, so it is referenced rather
than copied here.

It is vendored so `scene.html` can `@font-face` it over `file://` while
rendering: the reel's brand mark uses the same serif as the site, and the
renderer must not depend on network access at render time.
