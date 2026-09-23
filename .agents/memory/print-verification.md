---
name: Japanese print verification
description: Valid PDF bytes and text do not prove that Japanese glyphs render
---

Validate Japanese print output visually, not only by checking PDF headers,
file size, or DOM text.

**Why:** A browser test can pass with correct Japanese strings and a valid PDF
while every Japanese glyph is rendered as a square because the print document
has no usable font. The app page and its separate print document do not
necessarily share loaded fonts.

**How to apply:** Inspect a rendered print-page image containing Japanese.
Verify font readiness before printing, including delayed/failing font loads and
permission expiry while waiting. Keep real-device/printer verification distinct
from browser-generated PDF tests.

The same check is needed for Japanese headless-browser screenshots. A passing
DOM assertion can coexist with square glyphs. Font assets must be locally
available when the browser is forbidden from making external requests; merely
naming a Japanese font in CSS does not prove that it is installed or loaded.