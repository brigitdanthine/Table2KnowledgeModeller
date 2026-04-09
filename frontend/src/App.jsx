import React, { useState, useCallback, useRef, useEffect } from 'react'
import ReactFlow, {
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'

import OntologyPanel from './components/OntologyPanel.jsx'
import TablePanel from './components/TablePanel.jsx'
import ToastContainer from './components/Toast.jsx'
import PropertyPickerModal from './components/PropertyPickerModal.jsx'
import EdgeEditModal from './components/EdgeEditModal.jsx'
import DotOneModal from './components/DotOneModal.jsx'
import RdfPipelineModal from './components/RdfPipelineModal.jsx'
import PrefixManagerModal from './components/PrefixManagerModal.jsx'
import { nodeTypes } from './components/OntologyNode.jsx'
import { useToast } from './hooks/useToast.js'
import { exportGraphML, exportRdfPipelineTSV, downloadText } from './utils/graphml.js'
import { Download, Table, Layers, Save, FolderOpen, ShieldCheck, ChevronsDownUp, X, Group, Database, Tag, PlusCircle, ChevronDown, Image } from 'lucide-react'
import { resolveColor } from './utils/cidocColors.js'
import { api } from './utils/api.js'

let nodeCounter = 1

const EDGE_STYLE  = { stroke: '#a8326a', strokeWidth: 1.5 }
const EDGE_MARKER = { type: MarkerType.ArrowClosed, color: '#a8326a', width: 14, height: 14 }
const EDGE_LABEL_STYLE = {
  labelStyle:      { fill: '#a8326a', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 },
  labelBgStyle:    { fill: '#ffffff', fillOpacity: 0.95 },
  labelBgPadding:  [4, 6],
  labelBgBorderRadius: 3,
}

const DOTONE_EDGE_STYLE  = { stroke: '#a8326a', strokeWidth: 1.2, strokeDasharray: '6 3' }
const DOTONE_EDGE_MARKER = { type: MarkerType.ArrowClosed, color: '#a8326a', width: 12, height: 12 }
const DOTONE_LABEL_STYLE = {
  labelStyle:      { fill: '#a8326a', fontFamily: "'IBM Plex Mono',monospace", fontSize: 9 },
  labelBgStyle:    { fill: '#ffffff', fillOpacity: 0.95 },
  labelBgPadding:  [3, 5],
  labelBgBorderRadius: 3,
}

function makeEdge(id, source, target, prop, sourceHandle, targetHandle) {
  return {
    id,
    source,
    target,
    sourceHandle: sourceHandle || null,
    targetHandle: targetHandle || null,
    label: prop.label,
    data: {
      label: prop.label,
      propertyUri: prop.uri,
      joinColumnSource: prop.joinColumnSource || null,
      joinColumnTarget: prop.joinColumnTarget || null,
    },
    style: EDGE_STYLE,
    markerEnd: EDGE_MARKER,
    ...EDGE_LABEL_STYLE,
  }
}

function makeDotOneEdge(id, midpointId, targetId, propLabel) {
  return {
    id,
    source: midpointId,
    target: targetId,
    sourceHandle: 'dot-s',
    targetHandle: 't-t',
    label: propLabel,
    data: { label: propLabel, isDotOne: true },
    style: DOTONE_EDGE_STYLE,
    markerEnd: DOTONE_EDGE_MARKER,
    ...DOTONE_LABEL_STYLE,
  }
}

const PANEL_ONTOLOGY = 'ontology'
const PANEL_TABLE    = 'table'

function BoundingBoxOverlay({ bounds, color, label, rfInstance }) {
  if (!bounds || !rfInstance) return null
  const vp = rfInstance.getViewport()
  const sx = bounds.x * vp.zoom + vp.x
  const sy = bounds.y * vp.zoom + vp.y
  const sw = bounds.width * vp.zoom
  const sh = bounds.height * vp.zoom
  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 4, overflow: 'visible' }}>
      <rect x={sx} y={sy} width={sw} height={sh} rx={8} fill={color + '0a'} stroke={color} strokeWidth={2} strokeDasharray="8 4" />
      <text x={sx + 8} y={sy - 6} fill={color} fontSize={11} fontFamily="'IBM Plex Mono', monospace" fontWeight={600}>{label}</text>
    </svg>
  )
}

