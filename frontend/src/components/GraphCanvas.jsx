import React, { useState, useCallback, useRef } from 'react'
import ReactFlow, {
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { nodeTypes } from './OntologyNode.jsx'
import { Download, Trash2, Save } from 'lucide-react'
import { exportGraphML, downloadText } from '../utils/graphml.js'

let nodeId = 1

const edgeStyle = {
  stroke: 'var(--orange)',
  strokeWidth: 1.5,
}

const defaultEdgeOptions = {
  style: edgeStyle,
  markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--orange)', width: 16, height: 16 },
  animated: false,
}

export default function GraphCanvas({ onNodeClick, pendingEdge, setPendingEdge, tableColumns }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const reactFlowWrapper = useRef(null)
  const [rfInstance, setRfInstance] = useState(null)

  // Handle column drop on node
  const handleNodeDrop = useCallback((nodeId, column) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, mappedColumn: column } }
        : n
    ))
  }, [setNodes])

  const handleDeleteNode = useCallback((nodeId) => {
    setNodes(nds => nds.filter(n => n.id !== nodeId))
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
  }, [setNodes, setEdges])

  const handleLabelChange = useCallback((nodeId, label) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, instanceLabel: label } } : n
    ))
  }, [setNodes])

  const handleFocusNode = useCallback((nodeId, data) => {
    onNodeClick?.(data)
  }, [onNodeClick])

  const createNode = useCallback((item, position, nodeType = 'subject') => {
    const id = `node_${nodeId++}`
    return {
      id,
      type: 'ontologyNode',
      position,
      data: {
        label: item.label,
        uri: item.uri,
        nodeType,
        rdfs_label: item.rdfs_label,
        mappedColumn: null,
        instanceLabel: '',
        onDelete: handleDeleteNode,
        onLabelChange: handleLabelChange,
        onFocus: handleFocusNode,
      },
    }
  }, [handleDeleteNode, handleLabelChange, handleFocusNode])

  // Drop from ontology panel
  const onDrop = useCallback((e) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/ontology')
    const colRaw = e.dataTransfer.getData('application/column')

    if (!raw && !colRaw) return

    const bounds = reactFlowWrapper.current.getBoundingClientRect()

    // Column dropped on canvas (find nearest node)
    if (colRaw) {
      const col = JSON.parse(colRaw)
      const pos = rfInstance.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      })
      // Find node closest to drop position
      let nearest = null, minDist = Infinity
      for (const n of nodes) {
        const dx = (n.position.x + 80) - pos.x
        const dy = (n.position.y + 30) - pos.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < minDist) { minDist = dist; nearest = n }
      }
      if (nearest && minDist < 120) {
        handleNodeDrop(nearest.id, col.name)
      }
      return
    }

    const item = JSON.parse(raw)
    const pos = rfInstance.screenToFlowPosition({
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top,
    })

    if (item.type === 'subject') {
      const node = createNode(item, pos, 'subject')
      setNodes(nds => [...nds, node])
    } else if (item.type === 'object' && item.predicate) {
      // Check if there's a selected/pending source node
      const sourceNode = nodes.find(n => n.selected)
      const newNode = createNode(item, pos, 'object')
      setNodes(nds => [...nds, newNode])

      if (sourceNode) {
        // Auto-connect with the predicate
        const newEdge = {
          id: `edge_${sourceNode.id}_${newNode.id}`,
          source: sourceNode.id,
          target: newNode.id,
          label: item.predicate.label,
          data: { label: item.predicate.label, propertyUri: item.predicate.uri },
          style: edgeStyle,
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--orange)', width: 16, height: 16 },
          labelStyle: { fill: 'var(--orange)', fontFamily: 'var(--mono)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--bg-card)', fillOpacity: 0.9 },
          labelBgPadding: [4, 6],
        }
        setEdges(eds => [...eds, newEdge])
      }
    }
  }, [rfInstance, nodes, createNode, setNodes, setEdges, handleNodeDrop])

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  // Manual edge connect
  const onConnect = useCallback((params) => {
    // Prompt for property label
    const propLabel = window.prompt('Property URI or label for this connection:', '')
    if (propLabel === null) return
    const edge = {
      ...params,
      label: propLabel,
      data: { label: propLabel, propertyUri: propLabel },
      style: edgeStyle,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--orange)', width: 16, height: 16 },
      labelStyle: { fill: 'var(--orange)', fontFamily: 'var(--mono)', fontSize: 10 },
      labelBgStyle: { fill: 'var(--bg-card)', fillOpacity: 0.9 },
      labelBgPadding: [4, 6],
    }
    setEdges(eds => addEdge(edge, eds))
  }, [setEdges])

  const handleExportGraphML = () => {
    const xml = exportGraphML(nodes, edges)
    downloadText('ontology-graph.graphml', xml)
  }

  const handleClear = () => {
    if (window.confirm('Graphen leeren?')) {
      setNodes([])
      setEdges([])
    }
  }

  // Expose nodes/edges for parent
  React.useEffect(() => {
    if (onNodeClick) {
      // pass up graph state via ref via callback — simplified here
    }
  }, [nodes, edges])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flex: 1, fontFamily: 'var(--mono)' }}>
          {nodes.length} Nodes · {edges.length} Kanten
        </span>
        <button className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }} onClick={handleExportGraphML}>
          <Download size={11} /> GraphML
        </button>
        <button className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--red)' }} onClick={handleClear}>
          <Trash2 size={11} /> Leeren
        </button>
      </div>

      {/* Canvas */}
      <div ref={reactFlowWrapper} style={{ flex: 1 }} onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setRfInstance}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          deleteKeyCode="Delete"
          style={{ background: 'var(--bg)' }}
        >
          <Background variant={BackgroundVariant.Dots} color="var(--border)" gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeColor={n => n.data?.nodeType === 'subject' ? 'var(--accent)' : 'var(--green)'}
            maskColor="rgba(13,15,20,0.8)"
          />
        </ReactFlow>
      </div>

      {/* Hint overlay when empty */}
      {nodes.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none',
          textAlign: 'center', lineHeight: 1.8,
        }}>
          Load ontology → Select subject → Drop node here<br />
          <span style={{ fontSize: 10 }}>Connect nodes: drag handles · Double-click: load subject · Delete: remove</span>
        </div>
      )}
    </div>
  )
}

// Export hook to expose nodes/edges
export function useGraphState() {
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  return { nodes, edges, setNodes, setEdges }
}
