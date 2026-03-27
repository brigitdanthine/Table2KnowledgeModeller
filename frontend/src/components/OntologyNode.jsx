import React, { useState, useEffect } from 'react'
import { Handle, Position } from 'reactflow'
import { Tag, Link2, X } from 'lucide-react'
import { contrastText } from '../utils/cidocColors.js'

export function OntologyNode({ id, data, selected }) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelValue, setLabelValue]     = useState(data.instanceLabel || '')
  const [overColumn, setOverColumn]     = useState(false)
  const [overLabel,  setOverLabel]      = useState(false)

  useEffect(() => {
    setLabelValue(data.instanceLabel || '')
  }, [data.instanceLabel])

  const bgColor     = data.nodeColor || '#ffffff'
  const textColor   = contrastText(bgColor)
  const borderColor = selected ? adjustColor(bgColor, -40) : adjustColor(bgColor, -25)
  const bodyBg      = mixWithWhite(bgColor, 0.15)

  const handleLabelSubmit = () => {
    setEditingLabel(false)
    data.onLabelChange?.(id, labelValue)
  }

  const dropZone = (zone) => ({
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes('application/column')) return
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      if (zone === 'column') setOverColumn(true)
      else if (zone === 'label') setOverLabel(true)
    },
    onDragLeave: (e) => {
      e.stopPropagation()
      if (zone === 'column') setOverColumn(false)
      else if (zone === 'label') setOverLabel(false)
    },
    onDrop: (e) => {
      const raw = e.dataTransfer.getData('application/column')
      if (!raw) return
      e.preventDefault(); e.stopPropagation()
      setOverColumn(false); setOverLabel(false)
      const col = JSON.parse(raw)
      if (zone === 'column') data.onColumnDrop?.(id, col)
      else if (zone === 'label') data.onLabelColumnDrop?.(id, col)
    },
  })

  const hStyle = {
    background: borderColor,
    width: 9, height: 9,
    border: '2px solid #fff',
    borderRadius: '50%',
    zIndex: 10,
  }

  return (
    <div style={{ position: 'relative', minWidth: 170, maxWidth: 240 }}
      onDoubleClick={() => data.onFocus?.(id, data)}
    >
      <Handle id="l-t" type="target" position={Position.Left}   style={{ ...hStyle, left: -5,   top: '50%' }} />
      <Handle id="l-s" type="source" position={Position.Left}   style={{ ...hStyle, left: -5,   top: '50%' }} />
      <Handle id="r-t" type="target" position={Position.Right}  style={{ ...hStyle, right: -5,  top: '50%' }} />
      <Handle id="r-s" type="source" position={Position.Right}  style={{ ...hStyle, right: -5,  top: '50%' }} />
      <Handle id="t-t" type="target" position={Position.Top}    style={{ ...hStyle, top: -5,    left: '50%' }} />
      <Handle id="t-s" type="source" position={Position.Top}    style={{ ...hStyle, top: -5,    left: '50%' }} />
      <Handle id="b-t" type="target" position={Position.Bottom} style={{ ...hStyle, bottom: -5, left: '50%' }} />
      <Handle id="b-s" type="source" position={Position.Bottom} style={{ ...hStyle, bottom: -5, left: '50%' }} />

      <div style={{
        borderRadius: 6,
        boxShadow: selected
          ? `0 0 0 2px ${borderColor}, 0 6px 20px rgba(0,0,0,0.12)`
          : `0 0 0 1.5px ${borderColor}, 0 3px 10px rgba(0,0,0,0.08)`,
        transition: 'box-shadow 0.15s',
        cursor: 'pointer',
        overflow: 'hidden',
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}>

        <div style={{
          background: bgColor,
          padding: '6px 10px 5px',
          display: 'flex', alignItems: 'center', gap: 5,
          borderBottom: `1px solid ${borderColor}`,
        }}>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, fontWeight: 600,
            color: textColor,
            flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}>
            {data.label}
          </span>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); data.onDelete?.(id) }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '0 2px', opacity: 0.45, color: textColor,
              display: 'flex', alignItems: 'center', transition: 'opacity 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
            onMouseLeave={e => e.currentTarget.style.opacity = 0.45}
          >
            <X size={11} />
          </button>
        </div>

        <div style={{
          background: bodyBg,
          padding: '6px 8px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>

          <div
            {...dropZone('label')}
            title="Drop column → Domain_label / Range_Label"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 6px', borderRadius: 4, minHeight: 24,
              border: `1px ${overLabel ? 'solid' : 'dashed'} ${overLabel ? '#c95d8f' : adjustColor(bgColor, -35)}`,
              background: overLabel ? 'rgba(168,50,106,0.1)' : 'rgba(255,255,255,0.35)',
              transition: 'all 0.12s',
            }}
          >
            <Tag size={9}
              color={data.labelColumn ? '#8a2858' : overLabel ? '#c95d8f' : adjustColor(bgColor, -50)}
              style={{ flexShrink: 0 }}
            />
            {data.labelColumn ? (
              <>
                <span style={{
                  fontSize: 10, color: '#7a2250',
                  fontFamily: "'IBM Plex Mono', monospace",
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {data.labelColumn}
                </span>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); data.onLabelColumnDrop?.(id, null) }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', opacity: 0.5, color: '#8a2858' }}
                >
                  <X size={9} />
                </button>
              </>
            ) : editingLabel ? (
              <input
                autoFocus
                value={labelValue}
                onChange={e => setLabelValue(e.target.value)}
                onBlur={handleLabelSubmit}
                onKeyDown={e => e.key === 'Enter' && handleLabelSubmit()}
                onClick={e => e.stopPropagation()}
                style={{
                  fontSize: 10, padding: '1px 4px', flex: 1,
                  background: 'rgba(255,255,255,0.8)',
                  border: '1px solid rgba(0,0,0,0.2)',
                  borderRadius: 3, color: '#1a1a1a',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
                placeholder="Label / ID…"
              />
            ) : (
              <span
                onClick={(e) => { e.stopPropagation(); setEditingLabel(true) }}
                style={{
                  fontSize: 10,
                  color: labelValue ? darkenColor(bgColor, 60) : (overLabel ? '#8a2858' : adjustColor(bgColor, -55)),
                  flex: 1, cursor: 'text',
                  fontStyle: labelValue ? 'normal' : 'italic',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontFamily: labelValue ? "'IBM Plex Mono', monospace" : 'inherit',
                }}
              >
                {labelValue
                  ? labelValue
                  : overLabel ? '← Drop label column'
                  : 'Label…'}
              </span>
            )}
          </div>

          <div
            {...dropZone('column')}
            title="Drop column → ID_of_Domain / ID_of_the_range"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 6px', borderRadius: 4, minHeight: 24,
              border: `1px ${overColumn ? 'solid' : 'dashed'} ${overColumn ? '#1f8da6' : adjustColor(bgColor, -35)}`,
              background: overColumn ? 'rgba(31,141,166,0.1)' : 'rgba(255,255,255,0.35)',
              transition: 'all 0.12s',
            }}
          >
            <Link2 size={9}
              color={data.mappedColumn ? '#8a2858' : overColumn ? '#1f8da6' : adjustColor(bgColor, -50)}
              style={{ flexShrink: 0 }}
            />
            {data.mappedColumn ? (
              <>
                <span style={{
                  fontSize: 10, color: '#7a2250',
                  fontFamily: "'IBM Plex Mono', monospace",
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {data.mappedColumn}
                </span>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); data.onColumnDrop?.(id, null) }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', opacity: 0.5, color: '#7a2250' }}
                >
                  <X size={9} />
                </button>
              </>
            ) : (
              <span style={{
                fontSize: 9,
                color: overColumn ? '#167a91' : adjustColor(bgColor, -55),
                fontStyle: 'italic', flex: 1,
              }}>
                {overColumn ? '← Drop ID column' : 'ID column…'}
              </span>
            )}
          </div>

          {/* noPrefix toggle – for literal nodes (xsd:date, etc.) */}
          <div
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              data.onToggleNoPrefix?.(id, !data.noPrefix)
            }}
            title={data.noPrefix
              ? 'Literal mode ON: No ID prefix prepended (values stay unchanged)'
              : 'Literal mode OFF: ID prefix will be prepended'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
              fontSize: 9, userSelect: 'none',
              background: data.noPrefix ? 'rgba(31,141,166,0.1)' : 'transparent',
              color: data.noPrefix ? '#1f8da6' : adjustColor(bgColor, -50),
              border: `1px solid ${data.noPrefix ? 'rgba(31,141,166,0.25)' : 'transparent'}`,
              transition: 'all 0.12s',
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: 2,
              border: `1.5px solid ${data.noPrefix ? '#1f8da6' : adjustColor(bgColor, -40)}`,
              background: data.noPrefix ? '#1f8da6' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 7, color: '#fff', fontWeight: 700,
            }}>
              {data.noPrefix ? '✓' : ''}
            </span>
            Literal (no prefix)
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Dot-One Midpoint Node (small dot on edge) ────────────────────────────────
function DotOneMidpoint({ id, data }) {
  const dotStyle = {
    width: 14, height: 14, borderRadius: '50%',
    background: '#a8326a', border: '2px solid #8a2858',
    boxShadow: '0 0 6px rgba(168,50,106,0.3)',
    position: 'relative',
    cursor: 'default',
  }
  const hStyle = {
    background: '#a8326a', width: 7, height: 7,
    border: '1.5px solid #fff', borderRadius: '50%', zIndex: 10,
  }
  return (
    <div style={dotStyle} title={data?.parentEdgeLabel ? `Dot-One on: ${data.parentEdgeLabel}` : 'Dot-One Midpoint'}>
      {/* Incoming handles (from split edge segments) */}
      <Handle id="mid-t-l" type="target" position={Position.Left}   style={{ ...hStyle, left: -4, top: '50%' }} />
      <Handle id="mid-t-t" type="target" position={Position.Top}    style={{ ...hStyle, top: -4, left: '50%' }} />
      <Handle id="mid-t-r" type="target" position={Position.Right}  style={{ ...hStyle, right: -4, top: '50%' }} />
      <Handle id="mid-t-b" type="target" position={Position.Bottom} style={{ ...hStyle, bottom: -4, left: '50%' }} />
      {/* Outgoing handles (to split edge segment + dot-one target) */}
      <Handle id="mid-s-l" type="source" position={Position.Left}   style={{ ...hStyle, left: -4, top: '50%' }} />
      <Handle id="mid-s-t" type="source" position={Position.Top}    style={{ ...hStyle, top: -4, left: '50%' }} />
      <Handle id="mid-s-r" type="source" position={Position.Right}  style={{ ...hStyle, right: -4, top: '50%' }} />
      <Handle id="mid-s-b" type="source" position={Position.Bottom} style={{ ...hStyle, bottom: -4, left: '50%' }} />
      {/* Dedicated dot-one outgoing handle */}
      <Handle id="dot-s" type="source" position={Position.Bottom} style={{ ...hStyle, bottom: -4, left: '50%' }} />
    </div>
  )
}

export const nodeTypes = {
  ontologyNode: OntologyNode,
  dotOneMidpoint: DotOneMidpoint,
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0,2), 16),
    parseInt(h.slice(2,4), 16),
    parseInt(h.slice(4,6), 16),
  ]
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0')).join('')
}

function adjustColor(hex, amount) {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + amount, g + amount, b + amount)
}

function darkenColor(hex, amount) {
  return adjustColor(hex, -amount)
}

function mixWithWhite(hex, factor) {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255-r)*factor, g + (255-g)*factor, b + (255-b)*factor)
}
