# ₿ Bitcoin 16:00 Fix Analyzer


> **The ideal price for trading is determined by the movement of the 24-position strikes.**
> **Bitcoin 16:00 Fix — New York time reference.**

A lightweight, browser-only analytical dashboard that studies how the live Bitcoin price
behaves relative to the **previous day's 16:00 New York fixing** — the institutional
reference price published by the CME Group and used to settle Bitcoin futures and compute
the NAV of spot Bitcoin ETFs.

The tool automatically derives a ladder of trading levels at **±0.25%, ±0.50%, ±0.75% and
±1.00%** around that fix, highlights the ones already reached by the spot price, and plots
two charts: the live BTC/USD spot movement over the last 24 hours, and the intraday
percentage delta versus the previous day's fixing.


---

## ✨ Features

- **Live BTC/USD price** refreshed every **5 seconds**
- **Previous day's 16:00 New York fix** automatically extracted from historical data
- **Automatic trading-level ladder** derived from the fix:
  - `FIX`
  - `+0.25% · +0.50% · +0.75% · +1.00%`
  - `-0.25% · -0.50% · -0.75% · -1.00%`
- **Real-time "reached" highlighting** — levels already touched by the spot price are marked in amber
- **Three key metrics** displayed at the top:
  - `Average · 24h`
  - `Difference from Fix`
  - `Range · 24h`
- **Two interactive Chart.js charts**:
  - Spot price — last 24 hours (line, blue gradient)
  - Daily Delta vs previous 16:00 NY Fix — percentage difference (bar, green/red)
- **Four pages**: Home · About · FAQ · Contact (hash-based routing, no framework)
- **Fully responsive** — mobile-first layout, adaptive grid and charts
- **Light, professional fintech design** — Inter font, soft shadows, blue accent
- **No build step** — pure HTML + CSS + JavaScript, runs in any modern browser
- **No backend** — 100% client-side, works as a static site (GitHub Pages ready)

---

## 🖼 Screenshots

https://albertosassetti6-byte.github.io/Bitcoin-16-00-Fix-Analyzer/#home



---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Markup | ![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white) |
| Styling | ![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white) |
| Logic | ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black) |
| Charts | ![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?logo=chartdotjs&logoColor=white) |
| Icons | ![Font Awesome](https://img.shields.io/badge/Font%20Awesome-528DD7?logo=fontawesome&logoColor=white) |
| Fonts | ![Google Fonts](https://img.shields.io/badge/Google%20Fonts-4285F4?logo=googlefonts&logoColor=white) |
| Data | ![Bitcoin](https://img.shields.io/badge/Bitcoin-F7931A?logo=bitcoin&logoColor=white) |

No npm, no bundler, no framework. Everything runs directly in the browser.

---

https://albertosassetti6-byte.github.io/Bitcoin-16-00-Fix-Analyzer/#home



