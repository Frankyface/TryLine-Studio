/**
 * Visual system for every graphic. One place to change the look.
 *
 * Canvas sizes are the two Instagram formats the brief asked for. Layout code
 * never hardcodes 1080 - it reads from the size object, so a third format is a
 * data change rather than a rewrite.
 */

export const SIZES = Object.freeze({
  feed: Object.freeze({ id: 'feed', label: 'Feed 1:1', width: 1080, height: 1080, pad: 72 }),
  story: Object.freeze({ id: 'story', label: 'Story 9:16', width: 1080, height: 1920, pad: 84 }),
})

export const SIZE_LIST = Object.freeze(Object.values(SIZES))

/**
 * Story safe area: Instagram overlays its own UI top and bottom. Content that
 * must be readable stays inside this band.
 */
export const STORY_SAFE_TOP = 250
export const STORY_SAFE_BOTTOM = 250

/**
 * inkFaint is a CONTENT colour, not a decorative one - it labels column
 * headings, axis ticks and captions, so it has to be readable, not merely
 * ghosted out. Hairlines use `line`, not inkFaint.
 *
 * These are tuned against the WORST PIXEL A GRAPHIC ACTUALLY DRAWS ON, not
 * against `bg`. Nothing is ever drawn on flat `bg`: drawBackdrop washes
 * bgAlt - bg - bgAlt and lays a 16% accent glow across the middle of the
 * canvas, which is precisely where content sits. Measured against `bg` every
 * value cleared 4.5:1; measured where they land they were 2.93 to 3.52, and
 * that covered twelve separate drawText sites across nine graphics.
 */
export const THEMES = Object.freeze({
  midnight: Object.freeze({
    id: 'midnight',
    label: 'Midnight',
    bg: '#0B1220',
    bgAlt: '#131C2E',
    ink: '#FFFFFF',
    inkMuted: '#B3BED1',
    inkFaint: '#97A0AF',
    line: '#22314C',
    accent: '#25D07A',
    accentInk: '#04180D',
    panel: '#111A2B',
  }),
  turf: Object.freeze({
    id: 'turf',
    label: 'Turf',
    bg: '#0A1F14',
    bgAlt: '#0F2C1C',
    ink: '#FFFFFF',
    inkMuted: '#BAD3C4',
    inkFaint: '#9DB2A5',
    line: '#1D4530',
    accent: '#F5C518',
    accentInk: '#231C00',
    panel: '#0D2718',
  }),
  chalk: Object.freeze({
    id: 'chalk',
    label: 'Chalk',
    bg: '#F4F5F7',
    bgAlt: '#FFFFFF',
    ink: '#0B1220',
    inkMuted: '#3B4557',
    inkFaint: '#535A66',
    line: '#DCE1EA',
    accent: '#0B5FFF',
    accentInk: '#FFFFFF',
    panel: '#FFFFFF',
  }),
  bloodwood: Object.freeze({
    id: 'bloodwood',
    label: 'Bloodwood',
    bg: '#1A0A0E',
    bgAlt: '#2A1016',
    ink: '#FFFFFF',
    inkMuted: '#CFA8B1',
    inkFaint: '#AB8E94',
    line: '#42171F',
    accent: '#FF4D5E',
    accentInk: '#2A0007',
    panel: '#221016',
  }),
  // A second LIGHT theme. Chalk was the only one, so a club posting a run of
  // cards had one bright option and three dark ones to rotate through.
  slate: Object.freeze({
    id: 'slate',
    label: 'Slate',
    bg: '#E7EAF0',
    bgAlt: '#F8FAFC',
    ink: '#0E1526',
    inkMuted: '#333D52',
    inkFaint: '#454E61',
    line: '#CBD3E0',
    // Warm, so a cool grey page does not read as a second Chalk.
    accent: '#A63A00',
    accentInk: '#FFFFFF',
    panel: '#FFFFFF',
  }),
  ocean: Object.freeze({
    id: 'ocean',
    label: 'Ocean',
    bg: '#04161E',
    bgAlt: '#08222E',
    ink: '#FFFFFF',
    inkMuted: '#A9C7D3',
    inkFaint: '#8DAAB6',
    line: '#10394A',
    accent: '#22C1D6',
    accentInk: '#00161B',
    panel: '#071E28',
  }),
  violet: Object.freeze({
    id: 'violet',
    label: 'Violet',
    bg: '#130A20',
    bgAlt: '#1E1132',
    ink: '#FFFFFF',
    inkMuted: '#C0B0DA',
    inkFaint: '#A294BD',
    line: '#311E4D',
    accent: '#B978F5',
    accentInk: '#190630',
    panel: '#190E2A',
  }),
  // Brighter still. The inks on a light theme have to go DARKER than a dark
  // theme's go light: `inkFaint` labels axis ticks and column headings, so it
  // is content and needs 4.5:1 against a near-white page, not a soft grey.
  sunrise: Object.freeze({
    id: 'sunrise',
    label: 'Sunrise',
    bg: '#FFF4E8',
    bgAlt: '#FFFBF5',
    ink: '#2A1608',
    inkMuted: '#5B3A1E',
    inkFaint: '#6A472A',
    line: '#F0DCC4',
    accent: '#C2410C',
    accentInk: '#FFFFFF',
    panel: '#FFFFFF',
  }),
  mint: Object.freeze({
    id: 'mint',
    label: 'Mint',
    bg: '#EEF9F2',
    bgAlt: '#F9FFFB',
    ink: '#0A2318',
    inkMuted: '#245140',
    inkFaint: '#2F5C4A',
    line: '#CFE8DA',
    accent: '#0F766E',
    accentInk: '#FFFFFF',
    panel: '#FFFFFF',
  }),
  sky: Object.freeze({
    id: 'sky',
    label: 'Sky',
    bg: '#EEF4FD',
    bgAlt: '#F9FCFF',
    ink: '#0B1B33',
    inkMuted: '#274264',
    inkFaint: '#324D70',
    line: '#D3E2F5',
    accent: '#1D4ED8',
    accentInk: '#FFFFFF',
    panel: '#FFFFFF',
  }),
})

export const THEME_LIST = Object.freeze(Object.values(THEMES))

/**
 * Display face is condensed so long club names ("Northampton Saints") fit at a
 * readable weight. Both faces are loaded from Google Fonts in index.html.
 */
export const FONTS = Object.freeze({
  display: 'Barlow Condensed',
  body: 'Inter',
  fallback: 'Arial, Helvetica, sans-serif',
})

export const font = (weight, size, family = FONTS.display) =>
  `${weight} ${size}px "${family}", ${FONTS.fallback}`

/** Card colours used by the timeline and team sheet. */
export const CARD_COLORS = Object.freeze({ yellow: '#F5C518', red: '#E5344A' })

/**
 * Scale a design measurement from the 1080-wide reference to the target canvas.
 * Every layout number is written against 1080 and passed through this.
 */
export const scale = (size, value) => Math.round((value * size.width) / 1080)
