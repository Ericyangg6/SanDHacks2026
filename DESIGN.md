---
name: Shade
description: Clear liquid glass over a pale blue water chart, for finding cool air fast.
colors:
  blue: "#0369a1"
  blue-hover: "#075985"
  zone: "#0b74c9"
  zone-tint: "#cfe8fb"
  cool: "#7fe3f2"
  heat: "#f4a765"
  heat-ink: "#2a1806"
  ink: "#0b2540"
  ink-2: "#3f5872"
  paper: "#eaf5fd"
  card: "#fbfdff"
  ground: "#d6eaf8"
  peach: "#f6d3b8"
  sky: "#c9eef4"
  danger: "#b3261e"
  aqi-good: "#a5d68f"
  aqi-moderate: "#ecd670"
  aqi-sensitive: "#f4a765"
  aqi-unhealthy: "#ee7a66"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "46px"
    fontWeight: 200
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 300
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 500
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Red Hat Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.01em"
rounded:
  chip: "8px"
  inset: "14px"
  panel: "24px"
  pill: "999px"
spacing:
  row-y: "13px"
  panel-x: "22px"
  gap: "16px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
  segment-selected:
    backgroundColor: "{colors.blue}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "5px 13px"
  chip-need:
    backgroundColor: "rgba(255, 255, 255, .6)"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  token-zone:
    backgroundColor: "{colors.zone}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    size: "34px"
  token-request:
    backgroundColor: "{colors.heat}"
    textColor: "{colors.heat-ink}"
    rounded: "{rounded.pill}"
    size: "30px"
  resident-action:
    backgroundColor: "{colors.blue}"
    textColor: "#ffffff"
    rounded: "16px"
    height: "56px"
---

# Design System: Shade

## Overview

**Creative North Star: "The Water Chart"**

A pale blue chart of the county fills the room. Clear glass instruments rest on it and bend the map beneath them. The map is the workspace and never recedes behind chrome. Staff read the county through liquid glass panels with dark navy type. Residents get the same chart under opaque white cards, large and plain enough to use one-handed in sunlight.

The look is blue, white, and watery, with a material modeled on Apple's Liquid Glass.

**Key Characteristics:**
- Full-bleed map; panels float on it.
- Two surface families, one per audience: liquid glass for staff, opaque white cards for residents.
- Round tokens carry meaning on the map: a blue asterisk is a cool zone, orange is a person asking for help, cyan is help on the way.
- Thin, large numerals for readings; small mono for codes, times, and labels.

## Colors

White and water-blue neutrals. Orange is the only warm signal.

### Primary
- **Deep Water** (blue): actions, selection, focus rings, routes, load bars.

### Secondary
- **Zone Blue** (zone): cool zone tokens and the brand mark. **Zone Tint** (zone-tint) is its pale form for resident chips.
- **Relief Cyan** (cool): help incoming.
- **Ember Orange** (heat): a person requesting help.

### Tertiary
- **Alarm Red** (danger): the resident "Call 911" bar only.
- **AQI ramp** (aqi-good to aqi-unhealthy): AQI chips only, always with the number inside. The "sensitive" step shares the Ember Orange hex.

### Neutral
- **Navy Ink / Ink 2**: primary and secondary text, on glass and on cards.
- **Chart Paper / Card / Ground**: map ground, resident cards, page background.
- **Peach, Sky**: resident chips and notices.

**The One Meaning Rule.** Outside an AQI chip, orange means a person is requesting help. Actions are blue.

## Typography

**Display and Body Font:** Hanken Grotesk (with system-ui)
**Label/Mono Font:** Red Hat Mono

**Character:** One quiet grotesk at many weights, thin when large and medium when small. Its numeral 1 is unmistakable, which matters on a readings panel.

### Hierarchy
- **Display** (200, 46px, 1.05): headline readings.
- **Headline** (300, 20px): panel titles.
- **Title** (500, 14.5px): row names.
- **Body** (400, 14px staff, 17px resident, 1.45).
- **Label** (mono, 12-13px): zip codes, clock, mock-data tag, bus times.

**The Tabular Rule.** All figures use tabular numerals so columns of readings line up.

## Layout

Staff: fixed full-viewport map; a top bar of pills at 16px inset; two side panels (340px left, 368px right) from 84px down. Below 1000px the map takes 58vh and panels stack beneath it. Resident: single column, max 480px, sticky map (44vh) with the card sheet overlapping it by 22px and a fixed 911 bar at the bottom.

## Elevation & Depth

Depth is material.

- **Staff glass:** a white-to-pale-blue gradient at 38-62% opacity, with `backdrop-filter` blur, 190% saturation, and a slight brightness lift. A 1px white border, a bright top inner edge, and a soft inner glow form the rim. A `::before` layer adds a specular sweep from the top-left and a cool caustic at the bottom-right. One blue-tinted drop shadow.
- **Refraction:** Chromium adds an SVG displacement filter (`#liquid`) to the backdrop. Other browsers fall back to plain blur.
- **Reduced transparency:** `prefers-reduced-transparency: reduce` swaps the glass for opaque `#f4faff`.
- **Resident cards:** opaque white with a soft upward shadow. Only the two top map pills use glass.
- **Map:** USGS topo tiles, recolored to blue and white with a CSS filter, under a fine blue survey grid.
- **Map tokens:** a white ring plus a small blue-grey shadow. No colored glows.

## Shapes

Everything is round or pill-shaped: 24px panels, full pills for bars, buttons, chips, and segments, circles for map tokens. The map carries a fine square survey grid as its only straight-line ornament.

## Components

### Buttons
- **Primary:** Deep Water pill, 36px tall, white text. Hover darkens; press scales to 0.97.
- **Resident actions:** 56px tall, 16px radius, Deep Water filled or 1.5px Navy Ink outlined.

### Segmented control
- Pill track at 10% blue. The selected segment is Deep Water with white text. Request status segments take their status color when selected (orange Requesting, cyan Incoming).

### Chips
- Needs chips: 60% white pills. "Told to call 911": solid aqi-unhealthy with dark text. AQI chips: ramp color with the number.

### Panels and rows
- Panels have no padding of their own. Rows carry 13px by 22px and are separated by 13% blue hairlines. Selected and hovered rows get a 40% white wash.

### Map tokens
- Cool zone: 34px Zone Blue disc with a white six-arm asterisk. Discovered sites: white disc with a Zone Blue ring. Closed: blue-grey.
- Help request: 30px orange disc with an expanding ring while Requesting; cyan and still when Incoming. "!" inside when the caller was told to call 911.
- Handled calls: 9px navy dots.
- Routes: white casing (8px staff, 9px resident) under a Deep Water line (3.5px staff, 4px resident), dotted for walking.

## Do's and Don'ts

### Do:
- **Do** keep the map visible behind and between panels.
- **Do** keep text on glass at Navy Ink or Ink 2; check contrast where the map shows through.
- **Do** pair every status color with a word or number.
- **Do** label mock data wherever it appears.
- **Do** keep resident tap targets at 56px or taller.

### Don't:
- **Don't** use orange for anything but a person requesting help, except inside an AQI chip.
- **Don't** put glass on resident cards; they must stay readable in sunlight.
- **Don't** add colored glow shadows or violet.
- **Don't** show a caller's name or phone number; location and stated needs only.
- **Don't** present a discovered site the same way as an official one.
