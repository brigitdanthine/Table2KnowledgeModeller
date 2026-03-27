/**
 * CIDOC CRM official node colour convention.
 *
 * Each entry maps a "anchor class" local name (the part after # or the last /)
 * to its hex colour.  The lookup walks the class's transitive superclasses and
 * returns the colour of the first matching anchor it finds (most-specific wins).
 *
 * Anchor classes are matched by local name so the logic works regardless of
 * whether the ontology uses the cidoc-crm.org URI, the erlangen-crm.org URI, or
 * any other namespace.
 */

// Priority order matters: more specific ancestors should appear BEFORE broader ones.
// E.g. E41_Appellation is a subclass of E90_Symbolic_Object which is a subclass of
// E28_Conceptual_Object – so E41 must come first so its subclasses don't get the
// E28 colour instead.
export const CIDOC_COLOR_ANCHORS = [
  // ── Specific first ────────────────────────────────────────────────────────
  { localName: 'E18_Physical_Thing',          color: '#c78e66', textColor: '#1a0e05' },
  { localName: 'E2_Temporal_Entity',          color: '#82ddff', textColor: '#002233' },
  { localName: 'E39_Actor',                   color: '#ffbdca', textColor: '#2a0008' },
  { localName: 'E41_Appellation',             color: '#fef3ba', textColor: '#2a2000' },
  { localName: 'E52_Time-Span',               color: '#86bcc8', textColor: '#001a20' },
  { localName: 'E53_Place',                   color: '#94cc7d', textColor: '#0a2000' },
  { localName: 'E54_Dimension',               color: '#b8b8b8', textColor: '#1a1a1a' },
  { localName: 'E55_Type',                    color: '#fab565', textColor: '#2a1000' },  // E_Type = E55
  { localName: 'E56_Language',                color: '#fab565', textColor: '#2a1000' },  // subclass of E55
  { localName: 'E57_Material',                color: '#fab565', textColor: '#2a1000' },
  { localName: 'E58_Measurement_Unit',        color: '#fab565', textColor: '#2a1000' },
  { localName: 'E59_Primitive_Value',         color: '#f0f0f0', textColor: '#1a1a1a' },
  { localName: 'E28_Conceptual_Object',       color: '#fddc34', textColor: '#1a1500' },
  { localName: 'E92_Spacetime_Volume',        color: '#cc80ff', textColor: '#1a0033' },
  // ── Fallback: also match variant spellings / older CRM versions ───────────
  { localName: 'E18_PhysicalThing',           color: '#c78e66', textColor: '#1a0e05' },
  { localName: 'E2_TemporalEntity',           color: '#82ddff', textColor: '#002233' },
  { localName: 'E28_ConceptualObject',        color: '#fddc34', textColor: '#1a1500' },
  { localName: 'E39_Actor',                   color: '#ffbdca', textColor: '#2a0008' },
  { localName: 'E41_Appellation',             color: '#fef3ba', textColor: '#2a2000' },
  { localName: 'E52_TimeSpan',                color: '#86bcc8', textColor: '#001a20' },
  { localName: 'E53_Place',                   color: '#94cc7d', textColor: '#0a2000' },
  { localName: 'E54_Dimension',               color: '#b8b8b8', textColor: '#1a1a1a' },
  { localName: 'E59_PrimitiveValue',          color: '#f0f0f0', textColor: '#1a1a1a' },
  { localName: 'E92_SpacetimeVolume',         color: '#cc80ff', textColor: '#1a0033' },
]

// Default for anything that doesn't match
export const CIDOC_DEFAULT_COLOR     = '#ffffff'
export const CIDOC_DEFAULT_TEXT      = '#1a1a1a'
export const CIDOC_PROPERTY_COLOR    = '#a8326a'   // edge colour (berry theme)

/**
 * Extract the local name from a full URI.
 * Handles both # and / separators, and also returns the full thing if neither.
 */
function localName(uri) {
  if (!uri) return ''
  const hashIdx  = uri.lastIndexOf('#')
  const slashIdx = uri.lastIndexOf('/')
  const idx = Math.max(hashIdx, slashIdx)
  return idx >= 0 ? uri.slice(idx + 1) : uri
}

/**
 * Normalise a local name for fuzzy matching:
 * lower-case, strip underscores and hyphens, collapse spaces.
 */
function normalise(s) {
  return s.toLowerCase().replace(/[_\-\s]/g, '')
}

/**
 * Return { color, textColor } for a given class URI, given the transitive
 * superclass URI list (strings) from the backend.
 *
 * Algorithm:
 *  1. Build the full set: { uri } ∪ superclassUris
 *  2. For each anchor (in priority order), check if any member of the set
 *     matches the anchor's local name (normalised).
 *  3. Return the first match, or the default colour.
 */
export function resolveColor(uri, superclassUris = []) {
  const allUris = [uri, ...(superclassUris || [])]
  const localNames = allUris.map(u => normalise(localName(u)))

  for (const anchor of CIDOC_COLOR_ANCHORS) {
    const anchorNorm = normalise(anchor.localName)
    if (localNames.some(ln => ln === anchorNorm)) {
      return { color: anchor.color, textColor: anchor.textColor }
    }
  }
  return { color: CIDOC_DEFAULT_COLOR, textColor: CIDOC_DEFAULT_TEXT }
}

/**
 * Determine a readable foreground colour for a given background hex.
 * Falls back to black/white if the supplied textColor is not suitable.
 */
export function contrastText(bgHex) {
  const hex = bgHex.replace('#', '')
  const r = parseInt(hex.slice(0,2), 16)
  const g = parseInt(hex.slice(2,4), 16)
  const b = parseInt(hex.slice(4,6), 16)
  // WCAG relative luminance approximation
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#1a1a1a' : '#ffffff'
}
