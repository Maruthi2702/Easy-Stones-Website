# Easy Stones — Workspace Rules & Guidelines

## 🎨 Mandatory Color Palette & Design System Rules

All new components, features, pages, modals, and style updates MUST strictly follow the canonical color tokens defined in `src/index.css`. Never use arbitrary off-palette dark background hex codes (such as `#1a1a1a`, `#262626`, `#111111`, `#1E1E22`, `rgba(18,20,29,...)`, `rgba(28,35,51,...)`).

### 1. Theme Color Tokens (CSS Variables)

Always prefer CSS variables over hardcoded hex values:

```css
/* Backgrounds */
--bg-primary: #000000;         /* Dark mode page background */
--bg-secondary: #0a0a0a;       /* Dark mode container/sidebar background */
--bg-card: #1c1c1e;            /* Dark mode card, table, modal & popup background */
--glass-background: rgba(0,0,0,0.8);

/* Text */
--text-primary: #ffffff;
--text-secondary: #b0b0b0;
--text-light: #808080;
--text-muted: #606060;

/* Brand Accent (Gold) */
--accent-primary: #d4af37;     /* Main Gold */
--accent-secondary: #c5a028;   /* Dark Gold */
--accent-tertiary: #e6c25e;    /* Light Gold */
--accent-hover: #b3922b;
--accent-glow: rgba(212, 175, 55, 0.3);

/* Borders & Dividers */
--border-color: rgba(255, 255, 255, 0.1); /* Subtle white border for dark cards */
--border-hover: rgba(255, 255, 255, 0.2);

/* Light Theme Overrides (when body.light-theme-active is active) */
body.light-theme-active {
  --bg-primary: #f8fafc;
  --bg-secondary: #f1f5f9;
  --bg-card: #ffffff;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-light: #64748b;
  --text-muted: #94a3b8;
  --border-color: rgba(0, 0, 0, 0.08);
}
```

### 2. Standard Surface Guidelines

- **Cards & Modals (Dark Mode)**: Use `#1c1c1e` background with `border: 1px solid rgba(255, 255, 255, 0.08)` or `var(--border-color)` and `border-radius: 12px` to `18px`.
- **Cards & Modals (Light Mode)**: Use `#ffffff` background with `border: 1px solid rgba(0, 0, 0, 0.08)` or `border: 1px solid #e2e8f0`.
- **Primary Buttons**: Gold gradient (`linear-gradient(135deg, #d4af37, #c5a028)`) with dark text (`#000000` / `#0a0a0a`) and gold focus/glow.
- **Focus States**: Accent ring `0 0 0 3px rgba(212, 175, 55, 0.15)` with `border-color: rgba(212, 175, 55, 0.7)`.

### 3. Verification Checklist for New UI Code
- [ ] Uses `var(--bg-card)` or `#1c1c1e` for card/modal/table backgrounds (Dark theme).
- [ ] Uses `var(--bg-primary)` or `#000000` for main section background (Dark theme).
- [ ] Uses `#d4af37` / `var(--accent-primary)` for brand accents and gold highlights.
- [ ] Light theme overrides provided via `body.light-theme-active` where applicable.
