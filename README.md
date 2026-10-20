# Matti Run

Moderner Snake-Klon im Browser: der schwarze Hund **Matti** sammelt Leckerlis im Park, seine Leine wird mit jedem Leckerli länger.

**Spielen:** https://alexhellen.github.io/MattiRun/

## Twist gegenüber Snake

- **Leine statt Schwanz**: jedes Leckerli verlängert Matti's Leine; wer in die eigene Leine läuft, verheddert sich.
- **Häufchen als Hindernis**: nach jedem 3. Leckerli macht Matti hinter sich ein Häufchen, das liegen bleibt.
- **Combo**: Leckerli innerhalb von 3 s nach dem letzten → Multiplikator bis ×5.
- **Sonder-Items** (höchstens eins gleichzeitig, verschwinden nach 6 s):
  - **Kotbeutel** – 50 Punkte, räumt 3 Haufen weg
  - **Tennisball** – 30 Punkte, 5 s Sprint: schneller, Leckerlis zählen doppelt
  - **Stock** – 20 Punkte, Leine 2 Felder kürzer
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
- `assets/` – Hunde-Sprites (Seite ohne Beine, Rücken, Front), aus einem KI-generierten Charakterblatt (MAI-Image-2.6) freigestellt; die Beine der Seitenansicht werden zur Laufzeit gezeichnet

## Ideen / Roadmap

- [x] GitHub Pages Deployment (Branch `main`, Root)
- [x] Power-ups: Kotbeutel, Tennisball, Stock
- [ ] Eichhörnchen als bewegliches Ziel
- [x] Lauf-Animation (Trab, prozedurale Beine)
- [ ] Online-Leaderboard für den Tages-Lauf
- [ ] Skins (Leine, Halsband-Farben), Level mit festen Hindernissen
