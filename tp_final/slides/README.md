# Chismoso: presentación

A reveal.js deck (about 5 minutes, in Spanish) for presenting Chismoso. It is fully self-contained in this directory and shares no code, config or dependencies with the app.

```bash
cd slides
npm install
npm run dev        # http://127.0.0.1:4300
```

The port is fixed (`strictPort`) so it never contends with the app stack (3000, 5173, 5433, 8080). If 4300 is busy, Vite fails instead of picking another port.

- `→` / `Space` advances, including the step-by-step fragments on the diagrams.
- `S` opens the speaker view with notes and a timer. `F` goes fullscreen and `Esc` shows the overview.
- `npm run build` writes a static copy to `dist/`, which `npm run preview` serves on the same port.

Files: `index.html` (slides, SVG diagrams and notes), `style.css` (theme, with colors copied from the app's palette) and `main.js` (reveal.js setup).
