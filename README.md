# Matti Run

Moderner Snake-Klon im Browser: Dalmatiner **Matti** sammelt Leckerlis im Park.

**Spielen:** https://alexhellen.github.io/MattiRun/

## Twist gegenüber Snake

- **Flecken als Hindernis**: bei jedem 3. Leckerli verliert Matti einen Fleck am Schwanzende, der liegen bleibt.
- **Combo**: Leckerli innerhalb von 3 s nach dem letzten → Multiplikator bis ×5.
- **Goldener Knochen**: taucht ab und zu auf, verschwindet nach 6 s; 50 Punkte × Combo, räumt 3 Flecken weg.
- **Tages-Lauf**: Seed = heutiges Datum, Rekord pro Tag. **Frei**: zufälliger Seed.
- Tempo steigt mit jedem Leckerli.

## Steuerung

| Aktion | Desktop | Mobil |
|---|---|---|
| Laufen | Pfeiltasten / WASD | Wischen |
| Start / Neustart | Enter | Button |
| Pause | Leertaste / P / Esc | – |
| Ton | M | Button |

## Lokal starten

Keine Dependencies, kein Build:

```bash
python -m http.server 8000   # dann http://localhost:8000
```

`index.html` direkt öffnen geht auch.

## Struktur

- `index.html` – Markup, HUD, Overlay
- `style.css` – Layout & Farben
- `game.js` – Spiellogik (Fixed-Timestep, Interpolation), Canvas-Rendering, WebAudio-SFX, Input

## Ideen / Roadmap

- [x] GitHub Pages Deployment (Branch `main`, Root)
- [ ] Power-ups (Ball = Zeitlupe, Eichhörnchen als bewegliches Ziel)
- [ ] Online-Leaderboard für den Tages-Lauf
- [ ] Skins (Leine, Halsband-Farben), Level mit festen Hindernissen
