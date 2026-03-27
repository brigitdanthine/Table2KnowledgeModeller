import React, { useState, useEffect, useRef } from 'react'
import { X, Waypoints, ChevronRight, Search, Info } from 'lucide-react'
import { api } from '../utils/api.js'

/**
 * Modal shown when a user drags an ontology class onto an existing edge.
 * The dropped class becomes the Dot-One target; the user picks the Dot-One property
 * that connects the main property to this class.
 *
 * Example: Edge "P45_consists_of" gets dot-one "P2_has_type → E55_Type"
 * This means: the P45 relationship itself is typed via P2 as E55_Type.
 */
export default function DotOneModal({ edge, sourceNode, targetNode, dotItem, onConfirm, onCancel }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [customProp, setCustomProp] = useState('')
  const [infoUri, setInfoUri] = useState(null)
  const searchRef = useRef(null)

  // The dotItem is the class dropped on the edge.
  // We need properties that can connect "from the edge's property-reification" to the dotItem.
  // In practice, common dot-one properties are things like P2_has_type, P3_has_note, etc.
  // We fetch properties for the range class of the edge (or a generic set).
  useEffect(() => {
    // Try to get properties that could apply; use E1_CRM_Entity as broad base
    setLoading(true)
    const subjectUri = sourceNode?.data?.uri || 'http://www.cidoc-crm.org/cidoc-crm/E1_CRM_Entity'
    api.getProperties(subjectUri, '', true)
      .then(d => setProperties(d.properties))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false))
  }, [sourceNode])

  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 50) }, [])

  const filtered = properties.filter(p =>
    p.label.toLowerCase().includes(search.toLowerCase()) ||
    (p.rdfs_label && p.rdfs_label.toLowerCase().includes(search.toLowerCase()))
  )

  const edgeLabel = edge.data?.label || edge.label || '(Property)'
  const dotLabel = dotItem?.label || '(Class)'
  const dotUri = dotItem?.uri || ''

  const handleConfirm = () => {
    const propLabel = selected ? selected.label : customProp.trim()
    const propUri = selected ? selected.uri : customProp.trim()
    if (!propLabel) return
    onConfirm(propLabel, dotUri, propUri)
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
          borderRadius: 10, width: 480, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          animation: 'modalIn 0.15s ease',
        }}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && (selected || customProp.trim())) handleConfirm() }}
      >
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Waypoints size={14} color="#a8326a" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Dot-One Property zuweisen</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
              Class <span style={{ fontFamily: 'var(--mono)', color: '#a8326a' }}>{dotLabel}</span> will be
              an Kante <span style={{ fontFamily: 'var(--mono)', color: 'var(--orange)' }}>{edgeLabel}</span> angehängt
            </div>
          </div>
          <button className="btn-ghost" style={{ padding: '3px 6px' }} onClick={onCancel}><X size={13} /></button>
        </div>

        {/* Visual preview */}
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg)', fontSize: 10, fontFamily: 'var(--mono)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <span style={{ color: 'var(--accent)' }}>{sourceNode?.data?.label}</span>
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <span style={{ color: 'var(--orange)', fontWeight: 600 }}>{edgeLabel}</span>
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <span style={{ color: 'var(--green)' }}>{targetNode?.data?.label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 20 }}>
            <span style={{ color: 'var(--text-muted)' }}>└─</span>
            <span style={{ color: '#a8326a', fontStyle: 'italic' }}>dot-one: ?.property</span>
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <span style={{ color: '#a8326a', fontWeight: 600 }}>{dotLabel}</span>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input ref={searchRef} placeholder="Dot-One Property suchen (z.B. P2_has_type)…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 28 }} />
          </div>
        </div>

        {/* Property list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 80, maxHeight: 250 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>Lade Properties…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>Keine Treffer</div>
          ) : (
            filtered.slice(0, 50).map(p => (
              <div key={p.uri}>
                <button
                  onClick={() => setSelected(p)}
                  onDoubleClick={() => { setSelected(p); setTimeout(handleConfirm, 0) }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '6px 14px',
                    background: selected?.uri === p.uri ? 'rgba(168,50,106,0.08)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                    borderLeft: selected?.uri === p.uri ? '2px solid #a8326a' : '2px solid transparent',
                    display: 'flex', flexDirection: 'column', gap: 1, transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (selected?.uri !== p.uri) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { if (selected?.uri !== p.uri) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: selected?.uri === p.uri ? '#a8326a' : 'var(--text)' }}>
                      {p.label}
                    </span>
                    {(p.rdfs_comment || p.rdfs_label) && (
                      <span onClick={(ev) => { ev.stopPropagation(); setInfoUri(infoUri === p.uri ? null : p.uri) }}
                        style={{
                          border: '1px solid var(--border)', borderRadius: 3, padding: '0 3px',
                          cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
                          color: infoUri === p.uri ? 'var(--accent)' : 'var(--text-muted)',
                          background: infoUri === p.uri ? 'var(--accent-glow)' : 'transparent',
                        }}>
                        <Info size={9} />
                      </span>
                    )}
                  </div>
                  {p.rdfs_label && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.rdfs_label}</span>}
                </button>
                {infoUri === p.uri && p.rdfs_comment && (
                  <div style={{
                    padding: '6px 14px 6px 18px', fontSize: 10, color: 'var(--text-dim)',
                    background: 'rgba(168,50,106,0.05)', borderLeft: '2px solid #a8326a',
                    lineHeight: 1.5, maxHeight: 80, overflowY: 'auto',
                  }}>
                    {p.rdfs_comment}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Waypoints size={10} color="#a8326a" />
            <input placeholder="Oder freie Eingabe: Dot-One Property…" value={customProp}
              onChange={e => { setCustomProp(e.target.value); if (e.target.value) setSelected(null) }}
              style={{ flex: 1, fontSize: 11, fontFamily: 'var(--mono)' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn-secondary" style={{ fontSize: 11 }} onClick={onCancel}>Cancel</button>
            <button className="btn-primary" style={{ fontSize: 11, opacity: (!selected && !customProp.trim()) ? 0.4 : 1 }}
              onClick={handleConfirm} disabled={!selected && !customProp.trim()}>
              {selected ? `„${selected.label}" → ${dotLabel}` : 'Assign'}
            </button>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right' }}>
            Drag ontology class onto edge = this dialog · Double-click = instant · Esc = cancel
          </div>
        </div>
      </div>
      <style>{`@keyframes modalIn { from { transform: scale(0.95) translateY(-8px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }`}</style>
    </div>
  )
}
