import React, { useState } from 'react'
import { X, GitMerge, ChevronRight, Link2, Waypoints, Anchor } from 'lucide-react'

/**
 * Modal to edit an existing edge's metadata:
 * - Property label/URI
 * - Join-Key column
 * - Dot-One property + target
 * - Source/Target handles (connection points)
 */

const HANDLE_OPTIONS = [
  { value: 'l', label: '← Links' },
  { value: 'r', label: '→ Rechts' },
  { value: 't', label: '↑ Oben' },
  { value: 'b', label: '↓ Unten' },
]

function parseHandle(handle, type) {
  // handle format: "l-s", "r-t", "b-s", "t-t" etc.
  if (!handle) return type === 'source' ? 'r' : 'l'
  return handle.split('-')[0] || (type === 'source' ? 'r' : 'l')
}

export default function EdgeEditModal({ edge, sourceNode, targetNode, onConfirm, onCancel }) {
  const [label, setLabel] = useState(edge.data?.label || edge.label || '')
  const [propertyUri, setPropertyUri] = useState(edge.data?.propertyUri || '')
  const [joinColumn, setJoinColumn] = useState(edge.data?.joinColumn || '')
  const [dotOne, setDotOne] = useState(edge.data?.dotOne || '')
  const [dotOneTarget, setDotOneTarget] = useState(edge.data?.dotOneTarget || '')
  const [srcSide, setSrcSide] = useState(parseHandle(edge.sourceHandle, 'source'))
  const [tgtSide, setTgtSide] = useState(parseHandle(edge.targetHandle, 'target'))

  const srcCols = sourceNode?.data?.tableRows?.[0] ? Object.keys(sourceNode.data.tableRows[0]) : []
  const tgtCols = targetNode?.data?.tableRows?.[0] ? Object.keys(targetNode.data.tableRows[0]) : []

  const handleConfirm = () => {
    onConfirm({
      label,
      propertyUri,
      joinColumn: joinColumn || null,
      dotOne: dotOne || null,
      dotOneTarget: dotOneTarget || null,
      sourceHandle: `${srcSide}-s`,
      targetHandle: `${tgtSide}-t`,
    })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border-bright)',
          borderRadius: 10, width: 480, maxHeight: '75vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          animation: 'modalIn 0.15s ease',
        }}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') handleConfirm() }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <GitMerge size={14} color="var(--orange)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Edit Edge</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{sourceNode?.data?.label}</span>
              <ChevronRight size={10} />
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--orange)' }}>{label || '?'}</span>
              <ChevronRight size={10} />
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{targetNode?.data?.label}</span>
            </div>
          </div>
          <button className="btn-ghost" style={{ padding: '3px 6px' }} onClick={onCancel}><X size={13} /></button>
        </div>

        {/* Fields */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>

          {/* Property */}
          <div>
            <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
              Property Label
            </label>
            <input value={label} onChange={e => setLabel(e.target.value)}
              style={{ width: '100%', fontSize: 11, fontFamily: 'var(--mono)', padding: '5px 8px' }}
              placeholder="z.B. P2_has_type" />
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
              Property URI
            </label>
            <input value={propertyUri} onChange={e => setPropertyUri(e.target.value)}
              style={{ width: '100%', fontSize: 10, fontFamily: 'var(--mono)', padding: '5px 8px', color: 'var(--text-dim)' }}
              placeholder="http://..." />
          </div>

          {/* Handles */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <Anchor size={9} /> Ausgang (Source)
              </label>
              <div style={{ display: 'flex', gap: 3 }}>
                {HANDLE_OPTIONS.map(h => (
                  <button key={h.value} onClick={() => setSrcSide(h.value)}
                    style={{
                      flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, cursor: 'pointer',
                      border: '1px solid', textAlign: 'center',
                      background: srcSide === h.value ? 'var(--accent-glow)' : 'var(--bg)',
                      borderColor: srcSide === h.value ? 'var(--accent-dim)' : 'var(--border)',
                      color: srcSide === h.value ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <Anchor size={9} /> Eingang (Target)
              </label>
              <div style={{ display: 'flex', gap: 3 }}>
                {HANDLE_OPTIONS.map(h => (
                  <button key={h.value} onClick={() => setTgtSide(h.value)}
                    style={{
                      flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, cursor: 'pointer',
                      border: '1px solid', textAlign: 'center',
                      background: tgtSide === h.value ? 'rgba(76,175,125,0.15)' : 'var(--bg)',
                      borderColor: tgtSide === h.value ? 'rgba(76,175,125,0.4)' : 'var(--border)',
                      color: tgtSide === h.value ? 'var(--green)' : 'var(--text-muted)',
                    }}>
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Join-Key */}
          <div>
            <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <Link2 size={9} /> Join-Key
            </label>
            <select value={joinColumn} onChange={e => setJoinColumn(e.target.value)}
              style={{ width: '100%', fontSize: 10, padding: '5px 8px', fontFamily: 'var(--mono)', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}>
              <option value="">(kein – Auto-Detect)</option>
              {srcCols.length > 0 && (
                <optgroup label={`${sourceNode?.data?.label} (Domain)`}>
                  {srcCols.map(c => <option key={`s_${c}`} value={c}>{c}</option>)}
                </optgroup>
              )}
              {tgtCols.length > 0 && (
                <optgroup label={`${targetNode?.data?.label} (Range)`}>
                  {tgtCols.map(c => <option key={`t_${c}`} value={c}>{c}</option>)}
                </optgroup>
              )}
            </select>
          </div>

          {/* Dot-One */}
          <div>
            <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <Waypoints size={9} /> Dot-One Property
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="Property (e.g. crm:P2_has_type)" value={dotOne}
                onChange={e => setDotOne(e.target.value)}
                style={{ flex: 1, fontSize: 10, padding: '5px 8px', fontFamily: 'var(--mono)' }} />
              <input placeholder="Target-URI" value={dotOneTarget}
                onChange={e => setDotOneTarget(e.target.value)}
                style={{ width: 140, fontSize: 10, padding: '5px 8px', fontFamily: 'var(--mono)' }} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" style={{ fontSize: 11 }} onClick={onCancel}>Cancel</button>
          <button className="btn-primary" style={{ fontSize: 11 }} onClick={handleConfirm}>
            Apply
          </button>
        </div>
        <div style={{ padding: '0 16px 8px', fontSize: 9, color: 'var(--text-muted)', textAlign: 'right' }}>
          Double-click edge = open this dialog · Enter = confirm · Esc = cancel
        </div>
      </div>

      <style>{`@keyframes modalIn { from { transform: scale(0.95) translateY(-8px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }`}</style>
    </div>
  )
}
