# Design: Titanium Timetables

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

## System
- Genre: modern-minimal
- Shape of the first page: app screen
- Theme: brand (vibe: "ruled week, the mark's own blue")
- Axes: light/grotesk/blue · posture: restrained

## Tokens
`apps/web/src/tokens.css` is the source of truth. The roles:
```css
:root {
  --color-paper: oklch(97% 0.008 266);  --color-paper-2: oklch(94.5% 0.01 266);  --color-paper-3: oklch(98.6% 0.006 266);
  --color-ink: oklch(20% 0.02 266);  --color-ink-2: oklch(32% 0.018 266);  --color-muted: oklch(46% 0.016 266);  --color-rule: oklch(86% 0.012 266);
  --color-accent: oklch(39% 0.13 266);  --color-accent-ink: oklch(97% 0.012 266);  --color-focus: oklch(42% 0.18 266);
  --font-display: "DM Sans", ui-sans-serif, system-ui, sans-serif;  --font-body: "DM Sans", ui-sans-serif, system-ui, sans-serif;  --font-outlier: var(--font-body);
  --radius-card: 12px;  --radius-pill: 999px;  --rule-hair: 1px;  --shadow-card: none;
}
```
The spacing scale, the type scale, the easings and the durations are the scaffold's and live in `tokens.css`. Dark mode re-derives the same hue on `html.dark`.

## Controls
- Primary: accent fill, accent ink, 12px radius, 40px
- Secondary: hairline rule, transparent fill, same radius and height

## Motion
- Character: brisk. A screen rises in, a toast drops in, a control lifts on hover and presses down. Transform and opacity only. Under reduced motion everything ends at once.

## Exports
`apps/web/src/tokens.css` in this project. Tailwind names live in `apps/web/tailwind.config.js`.
