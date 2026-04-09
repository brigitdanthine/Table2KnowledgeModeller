/**
 * graphml.js – GraphML export + Mapping TSV export  (v6)
 *
 * Fixes v6:
 *  - Split joinColumn into joinColumnSource + joinColumnTarget for explicit 2-key joins
 *  - Backward compat: old edge.data.joinColumn is treated as joinColumnTarget
 *  - GraphML uses e_join_src + e_join_tgt attributes
 *
 * Fixes v5:
 *  - Issue 1: Case B JOIN deduplicates output rows (same domain+range pair → skip)
 *  - Issue 2: If src.joinColumn is set in Case B, use tgtRow[joinColumn] as domainId
 *             instead of srcRow[srcMappedColumn]. This solves the case where
 *             the FK in the range table carries the domain's identity
 *             (e.g. Funde.ID_Schicht is the real ID for A8_Stratigraphic_Unit).
 *  - All prior fixes (empty rangeId skipped, Case Cy auto-detect FK col, etc.)
 */

// ─── GraphML ──────────────────────────────────────────────────────────────────

export function exportGraphML(nodes, edges) {
  // Helper to convert hex color to yEd-friendly format
  const yEdColor = (hex) => {
    if (!hex || hex === '#ffffff') return '#CCCCCC'
    return hex.toUpperCase()
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/graphml"',
    '         xmlns:java="http://www.yworks.com/xml/yfiles-common/1.0/java"',
    '         xmlns:sys="http://www.yworks.com/xml/yfiles-common/markup/primitives/2.0"',
    '         xmlns:x="http://www.yworks.com/xml/yfiles-common/markup/2.0"',
    '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '         xmlns:y="http://www.yworks.com/xml/graphml"',
    '         xmlns:yed="http://www.yworks.com/xml/yed/3"',
    '         xsi:schemaLocation="http://graphml.graphdrawing.org/graphml',
    '           http://www.yworks.com/xml/schema/graphml/1.1/ygraphml.xsd">',
    '',
    '  <key for="node" id="d_yed" yfiles.type="nodegraphics"/>',
    '  <key for="edge" id="e_yed" yfiles.type="edgegraphics"/>',
    '  <key id="d_label"        for="node" attr.name="label"           attr.type="string"/>',
    '  <key id="d_uri"          for="node" attr.name="uri"             attr.type="string"/>',
    '  <key id="d_instance"     for="node" attr.name="instance_label"  attr.type="string"/>',
    '  <key id="d_column"       for="node" attr.name="mapped_column"   attr.type="string"/>',
    '  <key id="d_label_column" for="node" attr.name="label_column"    attr.type="string"/>',
    '  <key id="d_color"        for="node" attr.name="node_color"      attr.type="string"/>',
    '  <key id="d_noprefix"     for="node" attr.name="no_prefix"       attr.type="boolean"/>',
    '  <key id="d_x"            for="node" attr.name="x"               attr.type="double"/>',
    '  <key id="d_y"            for="node" attr.name="y"               attr.type="double"/>',
    '  <key id="e_label"        for="edge" attr.name="label"           attr.type="string"/>',
    '  <key id="e_uri"          for="edge" attr.name="property_uri"    attr.type="string"/>',
    '  <key id="e_join_src"     for="edge" attr.name="join_column_source" attr.type="string"/>',
    '  <key id="e_join_tgt"     for="edge" attr.name="join_column_target" attr.type="string"/>',
    '  <key id="e_dotone"       for="edge" attr.name="dot_one_prop"    attr.type="string"/>',
    '  <key id="e_dotone_uri"   for="edge" attr.name="dot_one_uri"     attr.type="string"/>',
    '  <key id="e_dotone_node"  for="edge" attr.name="dot_one_node_id" attr.type="string"/>',
    '',
    '  <graph id="G" edgedefault="directed">',
  ]

  // Export only real ontology nodes (skip dotOneMidpoint internal helpers)
  for (const node of nodes) {
    if (node.type === 'dotOneMidpoint') continue
    const d = node.data || {}
    const label = d.label || node.id
    const color = yEdColor(d.nodeColor)
    const px = node.position?.x ?? 0
    const py = node.position?.y ?? 0
    lines.push(`    <node id="${escXml(node.id)}">`)
    lines.push(`      <data key="d_yed">`)
    lines.push(`        <y:ShapeNode>`)
    lines.push(`          <y:Geometry height="40" width="${Math.max(80, label.length * 8 + 20)}" x="${px}" y="${py}"/>`)
    lines.push(`          <y:Fill color="${color}" transparent="false"/>`)
    lines.push(`          <y:BorderStyle color="#666666" raised="false" type="line" width="1.0"/>`)
    lines.push(`          <y:NodeLabel alignment="center" autoSizePolicy="content" fontFamily="Dialog" fontSize="12" fontStyle="plain" hasBackgroundColor="false" hasLineColor="false" modelName="custom" textColor="#000000" visible="true">${escXml(label)}<y:LabelModel><y:SmartNodeLabelModel distance="4.0"/></y:LabelModel><y:ModelParameter><y:SmartNodeLabelModelParameter labelRatioX="0.0" labelRatioY="0.0" nodeRatioX="0.0" nodeRatioY="0.0" offsetX="0.0" offsetY="0.0" upX="0.0" upY="-1.0"/></y:ModelParameter></y:NodeLabel>`)
    lines.push(`          <y:Shape type="roundrectangle"/>`)
    lines.push(`        </y:ShapeNode>`)
    lines.push(`      </data>`)
    lines.push(`      <data key="d_label">${escXml(label)}</data>`)
    lines.push(`      <data key="d_uri">${escXml(d.uri || '')}</data>`)
    lines.push(`      <data key="d_instance">${escXml(d.instanceLabel || '')}</data>`)
    lines.push(`      <data key="d_column">${escXml(d.mappedColumn || '')}</data>`)
    lines.push(`      <data key="d_label_column">${escXml(d.labelColumn || '')}</data>`)
    lines.push(`      <data key="d_color">${escXml(d.nodeColor || '#ffffff')}</data>`)
    lines.push(`      <data key="d_noprefix">${d.noPrefix ? 'true' : 'false'}</data>`)
    lines.push(`      <data key="d_x">${px}</data>`)
    lines.push(`      <data key="d_y">${py}</data>`)
    lines.push('    </node>')
  }

  for (const edge of edges) {
    const d = edge.data || {}

    // Skip internal dot-one edges (midpoint→target) and seg2 edges (midpoint→original target)
    if (d.isDotOne) continue
    if (d.isSplitSeg2) continue

    // For seg1 edges, reconstruct the original edge: source → originalTarget
    let source = edge.source
    let target = edge.target
    let dotOneProp = ''
    let dotOnePropUri = ''
    let dotOneNodeId = ''

    if (d.isSplitSeg1 && d.originalTarget) {
      target = d.originalTarget
      // Dot-one info is stored directly on the seg1 edge data
      dotOneProp = d.dotOneProp || ''
      dotOnePropUri = d.dotOnePropUri || ''
      dotOneNodeId = d.dotOneNodeId || ''
    }

    // Skip edges that reference midpoint nodes as source
    const srcNode = nodes.find(n => n.id === source)
    if (srcNode?.type === 'dotOneMidpoint') continue

    const edgeLabel = escXml(d.label || edge.label || '')
    const dotOneLabel = dotOneProp ? ` [${escXml(dotOneProp)}]` : ''

    lines.push(`    <edge id="${escXml(edge.id)}" source="${escXml(source)}" target="${escXml(target)}">`)
    lines.push(`      <data key="e_yed">`)
    lines.push(`        <y:PolyLineEdge>`)
    lines.push(`          <y:LineStyle color="#A8326A" type="line" width="1.0"/>`)
    lines.push(`          <y:Arrows source="none" target="standard"/>`)
    lines.push(`          <y:EdgeLabel alignment="center" configuration="AutoFlippingLabel" distance="2.0" fontFamily="Dialog" fontSize="10" fontStyle="plain" hasBackgroundColor="false" hasLineColor="false" modelName="custom" preferredPlacement="anywhere" ratio="0.5" textColor="#666666" visible="true">${edgeLabel}${dotOneLabel}<y:LabelModel><y:SmartEdgeLabelModel autoRotationEnabled="false" defaultAngle="0.0" defaultDistance="10.0"/></y:LabelModel><y:ModelParameter><y:SmartEdgeLabelModelParameter angle="0.0" distance="30.0" distanceToCenter="true" position="right" ratio="0.5" segment="0"/></y:ModelParameter><y:PreferredPlacementDescriptor angle="0.0" angleOffsetOnRightSide="0" angleReference="absolute" angleRotationOnRightSide="co" distance="-1.0" frozen="true" placement="anywhere" side="anywhere" sideReference="relative_to_edge_flow"/></y:EdgeLabel>`)
    lines.push(`          <y:BendStyle smoothed="false"/>`)
    lines.push(`        </y:PolyLineEdge>`)
    lines.push(`      </data>`)
    lines.push(`      <data key="e_label">${edgeLabel}</data>`)
    lines.push(`      <data key="e_uri">${escXml(d.propertyUri || '')}</data>`)
    if (d.joinColumnSource) lines.push(`      <data key="e_join_src">${escXml(d.joinColumnSource)}</data>`)
    if (d.joinColumnTarget) lines.push(`      <data key="e_join_tgt">${escXml(d.joinColumnTarget)}</data>`)
    // Backward compat: old single joinColumn
    if (!d.joinColumnSource && !d.joinColumnTarget && d.joinColumn) lines.push(`      <data key="e_join_tgt">${escXml(d.joinColumn)}</data>`)
    if (dotOneProp)    lines.push(`      <data key="e_dotone">${escXml(dotOneProp)}</data>`)
    if (dotOnePropUri) lines.push(`      <data key="e_dotone_uri">${escXml(dotOnePropUri)}</data>`)
    if (dotOneNodeId)  lines.push(`      <data key="e_dotone_node">${escXml(dotOneNodeId)}</data>`)
    lines.push('    </edge>')
  }

  lines.push('  </graph>', '</graphml>')
  return lines.join('\n')
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function downloadText(filename, content, mime = 'application/xml') {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── TSV Mapping Export (v5) ──────────────────────────────────────────────────

function shortenUri(uri, prefixMap) {
  if (!uri || !prefixMap) return uri || ''
  const entries = Object.entries(prefixMap).sort((a, b) => b[1].length - a[1].length)
  for (const [prefix, ns] of entries) {
    if (uri.startsWith(ns)) return `${prefix}:${uri.slice(ns.length)}`
  }
  return uri
}

/**
 * Expand a prefixed URI (e.g. "crm:E18_Physical_Thing") into a full URI
 * using the provided prefix map.  Returns the original value if no prefix matched.
 */
function expandPrefix(value, prefixMap) {
  if (!value || !prefixMap) return value || ''
  const v = String(value).trim()
  if (!v) return ''
  // Already a full URI?
  if (v.startsWith('http://') || v.startsWith('https://')) return v
  const colonIdx = v.indexOf(':')
  if (colonIdx < 1) return v
  const prefix = v.slice(0, colonIdx)
  const local  = v.slice(colonIdx + 1)
  const ns = prefixMap[prefix]
  if (ns) return ns + local
  return v
}

function applyPrefix(value, idPrefix) {
  if (!value && value !== 0) return ''
  const v = String(value).trim()
  if (!v) return ''
  if (!idPrefix || !idPrefix.trim()) return v
  const pfx = idPrefix.trim().endsWith(':') ? idPrefix.trim() : idPrefix.trim() + ':'
  if (/^[a-zA-Z][a-zA-Z0-9_]*:/.test(v)) return v   // already prefixed
  return pfx + v
}

function getNodeRows(nodeData, globalTableData) {
  if (nodeData?.tableRows && nodeData.tableRows.length > 0) return nodeData.tableRows
  if (globalTableData && globalTableData.length > 0) return globalTableData
  return null
}

function getIdValue(nodeData, row, idPrefix) {
  if (nodeData?.mappedColumn && row) {
    const val = row[nodeData.mappedColumn]
    // If noPrefix is set (literal nodes), don't prepend the ID prefix
    if (nodeData.noPrefix) return val != null ? String(val).trim() : ''
    return applyPrefix(val ?? '', idPrefix)
  }
  if (nodeData?.instanceLabel) return nodeData.instanceLabel
  return ''
}

function getLabelValue(nodeData, row) {
  if (nodeData?.labelColumn && row) {
    const val = row[nodeData.labelColumn]
    return val != null ? String(val) : ''
  }
  if (nodeData?.instanceLabel) return nodeData.instanceLabel
  return ''
}

/**
 * Try to find a FK join key between two different tables.
 * Returns { joinKeySrc, joinKeyTgt } or null.
 */
function findJoinKey(srcRows, srcMappedCol, tgtRows, tgtMappedCol) {
  if (!srcRows.length || !tgtRows.length) return null
  const srcCols = Object.keys(srcRows[0])
  const tgtCols = Object.keys(tgtRows[0])

  // Forward: does any tgt column reference src's mapped column values?
  const srcMappedVals = new Set(srcRows.map(r => String(r[srcMappedCol] ?? '')).filter(Boolean))
  for (const col of tgtCols) {
    if (col === tgtMappedCol) continue
    const tgtVals = new Set(tgtRows.map(r => String(r[col] ?? '')).filter(Boolean))
    if ([...srcMappedVals].some(v => tgtVals.has(v))) {
      return { joinKeySrc: srcMappedCol, joinKeyTgt: col }
    }
  }

  // Reverse: does any src column reference tgt's mapped column values?
  const tgtMappedVals = new Set(tgtRows.map(r => String(r[tgtMappedCol] ?? '')).filter(Boolean))
  for (const col of srcCols) {
    if (col === srcMappedCol) continue
    const srcVals = new Set(srcRows.map(r => String(r[col] ?? '')).filter(Boolean))
    if ([...tgtMappedVals].some(v => srcVals.has(v))) {
      return { joinKeySrc: col, joinKeyTgt: tgtMappedCol }
    }
  }

  return null
}

function sameTableData(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length || a.length === 0) return false
  const keysA = Object.keys(a[0]).join(',')
  const keysB = Object.keys(b[0]).join(',')
  if (keysA !== keysB) return false
  const k0 = Object.keys(a[0])[0]
  return String(a[0][k0]) === String(b[0][k0]) &&
         String(a[a.length - 1][k0]) === String(b[b.length - 1][k0])
}

/**
 * Main TSV export function (v5).
 *
 * Cases:
 *   D  – neither side has mappedColumn        → one static row
 *   A  – both same table                      → zip row-by-row
 *   Cx – only src has column                  → iterate srcRows, tgt static
 *   Cy – only tgt has column                  → iterate tgtRows; domain from joinColumn or auto-detect
 *   B  – both different tables:
 *        1. If src.joinColumn set:
 *           domainId = tgtRow[joinColumn] (the FK in the range table IS the domain ID)
 *           Deduplicate on (domainId, rangeId) pairs.
 *        2. Otherwise: auto-detect join key via findJoinKey().
 *           Deduplicate on (domainId, rangeId) pairs to avoid duplicates from
 *           one-to-many joins where tgt has repeated values.
 *        3. Cartesian fallback if no join key found (max 500 rows).
 *
 * RULE: rows where rangeId is empty are always skipped.
 */
export function exportMappingTSV(nodes, edges, globalTableData, prefixMap = {}, idPrefix = '', namedGraphs = []) {
  const headers = [
    'ID_of_Domain', 'Domain_label', 'Class_of_domain',
    'Property',
    'ID_of_the_range', 'Range_Label', 'Class_of_the_range',
    'Dot_one', 'Dot_one_target', 'I4_Proposition_Set',
  ]

  // Build named graph lookup: nodeId -> graph label
  const nodeGraphMap = {}
  for (const ng of (namedGraphs || [])) {
    for (const nid of (ng.nodeIds || [])) {
      nodeGraphMap[nid] = ng.label || ''
    }
  }

  const outputRows = []

  // ── Pre-build dot-one info from split edges ────────────────────────────────
  // Instead of pre-aggregating values, store the node reference + column name
  // so we can resolve the dot-one target value PER ROW during iteration.
  const dotOneInfo = {}  // seg1EdgeId -> { dotOneProp, dotNode, dotNodeCol, staticVal }
  for (const edge of edges) {
    if (!edge.data?.isSplitSeg1) continue
    const dotNodeId = edge.data.dotOneNodeId
    const dotEdgeId = edge.data.dotOneEdgeId
    if (!dotNodeId) continue

    const dotTargetNode = nodes.find(n => n.id === dotNodeId)
    const dotEdge = dotEdgeId ? edges.find(e => e.id === dotEdgeId) : null

    // Determine: is the dot-one target from a table column, or static?
    let staticVal = ''
    const dotNodeCol = dotTargetNode?.data?.mappedColumn || null
    const dotNodeRows = dotTargetNode?.data?.tableRows || null

    if (!dotNodeCol || !dotNodeRows?.length) {
      // Static value: instanceLabel or URI
      if (dotTargetNode?.data?.instanceLabel) {
        staticVal = dotTargetNode.data.instanceLabel
      } else if (dotTargetNode?.data?.uri) {
        staticVal = shortenUri(dotTargetNode.data.uri, prefixMap)
      }
    }

    dotOneInfo[edge.id] = {
      dotOneProp: edge.data.dotOneProp || (dotEdge ? (dotEdge.data?.label || dotEdge.label || '') : ''),
      dotOnePropUri: edge.data.dotOnePropUri || (dotEdge ? (dotEdge.data?.propertyUri || '') : ''),
      dotNodeCol: dotNodeCol,
      dotNodeRows: dotNodeRows,
      staticVal: staticVal,
    }
  }

  /**
   * Resolve a dot-one property to a prefixed URI.
   * Priority: full URI → shortened URI → smart fallback for bare labels.
   * Bare labels like "P2_has_type" are matched against known CRM patterns
   * and auto-prefixed as "crm:P2_has_type".
   */
  function resolveDotOneProp(uri, label, prefixMap) {
    // 1. If we have a full URI, shorten it
    if (uri) {
      const short = shortenUri(uri, prefixMap)
      if (short && short !== uri) return short
      if (uri.startsWith('http://') || uri.startsWith('https://')) return uri
    }
    // 2. If label already has a prefix, use as-is
    if (label && /^[a-zA-Z][a-zA-Z0-9_]*:/.test(label)) return label
    // 3. Bare label → try to auto-prefix with known CRM patterns
    if (label) {
      // CIDOC CRM properties: P\d+, E\d+, AP\d+, SP\d+, etc.
      if (/^[A-Z]+\d+[a-z_]/.test(label) || /^[A-Z]\d+_/.test(label)) {
        // Check if any prefix namespace contains 'cidoc-crm' or 'crmarchaeo' etc.
        for (const [pfx, ns] of Object.entries(prefixMap)) {
          if (ns.includes('cidoc-crm') || ns.includes('crmarchaeo') || ns.includes('crmsci')) {
            return `${pfx}:${label}`
          }
        }
        // Ultimate fallback: assume crm: prefix
        if (prefixMap['crm']) return `crm:${label}`
      }
    }
    return label || ''
  }

  for (const edge of edges) {
    // Skip internal dot-one edges and seg2 edges – they don't produce export rows
    if (edge.data?.isDotOne) continue
    if (edge.data?.isSplitSeg2) continue

    const src = nodes.find(n => n.id === edge.source)
    if (!src || src.type === 'dotOneMidpoint') continue

    // For seg1 edges, the target is NOT the midpoint – it's the ORIGINAL target
    let tgt
    if (edge.data?.isSplitSeg1 && edge.data?.originalTarget) {
      tgt = nodes.find(n => n.id === edge.data.originalTarget)
    } else {
      tgt = nodes.find(n => n.id === edge.target)
    }
    if (!tgt || tgt.type === 'dotOneMidpoint') continue

    const propUri   = edge.data?.propertyUri || ''
    const propLabel = edge.data?.label || edge.label || ''
    const propShort = shortenUri(propUri, prefixMap) || propLabel

    const domainClass = shortenUri(src.data?.uri || '', prefixMap)
    const rangeClass  = shortenUri(tgt.data?.uri || '', prefixMap)

    // Dot-One property: prefer URI (shortened), fallback with smart auto-prefix
    const dInfo = dotOneInfo[edge.id] || null
    const edgeDotOne = dInfo
      ? resolveDotOneProp(dInfo.dotOnePropUri, dInfo.dotOneProp, prefixMap)
      : (edge.data?.dotOne || '')

    // I4 from named graphs
    const i4 = nodeGraphMap[src.id] || nodeGraphMap[tgt.id] || ''

    const srcHasCol  = !!(src.data?.mappedColumn)
    const tgtHasCol  = !!(tgt.data?.mappedColumn)
    const srcTableId = src.data?.tableId || null
    const tgtTableId = tgt.data?.tableId || null
    const srcRows    = getNodeRows(src.data, globalTableData) || []
    const tgtRows    = getNodeRows(tgt.data, globalTableData) || []

    // push: resolve dot-one target PER ROW using the row index
    const push = (domainId, domainLbl, rangeId, rangeLbl, rowIdx) => {
      if (!rangeId) return   // always skip empty range

      // Resolve dot-one target for THIS specific row
      let dotOneTarget = ''
      if (dInfo) {
        if (dInfo.dotNodeCol && dInfo.dotNodeRows?.length > 0) {
          // Same table as source → use same row index
          const dotRow = dInfo.dotNodeRows[rowIdx] || dInfo.dotNodeRows[0]
          const val = dotRow ? dotRow[dInfo.dotNodeCol] : ''
          dotOneTarget = val ? applyPrefix(String(val), idPrefix) : ''
        } else {
          dotOneTarget = dInfo.staticVal
        }
      } else if (edge.data?.dotOneTarget) {
        dotOneTarget = edge.data.dotOneTarget
      }

      outputRows.push({
        domainId, domainLbl, domainClass, prop: propShort,
        rangeId, rangeLbl, rangeClass,
        dotOne: edgeDotOne, dotOneTarget: dotOneTarget, i4,
      })
    }

    // ── Case D: both static ──────────────────────────────────────────────────
    if (!srcHasCol && !tgtHasCol) {
      push(src.data?.instanceLabel || '', src.data?.instanceLabel || '',
           tgt.data?.instanceLabel || '', tgt.data?.instanceLabel || '', 0)
      continue
    }

    // ── Case A: same table → zip ─────────────────────────────────────────────
    const isSameTable = srcHasCol && tgtHasCol && (
      (srcTableId && tgtTableId && srcTableId === tgtTableId) ||
      sameTableData(srcRows, tgtRows)
    )
    if (isSameTable) {
      const len = Math.max(srcRows.length, tgtRows.length)
      for (let i = 0; i < len; i++) {
        push(
          getIdValue(src.data, srcRows[i] || null, idPrefix),
          getLabelValue(src.data, srcRows[i] || null),
          getIdValue(tgt.data, tgtRows[i] || null, idPrefix),
          getLabelValue(tgt.data, tgtRows[i] || null),
          i,
        )
      }
      continue
    }

    // ── Case Cx: only src has column ─────────────────────────────────────────
    if (srcHasCol && !tgtHasCol) {
      const rangeId  = tgt.data?.instanceLabel || ''
      const rangeLbl = tgt.data?.instanceLabel || ''
      for (let _cx = 0; _cx < srcRows.length; _cx++) {
        const sRow = srcRows[_cx]
        push(getIdValue(src.data, sRow, idPrefix), getLabelValue(src.data, sRow), rangeId, rangeLbl, _cx)
      }
      continue
    }

    // ── Case Cy: only tgt has column ─────────────────────────────────────────
    if (!srcHasCol && tgtHasCol) {
      // v2: prefer explicit joinColumnTarget from edge
      let joinCol = edge.data?.joinColumnTarget || edge.data?.joinColumn || src.data?.joinColumn || null

      // Auto-detect: find a tgtRows column that looks like a FK
      if (!joinCol && tgtRows.length > 0) {
        const tgtCols = Object.keys(tgtRows[0])
        const fkKeywords = ['id_schicht', 'schicht', 'site_id', 'sondage_id', 'sondage',
                            'domain', 'fk_', 'ref_', 'layer', 'context', 'unit']
        for (const col of tgtCols) {
          if (col === tgt.data.mappedColumn) continue
          const colLower = col.toLowerCase().replace(/[^a-z0-9]/g, '_')
          if (fkKeywords.some(kw => colLower.includes(kw))) {
            if (tgtRows.some(r => r[col])) { joinCol = col; break }
          }
        }
        if (!joinCol) {
          for (const col of tgtCols) {
            if (col === tgt.data.mappedColumn) continue
            const sample = tgtRows[0][col]
            if (sample && typeof sample === 'string' && /[-_]/.test(sample)) {
              joinCol = col; break
            }
          }
        }
      }

      for (const tRow of tgtRows) {
        const rangeId  = getIdValue(tgt.data, tRow, idPrefix)
        const rangeLbl = getLabelValue(tgt.data, tRow)
        let domainId  = ''
        let domainLbl = ''
        if (joinCol && tRow[joinCol] != null) {
          domainId  = applyPrefix(tRow[joinCol], idPrefix)
          domainLbl = ''
        } else {
          domainId  = src.data?.instanceLabel || ''
          domainLbl = src.data?.instanceLabel || ''
        }
        push(domainId, domainLbl, rangeId, rangeLbl, tgtRows.indexOf(tRow))
      }
      continue
    }

    // ── Case B: both have columns from different tables ───────────────────────
    //
    // v2: joinColumnSource + joinColumnTarget allow explicit 2-key joins.
    //     Fallback: old single joinColumn, src.data.joinColumn, auto-detect.
    const edgeJoinSrc = edge.data?.joinColumnSource || null
    const edgeJoinTgt = edge.data?.joinColumnTarget || edge.data?.joinColumn || src.data?.joinColumn || null

    if (edgeJoinSrc && edgeJoinTgt) {
      // ── Explicit 2-key join: srcRow[joinSrc] == tgtRow[joinTgt] ──
      const tgtIndex = {}
      for (const tRow of tgtRows) {
        const key = String(tRow[edgeJoinTgt] ?? '')
        if (!key) continue
        if (!tgtIndex[key]) tgtIndex[key] = []
        tgtIndex[key].push(tRow)
      }
      const seen = new Set()
      for (const sRow of srcRows) {
        const srcKey = String(sRow[edgeJoinSrc] ?? '')
        for (const tRow of (tgtIndex[srcKey] || [])) {
          const domainId  = getIdValue(src.data, sRow, idPrefix)
          const domainLbl = getLabelValue(src.data, sRow)
          const rangeId   = getIdValue(tgt.data, tRow, idPrefix)
          const rangeLbl  = getLabelValue(tgt.data, tRow)
          const pairKey   = `${domainId}|${rangeId}`
          if (!seen.has(pairKey)) {
            seen.add(pairKey)
            push(domainId, domainLbl, rangeId, rangeLbl, srcRows.indexOf(sRow))
          }
        }
      }
      continue
    }

    if (edgeJoinTgt && !edgeJoinSrc) {
      // ── Legacy single-key join: iterate tgtRows, look up domain via joinCol ──
      const joinCol = edgeJoinTgt
      const seen    = new Set()
      for (const tRow of tgtRows) {
        const rangeId  = getIdValue(tgt.data, tRow, idPrefix)
        const rangeLbl = getLabelValue(tgt.data, tRow)
        const domainId = tRow[joinCol] != null ? applyPrefix(tRow[joinCol], idPrefix) : ''
        const domainLbl = getLabelValue(src.data, null)
        const key = `${domainId}|${rangeId}`
        if (!seen.has(key)) { seen.add(key); push(domainId, domainLbl, rangeId, rangeLbl, tgtRows.indexOf(tRow)) }
      }
      continue
    }

    // Auto-detect join key + deduplicate
    const joinKeys = findJoinKey(srcRows, src.data.mappedColumn, tgtRows, tgt.data.mappedColumn)

    if (joinKeys) {
      const { joinKeySrc, joinKeyTgt } = joinKeys
      const tgtIndex = {}
      for (const tRow of tgtRows) {
        const key = String(tRow[joinKeyTgt] ?? '')
        if (!key) continue
        if (!tgtIndex[key]) tgtIndex[key] = []
        tgtIndex[key].push(tRow)
      }
      const seen = new Set()
      for (const sRow of srcRows) {
        const key = String(sRow[joinKeySrc] ?? '')
        for (const tRow of (tgtIndex[key] || [])) {
          const domainId  = getIdValue(src.data, sRow, idPrefix)
          const domainLbl = getLabelValue(src.data, sRow)
          const rangeId   = getIdValue(tgt.data, tRow, idPrefix)
          const rangeLbl  = getLabelValue(tgt.data, tRow)
          const pairKey   = `${domainId}|${rangeId}`
          if (!seen.has(pairKey)) {
            seen.add(pairKey)
            push(domainId, domainLbl, rangeId, rangeLbl, srcRows.indexOf(sRow))
          }
        }
      }
    } else {
      // Cartesian fallback
      const total = srcRows.length * tgtRows.length
      if (total > 500) {
        outputRows.push({
          domainId:   '⚠ kein Join-Key gefunden',
          domainLbl:  `${srcRows.length} × ${tgtRows.length} Zeilen`,
          domainClass, prop: propShort,
          rangeId:    '⚠ kartesisches Produkt verhindert',
          rangeLbl:   'Join-Key im Property-Dialog setzen',
          rangeClass,
          dotOne: '', dotOneTarget: '', i4: '',
        })
      } else {
        const seen = new Set()
        for (const sRow of srcRows) {
          for (const tRow of tgtRows) {
            const domainId  = getIdValue(src.data, sRow, idPrefix)
            const domainLbl = getLabelValue(src.data, sRow)
            const rangeId   = getIdValue(tgt.data, tRow, idPrefix)
            const rangeLbl  = getLabelValue(tgt.data, tRow)
            const pairKey   = `${domainId}|${rangeId}`
            if (!seen.has(pairKey)) {
              seen.add(pairKey)
              push(domainId, domainLbl, rangeId, rangeLbl, srcRows.indexOf(sRow))
            }
          }
        }
      }
    }
  }

  // Build TSV
  const tsvRows = [headers.join('\t')]
  for (const r of outputRows) {
    tsvRows.push([
      r.domainId, r.domainLbl, r.domainClass, r.prop,
      r.rangeId, r.rangeLbl, r.rangeClass,
      r.dotOne || '', r.dotOneTarget || '', r.i4 || '',
    ].join('\t'))
  }
  return tsvRows.join('\n')
}


// ─── RDF Pipeline Export (replaces Table2RDF Steps 1-3) ──────────────────────
//
// This produces URI-expanded TSV files ready for Ontotext Refine,
// completely eliminating the PostgreSQL dependency.
// Two files are generated:
//   1. Triples_URI.tsv       – rows where range class is NOT a literal type
//   2. Triples_URI_literal.tsv – rows where range class IS a literal type (xsd:*, geo:wktLiteral)

const LITERAL_PATTERNS = ['xsd:', 'geo:wktLiteral']

function isLiteralRange(rangeClass) {
  if (!rangeClass) return false
  const rc = String(rangeClass).trim()
  return LITERAL_PATTERNS.some(pat => rc.startsWith(pat) || rc.includes(pat))
}

/**
 * Generate URI-expanded TSV rows from the mapping data.
 *
 * Takes the same outputRows as exportMappingTSV produces, but:
 * 1. Adds p3_has_note column (empty for now – placeholder for future)
 * 2. Expands all prefixed values to full URIs using prefixMap
 * 3. Splits into URI (non-literal) and literal rows
 *
 * Returns { uriTSV, literalTSV, uriRowCount, literalRowCount }
 */
export function exportRdfPipelineTSV(nodes, edges, globalTableData, prefixMap = {}, idPrefix = '', namedGraphs = []) {
  // First, generate the standard mapping rows (reuse existing logic)
  const rawTSV = exportMappingTSV(nodes, edges, globalTableData, prefixMap, idPrefix, namedGraphs)
  const lines = rawTSV.split('\n')
  if (lines.length < 2) return { uriTSV: '', literalTSV: '', uriRowCount: 0, literalRowCount: 0 }

  // Parse back the rows (skip header)
  const dataRows = lines.slice(1).map(line => {
    const cols = line.split('\t')
    return {
      domainId:    cols[0] || '',
      domainLbl:   cols[1] || '',
      domainClass: cols[2] || '',
      prop:        cols[3] || '',
      rangeId:     cols[4] || '',
      rangeLbl:    cols[5] || '',
      rangeClass:  cols[6] || '',
      dotOne:      cols[7] || '',
      dotOneTarget:cols[8] || '',
      i4:          cols[9] || '',
    }
  }).filter(r => r.domainId || r.rangeId) // skip completely empty rows

  // Expand all prefixed values to full URIs
  const expandRow = (r) => ({
    id_of_domain_uri:       expandPrefix(r.domainId,    prefixMap),
    class_of_domain_uri:    expandPrefix(r.domainClass, prefixMap),
    domain_label:           r.domainLbl,
    p3_has_note:            '',  // placeholder – future feature
    property_uri:           expandPrefix(r.prop,        prefixMap),
    id_of_the_range_uri:    isLiteralRange(r.rangeClass) ? r.rangeId : expandPrefix(r.rangeId, prefixMap),
    class_of_the_range_uri: expandPrefix(r.rangeClass,  prefixMap),
    range_label:            r.rangeLbl,
    dot_one_uri:            expandPrefix(r.dotOne,      prefixMap),
    dot_one_target_uri:     expandPrefix(r.dotOneTarget,prefixMap),
    i4_uri:                 expandPrefix(r.i4,          prefixMap),
  })

  // Split into URI vs literal rows
  const uriRows = []
  const literalRows = []
  for (const r of dataRows) {
    const expanded = expandRow(r)
    if (isLiteralRange(r.rangeClass)) {
      literalRows.push(expanded)
    } else {
      uriRows.push(expanded)
    }
  }

  // Build TSV strings
  const uriHeaders = [
    'id_of_domain_uri', 'class_of_domain_uri', 'domain_label', 'p3_has_note',
    'property_uri', 'id_of_the_range_uri', 'class_of_the_range_uri', 'range_label',
    'dot_one_uri', 'dot_one_target_uri', 'i4_uri',
  ]

  // Literal TSV has slightly different column order (matching Table2RDF's SQL output)
  const litHeaders = [
    'id_of_domain_uri', 'class_of_domain_uri', 'domain_label',
    'property_uri', 'id_of_the_range_uri', 'class_of_the_range_uri', 'range_label',
    'dot_one_uri', 'dot_one_target_uri', 'p3_has_note', 'i4_uri',
  ]

  const buildTSV = (headers, rows) => {
    const tsvLines = [headers.join('\t')]
    for (const row of rows) {
      tsvLines.push(headers.map(h => row[h] || '').join('\t'))
    }
    return tsvLines.join('\n')
  }

  return {
    uriTSV:         buildTSV(uriHeaders, uriRows),
    literalTSV:     buildTSV(litHeaders, literalRows),
    uriRowCount:    uriRows.length,
    literalRowCount: literalRows.length,
  }
}