function GraphInner({
  nodes, edges,
  onNodesChange, onEdgesChange,
  setNodes, setEdges,
  toast, tableData,
  activePanel, setActivePanel,
  leftWidth, onMouseDownResize,
  idPrefix, setIdPrefix,
  prefixMap, setPrefixMap,
  widening, setWidening,
  wideningParent, setWideningParent,
}) {
  const rfInstance   = useReactFlow()
  const rfWrapper    = useRef(null)
  const loadInputRef = useRef(null)
  const [pendingConnect, setPendingConnect] = useState(null)
  const [verifyResults, setVerifyResults] = useState(null)
  const [editingEdge, setEditingEdge] = useState(null)
  const [pendingDotOne, setPendingDotOne] = useState(null)
  const [namedGraphs, setNamedGraphs] = useState([])
  const [showGraphPanel, setShowGraphPanel] = useState(false)
  const [showPipeline, setShowPipeline] = useState(false)
  const [showPrefixManager, setShowPrefixManager] = useState(false)
  const [ontologyPrefixes, setOntologyPrefixes] = useState([])
  const [showFreeNode, setShowFreeNode] = useState(false)
  const [freeNodeLabel, setFreeNodeLabel] = useState('')
  const [freeNodeUri, setFreeNodeUri] = useState('')
  const [ngLabel, setNgLabel] = useState('')
  const [highlightNg, setHighlightNg] = useState(null) // { nodeIds, color, bounds }

  const handleDeleteNode = useCallback((id) => {
    setNodes(ns => ns.filter(n => n.id !== id))
    setEdges(es => es.filter(e => e.source !== id && e.target !== id))
  }, [setNodes, setEdges])

  const handleLabelChange = useCallback((id, label) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, instanceLabel: label } } : n))
  }, [setNodes])

  const handleColumnDrop = useCallback((id, col) => {
    setNodes(ns => ns.map(n => n.id === id ? {
      ...n, data: {
        ...n.data,
        mappedColumn: col ? col.name : null,
        tableId:      col ? col.tableId : null,
        tableRows:    col ? col.allRows : null,
      }
    } : n))
    if (col) toast.success(`ID column "${col.name}" assigned (${col.allRows?.length} rows)`)
  }, [setNodes, toast])

  const handleLabelColumnDrop = useCallback((id, col) => {
    setNodes(ns => ns.map(n => n.id === id ? {
      ...n, data: {
        ...n.data,
        labelColumn: col ? col.name : null,
        tableId:     (col && !n.data.tableId)   ? col.tableId : n.data.tableId,
        tableRows:   (col && !n.data.tableRows) ? col.allRows : n.data.tableRows,
      }
    } : n))
    if (col) toast.success(`Label column "${col.name}" assigned`)
  }, [setNodes, toast])

  const handleFocusNode = useCallback((id, data) => {
    window.dispatchEvent(new CustomEvent('ontology:focusNode', { detail: data }))
    toast.info(`Subject loaded: ${data.label}`)
  }, [toast])

  const handleToggleNoPrefix = useCallback((id, noPrefix) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, noPrefix } } : n))
  }, [setNodes])

  const resolveNodeColor = useCallback(async (uri) => {
    try {
      const d = await api.getSuperclasses(uri)
      return resolveColor(uri, (d.superclasses || []).map(s => s.uri))
    } catch {
      return resolveColor(uri, [])
    }
  }, [])

  const makeNodeData = useCallback((item, nodeType, color) => ({
    label:         item.label,
    uri:           item.uri,
    nodeType,
    rdfs_label:    item.rdfs_label,
    nodeColor:     color || '#e8e8e8',
    mappedColumn:  null,
    labelColumn:   null,
    instanceLabel: '',
    noPrefix:      false,
    onDelete:           handleDeleteNode,
    onLabelChange:      handleLabelChange,
    onColumnDrop:       handleColumnDrop,
    onLabelColumnDrop:  handleLabelColumnDrop,
    onToggleNoPrefix:   handleToggleNoPrefix,
    onFocus:            handleFocusNode,
  }), [handleDeleteNode, handleLabelChange, handleColumnDrop, handleLabelColumnDrop, handleToggleNoPrefix, handleFocusNode])

  const addNodeWithColor = useCallback(async (item, nodeType, pos) => {
    const id = `n${nodeCounter++}`
    setNodes(ns => [...ns, { id, type: 'ontologyNode', position: pos, data: makeNodeData(item, nodeType, '#e8e8e8') }])
    const { color } = await resolveNodeColor(item.uri)
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, nodeColor: color } } : n))
    return id
  }, [setNodes, makeNodeData, resolveNodeColor])

  const findNodeAtScreenPos = useCallback((clientX, clientY) => {
    if (!rfWrapper.current) return null
    const bounds  = rfWrapper.current.getBoundingClientRect()
    const flowPos = rfInstance.screenToFlowPosition({ x: clientX - bounds.left, y: clientY - bounds.top })
    for (const n of rfInstance.getNodes()) {
      const w = n.width  ?? 230
      const h = n.height ?? 100
      const pad = 20
      if (
        flowPos.x >= n.position.x - pad && flowPos.x <= n.position.x + w + pad &&
        flowPos.y >= n.position.y - pad && flowPos.y <= n.position.y + h + pad
      ) return n
    }
    return null
  }, [rfInstance])

  // Pick the nearest source/target handle pair based on relative position
  const pickNearestHandles = useCallback((sourceNode, targetPos) => {
    const sw = sourceNode.width  ?? 200
    const sh = sourceNode.height ?? 100
    const srcCx = sourceNode.position.x + sw / 2
    const srcCy = sourceNode.position.y + sh / 2
    const dx = targetPos.x - srcCx
    const dy = targetPos.y - srcCy

    let srcSide, tgtSide
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) { srcSide = 'r'; tgtSide = 'l' }
      else        { srcSide = 'l'; tgtSide = 'r' }
    } else {
      if (dy > 0) { srcSide = 'b'; tgtSide = 't' }
      else        { srcSide = 't'; tgtSide = 'b' }
    }
    return { srcHandle: `${srcSide}-s`, tgtHandle: `${tgtSide}-t` }
  }, [])

  // Find the nearest edge to a flow-space position (for dot-one drop)
  const findEdgeAtPos = useCallback((flowPos) => {
    const allNodes = rfInstance.getNodes()
    const allEdges = rfInstance.getEdges()
    const threshold = 50  // px proximity – generous for usability

    // Check if pos hits a node – if yes, don't match edges (node takes priority)
    for (const n of allNodes) {
      const w = n.width ?? 200, h = n.height ?? 100
      if (flowPos.x >= n.position.x && flowPos.x <= n.position.x + w &&
          flowPos.y >= n.position.y && flowPos.y <= n.position.y + h) {
        return null  // hit a node, not an edge
      }
    }

    let bestEdge = null, bestDist = threshold
    for (const edge of allEdges) {
      const src = allNodes.find(n => n.id === edge.source)
      const tgt = allNodes.find(n => n.id === edge.target)
      if (!src || !tgt) continue

      // Approximate edge as line between node centers
      const sx = src.position.x + (src.width ?? 200) / 2
      const sy = src.position.y + (src.height ?? 100) / 2
      const tx = tgt.position.x + (tgt.width ?? 200) / 2
      const ty = tgt.position.y + (tgt.height ?? 100) / 2

      const dx = tx - sx, dy = ty - sy
      const lenSq = dx * dx + dy * dy
      if (lenSq === 0) continue
      const t = Math.max(0, Math.min(1, ((flowPos.x - sx) * dx + (flowPos.y - sy) * dy) / lenSq))
      const px = sx + t * dx, py = sy + t * dy
      const dist = Math.sqrt((flowPos.x - px) ** 2 + (flowPos.y - py) ** 2)

      if (dist < bestDist) { bestDist = dist; bestEdge = edge }
    }
    return bestEdge
  }, [rfInstance])

  // Dot-One confirm: SPLIT original edge through midpoint, create dot-one class node + edge
  // Graph: Source ──seg1──▶ Midpoint ──seg2──▶ Target
  //                              └──dot1──▶ DotOneClassNode
  // Export: seg1 carries the original property + dot-one metadata, seg2 + dot1 are skipped
  const handleDotOneConfirm = useCallback(async (dotOneProp, dotOneTargetUri, dotOnePropUri) => {
    if (!pendingDotOne) return
    const { edge: origEdge, sourceNode, targetNode, dotItem } = pendingDotOne
    const origId = origEdge.id
    const origLabel = origEdge.data?.label || origEdge.label || ''
    const origData = origEdge.data || {}

    // 1. Calculate midpoint position between source and target
    const sx = sourceNode.position.x + (sourceNode.width ?? 200) / 2
    const sy = sourceNode.position.y + (sourceNode.height ?? 100) / 2
    const tx = targetNode.position.x + (targetNode.width ?? 200) / 2
    const ty = targetNode.position.y + (targetNode.height ?? 100) / 2
    const midX = (sx + tx) / 2 - 7
    const midY = (sy + ty) / 2 - 7

    // 2. Determine handle directions based on dominant axis
    const dx = tx - sx, dy = ty - sy
    let srcOut, midIn, midOut, tgtIn
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) { srcOut = 'r'; midIn = 'l'; midOut = 'r'; tgtIn = 'l' }
      else        { srcOut = 'l'; midIn = 'r'; midOut = 'l'; tgtIn = 'r' }
    } else {
      if (dy > 0) { srcOut = 'b'; midIn = 't'; midOut = 'b'; tgtIn = 't' }
      else        { srcOut = 't'; midIn = 'b'; midOut = 't'; tgtIn = 'b' }
    }

    // 3. Create midpoint node
    const midId = `mid_${Date.now()}`
    const midNode = {
      id: midId, type: 'dotOneMidpoint',
      position: { x: midX, y: midY },
      data: { parentEdgeLabel: origLabel },
      draggable: true, width: 14, height: 14,
    }

    // 4. Create two split edges: Source→Midpoint (seg1) and Midpoint→Target (seg2)
    const dotNodeId = `n${nodeCounter++}`
    const seg1 = {
      id: `${origId}_seg1`,
      source: origEdge.source,
      target: midId,
      sourceHandle: origEdge.sourceHandle || `${srcOut}-s`,
      targetHandle: `mid-t-${midIn}`,
      label: origLabel,
      data: {
        ...origData,
        // Export metadata: seg1 is the "main" edge that carries property + dot-one info
        isSplitSeg1: true,
        originalTarget: origEdge.target,  // real target (for export to resolve)
        dotOneProp: dotOneProp,
        dotOnePropUri: dotOnePropUri || '',  // full URI for RDF export
        dotOneNodeId: dotNodeId,
        dotOneEdgeId: `${origId}_dot1`,
      },
      style: EDGE_STYLE, markerEnd: EDGE_MARKER, ...EDGE_LABEL_STYLE,
    }
    const seg2 = {
      id: `${origId}_seg2`,
      source: midId,
      target: origEdge.target,
      sourceHandle: `mid-s-${midOut}`,
      targetHandle: origEdge.targetHandle || `${tgtIn}-t`,
      label: '',
      data: { isSplitSeg2: true },
      style: EDGE_STYLE, markerEnd: EDGE_MARKER,
    }

    // 5. Create dot-one class node (below midpoint)
    const dotNodePos = { x: midX - 80, y: midY + 80 }
    const dotNodeData = makeNodeData(
      { label: dotItem.label, uri: dotItem.uri, rdfs_label: dotItem.rdfs_label },
      'object', '#e8e8e8'
    )

    // 6. Create dot-one edge (midpoint → class node)
    const dotEdge = makeDotOneEdge(`${origId}_dot1`, midId, dotNodeId, dotOneProp)

    // 7. Apply: remove original edge, add midpoint + segments + dot-one
    setEdges(es => [
      ...es.filter(e => e.id !== origId),
      seg1, seg2, dotEdge,
    ])
    setNodes(ns => [...ns, midNode, {
      id: dotNodeId, type: 'ontologyNode', position: dotNodePos, data: dotNodeData,
    }])

    // 8. Resolve color async
    try {
      const { color } = await resolveNodeColor(dotItem.uri)
      setNodes(ns => ns.map(n => n.id === dotNodeId ? { ...n, data: { ...n.data, nodeColor: color } } : n))
    } catch {}

    toast.success(`Dot-One: ${origLabel} .${dotOneProp.split(/[#/:]/).pop()} → ${dotItem.label}`)
    setPendingDotOne(null)
  }, [pendingDotOne, setEdges, setNodes, makeNodeData, resolveNodeColor, toast])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    const raw    = e.dataTransfer.getData('application/ontology')
    const colRaw = e.dataTransfer.getData('application/column')

    if (colRaw) {
      const col = JSON.parse(colRaw)
      const hit = findNodeAtScreenPos(e.clientX, e.clientY)
      if (hit) {
        const bounds  = rfWrapper.current.getBoundingClientRect()
        const flowPos = rfInstance.screenToFlowPosition({ x: e.clientX - bounds.left, y: e.clientY - bounds.top })
        const midY    = hit.position.y + (hit.height ?? 100) / 2
        if (flowPos.y < midY) handleLabelColumnDrop(hit.id, col)
        else                  handleColumnDrop(hit.id, col)
      } else {
        toast.error('Missed the node — try dropping closer to it')
      }
      return
    }

    if (!raw) return
    const item   = JSON.parse(raw)
    const bounds = rfWrapper.current.getBoundingClientRect()
    const pos    = rfInstance.screenToFlowPosition({ x: e.clientX - bounds.left, y: e.clientY - bounds.top })

    // ── Check if dropped on an existing edge → Dot-One attachment ────────────
    // Strategy 1: proximity-based hit test (zoom-aware)
    const hitEdge = findEdgeAtPos(pos)
    // Strategy 2: if an edge is currently selected and no node was hit, use that
    const selectedEdge = !hitEdge ? rfInstance.getEdges().find(e => e.selected) : null
    const dotOneEdge = hitEdge || selectedEdge

    if (dotOneEdge && (item.type === 'subject' || item.type === 'object')) {
      const allNodes = rfInstance.getNodes()
      // Make sure we didn't land on a node (node-drop takes priority)
      const hitNode = allNodes.find(n => {
        const w = n.width ?? 200, h = n.height ?? 100
        return pos.x >= n.position.x && pos.x <= n.position.x + w &&
               pos.y >= n.position.y && pos.y <= n.position.y + h
      })
      if (!hitNode) {
        const sourceNode = allNodes.find(n => n.id === dotOneEdge.source)
        const targetNode = allNodes.find(n => n.id === dotOneEdge.target)
        setPendingDotOne({
          edge: dotOneEdge,
          sourceNode,
          targetNode,
          dotItem: item,
        })
        return
      }
    }

    if (item.type === 'subject') {
      const existing = rfInstance.getNodes().find(n => n.data.uri === item.uri)
      if (existing) toast.info(`Hinweis: ${item.label} ist bereits im Graphen`)
      addNodeWithColor(item, 'subject', pos)
    } else if (item.type === 'object') {
      const source = rfInstance.getNodes().find(n => n.selected)
      addNodeWithColor(item, 'object', pos).then(id => {
        if (source && item.predicate) {
          const { srcHandle, tgtHandle } = pickNearestHandles(source, pos)
          setEdges(es => [...es, makeEdge(`e_${source.id}_${id}`, source.id, id, item.predicate, srcHandle, tgtHandle)])
          toast.success(`${source.data.label} → ${item.predicate.label} → ${item.label}`)
        } else if (!source) {
          toast.info('Tip: select a node first, then drop an object for auto-linking')
        }
      })
    }
  }, [rfInstance, findNodeAtScreenPos, findEdgeAtPos, addNodeWithColor, setEdges, handleColumnDrop, handleLabelColumnDrop, pickNearestHandles, toast])

  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }

  const onConnect = useCallback((params) => {
    const allNodes   = rfInstance.getNodes()
    const sourceNode = allNodes.find(n => n.id === params.source)
    const targetNode = allNodes.find(n => n.id === params.target)
    setPendingConnect({ params, sourceNode, targetNode })
  }, [rfInstance])

  const handlePropertyChosen = useCallback((prop) => {
    if (!pendingConnect) return
    const { params } = pendingConnect
    const id = `e_${params.source}_${params.target}_${Date.now()}`
    setEdges(es => addEdge(
      makeEdge(id, params.source, params.target, prop, params.sourceHandle, params.targetHandle),
      es
    ))
    toast.success(`Property "${prop.label}" added`)
    setPendingConnect(null)
  }, [pendingConnect, setEdges, toast])

  // ── Edge double-click → open edit modal ─────────────────────────────────────
  const onEdgeDoubleClick = useCallback((event, edge) => {
    event.stopPropagation()
    const allNodes = rfInstance.getNodes()
    const sourceNode = allNodes.find(n => n.id === edge.source)
    const targetNode = allNodes.find(n => n.id === edge.target)
    setEditingEdge({ edge, sourceNode, targetNode })
  }, [rfInstance])

  const handleEdgeUpdate = useCallback((updatedData) => {
    if (!editingEdge) return
    const eid = editingEdge.edge.id
    setEdges(es => es.map(e => {
      if (e.id !== eid) return e
      return {
        ...e,
        label: updatedData.label || e.label,
        sourceHandle: updatedData.sourceHandle ?? e.sourceHandle,
        targetHandle: updatedData.targetHandle ?? e.targetHandle,
        data: {
          ...e.data,
          label: updatedData.label || e.data?.label,
          propertyUri: updatedData.propertyUri ?? e.data?.propertyUri,
          joinColumnSource: updatedData.joinColumnSource ?? e.data?.joinColumnSource,
          joinColumnTarget: updatedData.joinColumnTarget ?? e.data?.joinColumnTarget,
          dotOne: updatedData.dotOne ?? e.data?.dotOne,
          dotOneTarget: updatedData.dotOneTarget ?? e.data?.dotOneTarget,
        },
      }
    }))
    toast.success('Edge updated')
    setEditingEdge(null)
  }, [editingEdge, setEdges, toast])

  const handleExportGraphML = () => {
    downloadText('ontology-graph.graphml', exportGraphML(rfInstance.getNodes(), rfInstance.getEdges()))
    toast.success('GraphML exported')
  }

  const handleExportImage = async (format) => {
    const viewport = document.querySelector('.react-flow__viewport')
    if (!viewport) { toast.error('No graph to export'); return }
    try {
      const { toPng, toSvg } = await import('html-to-image')
      const allNodes = rfInstance.getNodes()
      if (allNodes.length === 0) { toast.error('Graph is empty'); return }

      const nodesBounds = allNodes.reduce((acc, n) => {
        const x = n.position.x
        const y = n.position.y
        return {
          minX: Math.min(acc.minX, x),
          minY: Math.min(acc.minY, y),
          maxX: Math.max(acc.maxX, x + 240),
          maxY: Math.max(acc.maxY, y + 120),
        }
      }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })

      const padding = 60
      rfInstance.fitBounds({
        x: nodesBounds.minX - padding,
        y: nodesBounds.minY - padding,
        width: nodesBounds.maxX - nodesBounds.minX + padding * 2,
        height: nodesBounds.maxY - nodesBounds.minY + padding * 2,
      }, { duration: 0 })

      await new Promise(r => setTimeout(r, 150))

      const rfEl = rfWrapper.current?.querySelector('.react-flow')
      if (!rfEl) { toast.error('ReactFlow element not found'); return }

      const imageOpts = {
        backgroundColor: '#f4f8f9',
        quality: 1.0,
        pixelRatio: 2,
        skipFonts: true,
        fontEmbedCSS: '',
        filter: (node) => {
          if (node?.classList?.contains('react-flow__minimap')) return false
          if (node?.classList?.contains('react-flow__controls')) return false
          if (node?.classList?.contains('react-flow__attribution')) return false
          return true
        },
        style: {
          fontFamily: "'IBM Plex Sans', 'Segoe UI', Arial, sans-serif",
        },
      }

      if (format === 'svg') {
        const svgData = await toSvg(rfEl, imageOpts)
        const link = document.createElement('a')
        link.download = 'ontology-graph.svg'
        link.href = svgData
        link.click()
        toast.success('SVG exported')
      } else {
        const pngData = await toPng(rfEl, imageOpts)
        const link = document.createElement('a')
        link.download = 'ontology-graph.png'
        link.href = pngData
        link.click()
        toast.success('PNG exported')
      }
    } catch (err) {
      console.error('Image export error:', err)
      toast.error(`Export failed: ${err.message}`)
    }
  }

  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef(null)

  useEffect(() => {
    if (!showExportMenu) return
    const handleClickOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showExportMenu])

  const [rdfExportFormat, setRdfExportFormat] = useState('trig')

  const handleExportRdf = async (fmt) => {
    const format = fmt || rdfExportFormat
    const nsMap = {}
    Object.entries(prefixMap).forEach(([pfx, ns]) => { nsMap[pfx] = ns })
    const result = exportRdfPipelineTSV(rfInstance.getNodes(), rfInstance.getEdges(), tableData, nsMap, idPrefix, namedGraphs)
    if (result.uriRowCount === 0 && result.literalRowCount === 0) {
      toast.error('No data to export — please load a table and assign columns')
      return
    }
    toast.info(`RDF wird generiert (${result.uriRowCount} URI + ${result.literalRowCount} Literal rows)…`)
    try {
      const res = await api.exportRdf(result.uriTSV, result.literalTSV, format)
      if (res.triple_count === 0) {
        // Show debug info to help diagnose
        const dbg = res.debug || {}
        const skipped = (res.skipped_uris || []).slice(0, 5).join(', ')
        toast.error(`0 Triples! Backend hat ${dbg.uri_rows_parsed || 0} URI rows parsed. Skipped: ${skipped || 'none'}. Are all prefixes defined in the Prefix Manager?`)
        console.warn('RDF Export Debug:', res.debug, 'Skipped:', res.skipped_uris)
        return
      }
      downloadText(`ontology-export${res.extension}`, res.rdf, res.mime_type)
      const skippedMsg = res.skipped_uris?.length ? ` (${res.skipped_uris.length} URIs skipped)` : ''
      toast.success(`${res.format} exportiert: ${res.triple_count} Triples${skippedMsg}`)
      if (res.skipped_uris?.length) {
        console.warn('Skipped URIs (unresolved):', res.skipped_uris)
      }
    } catch (e) {
      toast.error('RDF export error: ' + e.message)
    }
  }

  // ── Prefix Manager save handler ─────────────────────────────────────────
  const handlePrefixSave = useCallback((newMap, newIdPrefix) => {
    setPrefixMap(newMap)
    setIdPrefix(newIdPrefix)
    toast.success('Prefixes saved')
  }, [setPrefixMap, setIdPrefix, toast])

  // ── Free Node (custom class, e.g. xsd:date) ────────────────────────────
  const handleAddFreeNode = useCallback(() => {
    const label = freeNodeLabel.trim()
    const uri   = freeNodeUri.trim()
    if (!label) { toast.error('Please enter a class label'); return }

    const id = `n${nodeCounter++}`
    // Determine a color – try to resolve from ontology, or use white
    const nodeData = {
      label:         label,
      uri:           uri || label,
      nodeType:      'subject',
      rdfs_label:    label,
      nodeColor:     uri && uri.includes('xsd:') ? '#86bcc8' :
                     uri && uri.includes('geo:') ? '#94cc7d' :
                     label.startsWith('xsd:') ? '#86bcc8' :
                     label.startsWith('geo:') ? '#94cc7d' : '#e8e8e8',
      mappedColumn:  null,
      labelColumn:   null,
      instanceLabel: '',
      isFreeNode:    true,
      noPrefix:      label.startsWith('xsd:') || label.startsWith('geo:') ||
                     (uri && (uri.includes('xsd:') || uri.includes('XMLSchema') || uri.includes('geo:'))),
      onDelete:           handleDeleteNode,
      onLabelChange:      handleLabelChange,
      onColumnDrop:       handleColumnDrop,
      onLabelColumnDrop:  handleLabelColumnDrop,
      onToggleNoPrefix:   handleToggleNoPrefix,
      onFocus:            handleFocusNode,
    }

    // Place near viewport center
    const viewport = rfInstance.getViewport()
    const pos = rfInstance.screenToFlowPosition({
      x: (rfWrapper.current?.clientWidth  || 800) / 2,
      y: (rfWrapper.current?.clientHeight || 600) / 2,
    })

    setNodes(ns => [...ns, { id, type: 'ontologyNode', position: pos, data: nodeData }])

    // Try to resolve color from ontology (async, best-effort)
    if (uri && !uri.startsWith('xsd:') && !uri.startsWith('geo:')) {
      resolveNodeColor(uri).then(({ color }) => {
        setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, nodeColor: color } } : n))
      }).catch(() => {})
    }

    toast.success(`Free node "${label}" created`)
    setFreeNodeLabel('')
    setFreeNodeUri('')
    setShowFreeNode(false)
  }, [freeNodeLabel, freeNodeUri, rfInstance, setNodes, handleDeleteNode, handleLabelChange,
      handleColumnDrop, handleLabelColumnDrop, handleFocusNode, resolveNodeColor, toast])

  const handleSaveProject = () => {
    const project = { version: 4, idPrefix, prefixMap, wideningParent, wideningChild: widening, namedGraphs, nodes: rfInstance.getNodes(), edges: rfInstance.getEdges() }
    downloadText('ontology-mapper-project.json', JSON.stringify(project, null, 2), 'application/json')
    toast.success('Project saved')
  }

  // ── Graph Verification ──────────────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    const allNodes = rfInstance.getNodes()
    const allEdges = rfInstance.getEdges()
    const issues = []

    if (allNodes.length === 0) {
      toast.info('Nothing to verify — graph is empty')
      return
    }

    // 1. Nodes without any mapped column AND without instanceLabel
    //    (skip dot-one midpoint nodes – they are internal helpers without data)
    for (const n of allNodes) {
      if (n.type === 'dotOneMidpoint') continue
      const d = n.data || {}
      if (!d.mappedColumn && !d.instanceLabel) {
        issues.push({ type: 'warn', node: n.id, msg: `Node "${d.label}" (${n.id}): Neither ID column nor label assigned` })
      }
    }

    // 2. Nodes with mappedColumn but no labelColumn (and vice versa check)
    for (const n of allNodes) {
      if (n.type === 'dotOneMidpoint') continue
      const d = n.data || {}
      if (d.mappedColumn && !d.labelColumn && !d.instanceLabel) {
        issues.push({ type: 'info', node: n.id, msg: `Node "${d.label}" (${n.id}): ID column set but no label — Domain_label/Range_Label will be empty` })
      }
    }

    // 3. Possible ID/Label swap: if mappedColumn values look like labels (contain spaces)
    for (const n of allNodes) {
      if (n.type === 'dotOneMidpoint') continue
      const d = n.data || {}
      if (d.mappedColumn && d.tableRows?.length > 0) {
        const firstVal = String(d.tableRows[0][d.mappedColumn] ?? '')
        if (firstVal && /\s/.test(firstVal) && !/^"/.test(firstVal)) {
          issues.push({ type: 'warn', node: n.id, msg: `Node "${d.label}" (${n.id}): ID column "${d.mappedColumn}" contains spaces ("${firstVal.slice(0,30)}…") – possibly ID and label swapped?` })
        }
      }
      if (d.labelColumn && d.tableRows?.length > 0) {
        const firstVal = String(d.tableRows[0][d.labelColumn] ?? '')
        if (firstVal && /^[a-z]+:/.test(firstVal)) {
          issues.push({ type: 'warn', node: n.id, msg: `Node "${d.label}" (${n.id}): Label column "${d.labelColumn}" looks like a URI ("${firstVal.slice(0,30)}") – possibly ID and label swapped?` })
        }
      }
    }

    // 4. Orphan nodes (no edges) – skip dot-one midpoints
    const connected = new Set()
    for (const e of allEdges) { connected.add(e.source); connected.add(e.target) }
    for (const n of allNodes) {
      if (n.type === 'dotOneMidpoint') continue
      if (!connected.has(n.id)) {
        issues.push({ type: 'info', node: n.id, msg: `Node "${n.data?.label}" (${n.id}): Nicht verbunden (none Edges)` })
      }
    }

    // 5. Edges with widened properties (ontology check)
    for (const e of allEdges) {
      const src = allNodes.find(n => n.id === e.source)
      if (!src?.data?.uri || !e.data?.propertyUri) continue
      try {
        // Check strict mode (no widening)
        const strictResult = await api.getProperties(src.data.uri, '', false)
        const strictUris = new Set(strictResult.properties.map(p => p.uri))
        if (!strictUris.has(e.data.propertyUri)) {
          // Check if it's available with widening
          const widenResult = await api.getProperties(src.data.uri, '', true)
          const widenProp = widenResult.properties.find(p => p.uri === e.data.propertyUri)
          if (widenProp?.widened_from?.length > 0) {
            const from = widenProp.widened_from.map(u => u.split(/[#/]/).pop()).join(', ')
            issues.push({ type: 'warn', node: src.id, msg: `Edge "${e.data.label}" (${src.data.label}→): Widening — property is actually defined on subclass (${from})` })
          } else if (!widenResult.properties.find(p => p.uri === e.data.propertyUri)) {
            issues.push({ type: 'error', node: src.id, msg: `Edge "${e.data.label}" (${src.data.label}→): Property not found in ontology for this subject` })
          }
        }
      } catch (_) {
        // Backend offline or other error – skip this check
      }
    }

    // 6. Cross-table edges without join key
    for (const e of allEdges) {
      const src = allNodes.find(n => n.id === e.source)
      const tgt = allNodes.find(n => n.id === e.target)
      if (!src || !tgt) continue
      const sd = src.data || {}, td = tgt.data || {}
      if (sd.mappedColumn && td.mappedColumn && sd.tableId && td.tableId && sd.tableId !== td.tableId) {
        if (!e.data?.joinColumnSource && !e.data?.joinColumnTarget && !e.data?.joinColumn && !sd.joinColumn && !td.joinColumn) {
          issues.push({ type: 'info', node: src.id, msg: `Edge "${e.data?.label}" (${sd.label}→${td.label}): Cross-table without join key — set in property dialog or edge edit` })
        }
      }
    }

    setVerifyResults(issues)
    if (issues.length === 0) {
      toast.success('✓ No issues found')
    } else {
      const errors = issues.filter(i => i.type === 'error').length
      const warns = issues.filter(i => i.type === 'warn').length
      const infos = issues.filter(i => i.type === 'info').length
      toast.info(`Verification: ${errors} errors, ${warns} warnings, ${infos} hints`)
    }
  }, [rfInstance, toast])

  const handleLoadProject = () => { loadInputRef.current?.click() }

  const handleLoadFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const project = JSON.parse(ev.target.result)
        if (!project.nodes || !project.edges) throw new Error('Invalid project format')

        // Re-attach all callbacks – they cannot be serialised to JSON
        const restoredNodes = project.nodes.map(n => ({
          ...n,
          data: {
            ...n.data,
            onDelete:          handleDeleteNode,
            onLabelChange:     handleLabelChange,
            onColumnDrop:      handleColumnDrop,
            onLabelColumnDrop: handleLabelColumnDrop,
            onToggleNoPrefix:  handleToggleNoPrefix,
            onFocus:           handleFocusNode,
          },
        }))

        setNodes(restoredNodes)

        // ── Migrate edges from old joinColumn to joinColumnSource/joinColumnTarget ──
        const migratedEdges = (project.edges || []).map(e => {
          if (e.data?.joinColumn && !e.data?.joinColumnSource && !e.data?.joinColumnTarget) {
            return { ...e, data: { ...e.data, joinColumnTarget: e.data.joinColumn, joinColumn: undefined } }
          }
          return e
        })
        setEdges(migratedEdges)

        if (project.idPrefix !== undefined) setIdPrefix(project.idPrefix)
        if (project.prefixMap) setPrefixMap(project.prefixMap)
        // v4: split widening; backward compat with v3 single widening flag
        if (project.wideningParent !== undefined) setWideningParent(project.wideningParent)
        if (project.wideningChild !== undefined) setWidening(project.wideningChild)
        else if (project.widening !== undefined) setWidening(project.widening)
        if (project.namedGraphs) setNamedGraphs(project.namedGraphs)
        // Fix nodeCounter to avoid ID collisions
        const maxId = Math.max(0, ...project.nodes.map(n => parseInt(n.id.replace('n',''))||0))
        nodeCounter = maxId + 1
        setVerifyResults(null)
        toast.success(`Project loaded: ${project.nodes.length} Nodes, ${project.edges.length} Edges`)
      } catch (err) {
        toast.error('Error loading: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const nodeCount = rfInstance.getNodes().length
  const edgeCount = rfInstance.getEdges().length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 16px', height: 42, flexShrink: 0,
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo.png" alt="Table2Knowledge" style={{ height: 28 }} />
          <span style={{ fontFamily: 'var(--font)', fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.02em' }}>
            Table<span style={{ color: '#1f8da6' }}>2</span><span style={{ color: '#a8326a' }}>Knowledge</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Studio</span>
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 6, padding: 2 }}>
          {[
            { id: PANEL_ONTOLOGY, icon: <Layers size={11} />, label: 'Ontologies' },
            { id: PANEL_TABLE,    icon: <Table  size={11} />, label: 'Tables'  },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActivePanel(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 12px', borderRadius: 4, fontSize: 11,
              background: activePanel === tab.id ? 'var(--bg-card)' : 'transparent',
              color:      activePanel === tab.id ? 'var(--text)'    : 'var(--text-muted)',
              border:     activePanel === tab.id ? '1px solid var(--border)' : '1px solid transparent',
            }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <button className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
          onClick={() => {
            setShowPrefixManager(true)
            // Load ontology namespaces for quick-add
            api.getNamespaces().then(r => {
              const ns = r.namespaces || {}
              setOntologyPrefixes(
                Object.entries(ns)
                  .filter(([p, u]) => p && u && !['xml','xmlns'].includes(p))
                  .map(([prefix, namespace]) => ({ prefix, namespace }))
              )
            }).catch(() => {})
          }}
          title="Namespace-Prefix Manager – ID-Prefix und alle Namespaces verwalten"
        >
          <Tag size={11} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{idPrefix || '?'}:</span>
          <span>Prefixes</span>
          <span style={{
            fontSize: 9, padding: '0 4px', borderRadius: 3,
            background: 'var(--accent-glow)', color: 'var(--accent)',
          }}>
            {Object.keys(prefixMap).length}
          </span>
        </button>
        <button className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
          onClick={() => setShowFreeNode(v => !v)}
          title="Create free node with custom class (e.g. xsd:date, geo:wktLiteral)"
        >
          <PlusCircle size={11} /> Node
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }} onClick={handleSaveProject}>
          <Save size={11} /> Save
        </button>
        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }} onClick={handleLoadProject}>
          <FolderOpen size={11} /> Load
        </button>
        <input ref={loadInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoadFile} />
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <button
          onClick={() => setWideningParent(w => !w)}
          title={wideningParent ? 'Parent Widening ON: Also offers inherited properties from superclasses' : 'Parent Widening OFF: Only direct properties (no inheritance)'}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '4px 8px',
            borderRadius: 4, cursor: 'pointer', border: '1px solid',
            background: wideningParent ? 'rgba(91,141,238,0.12)' : 'var(--bg)',
            borderColor: wideningParent ? 'rgba(91,141,238,0.35)' : 'var(--border)',
            color: wideningParent ? 'var(--accent)' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          <ChevronsDownUp size={10} style={{ transform: 'rotate(180deg)' }} />
          <span>↑ Parent</span>
          <span style={{
            fontSize: 8, padding: '0 4px', borderRadius: 3,
            background: wideningParent ? 'rgba(91,141,238,0.2)' : 'var(--bg-card)',
            color: wideningParent ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: 600,
          }}>
            {wideningParent ? 'ON' : 'OFF'}
          </span>
        </button>
        <button
          onClick={() => setWidening(w => !w)}
          title={widening ? 'Child Widening ON: Also offers properties from subclasses' : 'Child Widening OFF: No properties from subclasses'}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '4px 8px',
            borderRadius: 4, cursor: 'pointer', border: '1px solid',
            background: widening ? 'rgba(255,179,0,0.12)' : 'var(--bg)',
            borderColor: widening ? 'rgba(255,179,0,0.35)' : 'var(--border)',
            color: widening ? '#d48c1a' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          <ChevronsDownUp size={10} />
          <span>↓ Child</span>
          <span style={{
            fontSize: 8, padding: '0 4px', borderRadius: 3,
            background: widening ? 'rgba(255,179,0,0.2)' : 'var(--bg-card)',
            color: widening ? '#d48c1a' : 'var(--text-muted)',
            fontWeight: 600,
          }}>
            {widening ? 'ON' : 'OFF'}
          </span>
        </button>
        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }} onClick={handleVerify}>
          <ShieldCheck size={11} /> Verify
        </button>
        <button
          className="btn-secondary"
          style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
            background: showGraphPanel ? 'rgba(168,50,106,0.1)' : undefined,
            borderColor: showGraphPanel ? 'rgba(168,50,106,0.35)' : undefined,
            color: showGraphPanel ? '#a8326a' : undefined,
          }}
          onClick={() => setShowGraphPanel(v => !v)}
          title="Named Graphs (I4_Proposition_Set) verwalten"
        >
          <Group size={11} /> Graphs
          {namedGraphs.length > 0 && (
            <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 3, background: 'rgba(168,50,106,0.15)', color: '#a8326a' }}>
              {namedGraphs.length}
            </span>
          )}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <div style={{ position: 'relative' }} ref={exportMenuRef}>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
            onClick={() => setShowExportMenu(m => !m)}>
            <Download size={11} /> Export <ChevronDown size={9} />
          </button>
          {showExportMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              minWidth: 170, overflow: 'hidden',
            }}>
              <button style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px',
                background: 'transparent', color: 'var(--text)', fontSize: 11, textAlign: 'left',
                borderBottom: '1px solid var(--border)',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { handleExportGraphML(); setShowExportMenu(false) }}>
                <Download size={12} color="var(--text-dim)" />
                <div>
                  <div style={{ fontWeight: 500 }}>GraphML</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>yEd-compatible with colors</div>
                </div>
              </button>
              <button style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px',
                background: 'transparent', color: 'var(--text)', fontSize: 11, textAlign: 'left',
                borderBottom: '1px solid var(--border)',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { handleExportImage('png'); setShowExportMenu(false) }}>
                <Image size={12} color="var(--text-dim)" />
                <div>
                  <div style={{ fontWeight: 500 }}>PNG (Bild)</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Publication-ready, 2× resolution</div>
                </div>
              </button>
              <button style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px',
                background: 'transparent', color: 'var(--text)', fontSize: 11, textAlign: 'left',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { handleExportImage('svg'); setShowExportMenu(false) }}>
                <Image size={12} color="var(--text-dim)" />
                <div>
                  <div style={{ fontWeight: 500 }}>SVG (Vektor)</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Scalable, editable</div>
                </div>
              </button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <select value={rdfExportFormat} onChange={e => setRdfExportFormat(e.target.value)}
            style={{ fontSize: 10, padding: '4px 4px', fontFamily: 'var(--mono)', width: 62, borderRadius: '4px 0 0 4px', borderRight: 'none' }}
            title="Choose RDF export format">
            <option value="trig">TriG</option>
            <option value="nq">N-Quads</option>
            <option value="turtle">Turtle</option>
            <option value="xml">RDF/XML</option>
            <option value="nt">N-Triples</option>
            <option value="jsonld">JSON-LD</option>
          </select>
          <button style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, borderRadius: '0 4px 4px 0',
              background: '#a8326a', color: '#fff', padding: '6px 14px', fontWeight: 500,
            }}
            onClick={() => handleExportRdf()}
            title="Direct RDF export of all instance data incl. Named Graphs">
            <Download size={11} /> RDF
          </button>
        </div>
        <button
          style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500,
            background: showPipeline ? '#c99a00' : '#ffb300', color: '#1e2d33',
            padding: '6px 14px', borderRadius: 'var(--radius)',
          }}
          onClick={() => setShowPipeline(true)}
          title="RDF Pipeline: Export → Ontotext Refine → GraphDB"
        >
          <Database size={11} /> RDF Pipeline
        </button>
      </div>

      {/* Named Graph panel */}
      {showGraphPanel && (
        <div style={{
          background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
          padding: '8px 16px', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#a8326a', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Named Graphs (I4_Proposition_Set)
            </span>
            <div style={{ flex: 1 }} />
            <input
              placeholder="Graph label (e.g. example:E19_Finds)"
              value={ngLabel}
              onChange={e => setNgLabel(e.target.value)}
              style={{ width: 220, fontSize: 10, padding: '3px 7px', fontFamily: 'var(--mono)' }}
            />
            <button className="btn-primary" style={{ fontSize: 10, padding: '3px 10px' }} onClick={() => {
              if (!ngLabel.trim()) return
              const selectedNodes = rfInstance.getNodes().filter(n => n.selected).map(n => n.id)
              if (selectedNodes.length === 0) { toast.error('Please select nodes in the graph first (Shift+Click or drag a selection box)'); return }
              const ng = { id: `ng_${Date.now()}`, label: ngLabel.trim(), nodeIds: selectedNodes,
                color: ['#1f8da6','#a8326a','#32A88B','#d48c1a','#c94052','#7b68a8'][namedGraphs.length % 6] }
              setNamedGraphs(gs => [...gs, ng])
              setNgLabel('')
              toast.success(`Graph "${ng.label}" created with ${selectedNodes.length} Nodes`)
            }}>
              Selection → Graph
            </button>
          </div>
          {namedGraphs.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Select nodes in the graph (Shift+Click or drag), enter a label and click "Selection → Graph"
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {namedGraphs.map(ng => (
                <div key={ng.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                  background: 'var(--bg)', borderRadius: 4, border: `1px solid ${ng.color}33`,
                  cursor: 'pointer',
                }}
                  onClick={(e) => {
                    // Prevent click on child buttons from triggering this
                    if (e.target.closest('button')) return
                    // Select all nodes of this named graph and fit view to them
                    const ngSet = new Set(ng.nodeIds)
                    setNodes(ns => ns.map(n => ({ ...n, selected: ngSet.has(n.id) })))
                    // Compute bounding box and show overlay
                    setTimeout(() => {
                      const matchedNodes = rfInstance.getNodes().filter(n => ngSet.has(n.id))
                      if (matchedNodes.length > 0) {
                        const xs = matchedNodes.map(n => n.position.x)
                        const ys = matchedNodes.map(n => n.position.y)
                        const padding = 40
                        const bounds = {
                          x: Math.min(...xs) - padding,
                          y: Math.min(...ys) - padding,
                          width: Math.max(...xs) - Math.min(...xs) + 260 + padding * 2,
                          height: Math.max(...ys) - Math.min(...ys) + 120 + padding * 2,
                        }
                        setHighlightNg({ nodeIds: ng.nodeIds, color: ng.color, label: ng.label, bounds })
                        rfInstance.fitBounds({
                          x: bounds.x - 40,
                          y: bounds.y - 40,
                          width: bounds.width + 80,
                          height: bounds.height + 80,
                        }, { duration: 300 })
                      }
                    }, 50)
                    toast.info(`${ng.nodeIds.length} Nodes von "${ng.label}" selected`)
                  }}
                  title="Click to highlight and show nodes"
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ng.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: ng.color, flex: 1 }}>{ng.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{ng.nodeIds.length} Nodes</span>
                  <button className="btn-ghost" style={{ padding: '1px 4px', fontSize: 9, color: 'var(--text-muted)' }}
                    onClick={() => {
                      // Re-select: update nodeIds from currently selected nodes
                      const sel = rfInstance.getNodes().filter(n => n.selected).map(n => n.id)
                      if (sel.length === 0) { toast.error('Please select nodes'); return }
                      setNamedGraphs(gs => gs.map(g => g.id === ng.id ? { ...g, nodeIds: sel } : g))
                      toast.success(`Graph "${ng.label}" updated: ${sel.length} Nodes`)
                    }}
                    title="Update selection"
                  >↻</button>
                  <button className="btn-ghost" style={{ padding: '1px 4px' }}
                    onClick={() => setNamedGraphs(gs => gs.filter(g => g.id !== ng.id))}>
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Free Node creation panel */}
      {showFreeNode && (
        <div style={{
          background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
          padding: '8px 16px', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Free node
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              Define custom class (e.g. xsd:date, geo:wktLiteral, or any URI)
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn-ghost" style={{ padding: '1px 4px' }} onClick={() => setShowFreeNode(false)}>
              <X size={10} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Class label *</span>
              <input
                value={freeNodeLabel}
                onChange={e => setFreeNodeLabel(e.target.value)}
                placeholder="z.B. xsd:date"
                style={{ width: 180, fontSize: 11, padding: '4px 8px', fontFamily: 'var(--mono)' }}
                onKeyDown={e => e.key === 'Enter' && handleAddFreeNode()}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>URI (optional)</span>
              <input
                value={freeNodeUri}
                onChange={e => setFreeNodeUri(e.target.value)}
                placeholder="z.B. http://www.w3.org/2001/XMLSchema#date"
                style={{ width: 340, fontSize: 11, padding: '4px 8px', fontFamily: 'var(--mono)' }}
                onKeyDown={e => e.key === 'Enter' && handleAddFreeNode()}
              />
            </div>
            <button className="btn-primary" style={{ fontSize: 11, padding: '6px 14px', marginTop: 12 }}
              onClick={handleAddFreeNode}>
              <PlusCircle size={11} style={{ marginRight: 4 }} /> Create
            </button>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
            Tip: The node will be placed in the center of the graph. Label is used as class name.
            If no URI is specified, the label is used as the URI.
            Prefixes like <code style={{ fontFamily: 'var(--mono)' }}>xsd:</code> are resolved via the Prefix Manager.
          </div>
        </div>
      )}

      {/* Verification results panel */}
      {verifyResults && verifyResults.length > 0 && (
        <div style={{
          background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
          padding: '6px 16px', maxHeight: 160, overflowY: 'auto', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Verification: {verifyResults.length} {verifyResults.length === 1 ? 'issue' : 'issues'}
            </span>
            <button className="btn-ghost" style={{ padding: '1px 4px' }} onClick={() => setVerifyResults(null)}>
              <X size={10} />
            </button>
          </div>
          {verifyResults.map((issue, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              padding: '3px 0', fontSize: 11,
              color: issue.type === 'error' ? '#c94052' : issue.type === 'warn' ? '#d48c1a' : 'var(--text-muted)',
            }}>
              <span style={{ flexShrink: 0, fontSize: 10, marginTop: 1 }}>
                {issue.type === 'error' ? '●' : issue.type === 'warn' ? '▲' : '○'}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{issue.msg}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: leftWidth, flexShrink: 0, borderRight: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: activePanel === PANEL_ONTOLOGY ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <OntologyPanel widening={widening} wideningParent={wideningParent} />
          </div>
          <div style={{ display: activePanel === PANEL_TABLE ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <TablePanel onAllRowsUpdate={() => {}} />
          </div>
        </div>
        <div className="resize-handle" onMouseDown={onMouseDownResize} />
        <div ref={rfWrapper} style={{ flex: 1, position: 'relative' }} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect} nodeTypes={nodeTypes}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onPaneClick={() => setHighlightNg(null)}
            onMoveEnd={() => {
              // Force re-render of bounding box after pan/zoom
              if (highlightNg) setHighlightNg(h => h ? { ...h } : null)
            }}
            elementsSelectable={true}
            fitView deleteKeyCode="Delete"
            defaultEdgeOptions={{ focusable: true, style: EDGE_STYLE }}
          >
            <Background variant={BackgroundVariant.Dots} color="var(--border)" gap={22} size={1} />
            <Controls />
            <MiniMap nodeColor={n => n.data?.nodeColor || '#cccccc'} maskColor="rgba(240,245,246,0.85)"
              style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }} />
          </ReactFlow>
          {highlightNg && highlightNg.bounds && (
            <BoundingBoxOverlay bounds={highlightNg.bounds} color={highlightNg.color} label={highlightNg.label} rfInstance={rfInstance} />
          )}
          {nodeCount > 0 && (
            <div style={{
              position: 'absolute', bottom: 12, left: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '3px 10px',
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)', pointerEvents: 'none',
            }}>
              {nodeCount} Nodes · {edgeCount} Edges
              {edges.some(e => e.selected) && (
                <span style={{ color: '#a8326a', marginLeft: 8 }}>
                  ⊙ Edge selected — drag a class here for Dot-One
                </span>
              )}
            </div>
          )}
          {nodeCount === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', gap: 12,
            }}>
              <img src="/logo.png" alt="Table2Knowledge" style={{ height: 100, opacity: 0.8 }} />
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', lineHeight: 2.2 }}>
                <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>Conceptual Graph</div>
                <div style={{ fontSize: 11 }}>① Load ontology → ② Select subject → ③ Drag node here</div>
                <div style={{ fontSize: 10 }}>Select node → Drop object = automatic linking</div>
                <div style={{ fontSize: 10 }}>Draw connection between nodes → Property selection from ontology</div>
                <div style={{ fontSize: 10 }}>Click edge + drag class onto it = Dot-One · Double-click edge = edit</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingConnect && (
        <PropertyPickerModal
          sourceNode={pendingConnect.sourceNode}
          targetNode={pendingConnect.targetNode}
          onConfirm={handlePropertyChosen}
          onCancel={() => setPendingConnect(null)}
          widening={widening}
          wideningParent={wideningParent}
        />
      )}

      {editingEdge && (
        <EdgeEditModal
          edge={editingEdge.edge}
          sourceNode={editingEdge.sourceNode}
          targetNode={editingEdge.targetNode}
          onConfirm={handleEdgeUpdate}
          onCancel={() => setEditingEdge(null)}
        />
      )}

      {pendingDotOne && (
        <DotOneModal
          edge={pendingDotOne.edge}
          sourceNode={pendingDotOne.sourceNode}
          targetNode={pendingDotOne.targetNode}
          dotItem={pendingDotOne.dotItem}
          onConfirm={handleDotOneConfirm}
          onCancel={() => setPendingDotOne(null)}
        />
      )}

      {showPipeline && (
        <RdfPipelineModal
          nodes={rfInstance.getNodes()}
          edges={rfInstance.getEdges()}
          tableData={tableData}
          prefixMap={prefixMap}
          idPrefix={idPrefix}
          namedGraphs={namedGraphs}
          onClose={() => setShowPipeline(false)}
          toast={toast}
        />
      )}

      {showPrefixManager && (
        <PrefixManagerModal
          prefixMap={prefixMap}
          idPrefix={idPrefix}
          onSave={handlePrefixSave}
          onClose={() => setShowPrefixManager(false)}
          ontologyPrefixes={ontologyPrefixes}
          tableData={tableData}
          nodes={rfInstance.getNodes()}
        />
      )}
    </div>
  )
}

export default function App() {
  const { toasts, toast } = useToast()
  const [activePanel, setActivePanel] = useState(PANEL_ONTOLOGY)
  const [leftWidth,   setLeftWidth]   = useState(280)
  const [tableData,   setTableData]   = useState([])
  const [idPrefix,  setIdPrefix]  = useState('oeai')
  const [wideningParent, setWideningParent] = useState(true)
  const [wideningChild, setWideningChild] = useState(false)
  const [prefixMap, setPrefixMap] = useState({
    'crm':        'http://www.cidoc-crm.org/cidoc-crm/',
    'crmarchaeo': 'http://www.cidoc-crm.org/extensions/crmarchaeo/',
    'crmsci':     'http://www.cidoc-crm.org/extensions/crmsci/',
    'lrmoo':      'http://www.cidoc-crm.org/extensions/lrmoo/',
    'rdf':        'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'rdfs':       'http://www.w3.org/2000/01/rdf-schema#',
    'owl':        'http://www.w3.org/2002/07/owl#',
    'xsd':        'http://www.w3.org/2001/XMLSchema#',
  })
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const resizing = useRef(false)
  const startX   = useRef(0)
  const startW   = useRef(0)

  const onMouseDownResize = (e) => {
    resizing.current = true; startX.current = e.clientX; startW.current = leftWidth
    const onMove = (ev) => {
      if (!resizing.current) return
      setLeftWidth(Math.max(200, Math.min(500, startW.current + ev.clientX - startX.current)))
    }
    const onUp = () => {
      resizing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <ReactFlowProvider>
      <GraphInner
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        setNodes={setNodes} setEdges={setEdges}
        toast={toast} tableData={tableData}
        activePanel={activePanel} setActivePanel={setActivePanel}
        leftWidth={leftWidth} onMouseDownResize={onMouseDownResize}
        idPrefix={idPrefix} setIdPrefix={setIdPrefix}
        prefixMap={prefixMap} setPrefixMap={setPrefixMap}
        widening={wideningChild} setWidening={setWideningChild}
        wideningParent={wideningParent} setWideningParent={setWideningParent}
      />
      <ToastContainer toasts={toasts} />
    </ReactFlowProvider>
  )
}
