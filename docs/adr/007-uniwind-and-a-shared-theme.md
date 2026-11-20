# 007: Style mobile with Uniwind on one shared token file

- **Status:** Accepted, 2026-11-18.

## Context

The web app uses Tailwind 4. The mobile app needs the same colours, radii and light and dark modes, and should not grow a second design vocabulary. Writing styles twice, once as CSS classes and once as React Native style objects, lets the two drift and doubles every theme change.

## Decision

- The mobile app styles with **Uniwind**, which compiles Tailwind classes for React Native at build time.
- **`packages/theme/theme.css`** is the one token file: semantic colours for light and dark, radii and the font stack, in the format Uniwind requires and Tailwind on the web reads. No colour or radius is written anywhere else in either app; even the native splash colours are read from it when the Expo config loads.
- A test computes contrast from the token values and fails below WCAG AA for every pair the components use, in both modes.

## Consequences

- Both apps use the same class names (`bg-background`, `text-muted`, `rounded-md`), and a theme change is one edit.
- Tailwind's default palette is cleared, so only the theme's colours exist.
- Some of what Uniwind does with this file is undocumented (a colour declared in both `@theme` and the per-mode blocks, the cleared palette, a theme imported from another package, a CSS font stack). The Metro export shows it builds; whether it renders correctly is part of the first boot on a Mac ([docs/mobile-first-boot.md](../mobile-first-boot.md)).
- A shared UI component package that depends on Uniwind would need Uniwind Pro, so components stay in each app for now.

## Revisit when

- The first boot shows Uniwind does not render the shared file correctly.
- A shared component library across web and mobile becomes worth its cost.
