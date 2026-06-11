# Agent Notes

## Site visual comparison

When reviewing a local site change against production, use the toolchain viewer:

```sh
site compare /route/to/check/ --no-open
```

Then open the printed localhost URL with the available browser automation tool.
Do not build an ad hoc iframe page or open two unrelated browser tabs. The
viewer provides labeled DEV/LIVE panes, a draggable synchronized divider,
linked scrolling, route navigation, reload, side swapping, and direct links.

The Astro development server must be running separately with `site dev` unless
the requested development URL is already available.
