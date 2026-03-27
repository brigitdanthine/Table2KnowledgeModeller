import React, { useState, useEffect, useRef } from 'react'
import { Search, X, GitMerge, ChevronRight, Info, Link2, Waypoints } from 'lucide-react'
import { api } from '../utils/api.js'

export default function PropertyPickerModal({ sourceNode, targetNode, onConfirm, onCancel, widening }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [customValue, setCustomValue] = useState('')
  const [mode, setMode] = useState('list')
  const [joinColumn, setJoinColumn] = useState('')
  const [dotOne, setDotOne] = useState('')
  const [dotOneTarget, setDotOneTarget] = useState('')
  const [infoUri, setInfoUri] = useState(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (!sourceNode?.data?.uri) return
    setLoading(true)
    api.getProperties(sourceNode.data.uri, '', widening)
      .then(d => setProperties(d.properties))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false))
  }, [sourceNode, targetNode, widening])

  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 50) }, [])

  const filtered = properties.filter(p =>
    p.label.toLowerCase().includes(search.toLowerCase()) ||
    (p.rdfs_label && p.rdfs_label.toLowerCase().includes(search.toLowerCase())) ||
    p.uri.toLowerCase().includes(search.toLowerCase())
  )

  const direct = filtered.filter(p => !p.inherited_from?.length && !p.widened_from?.length)
  const inherited = filtered.filter(p => p.inherited_from?.length > 0)
  const widened = filtered.filter(p => p.widened_from?.length > 0)

  const handleConfirm = () => {
    const base = mode === 'custom'
      ? { label: customValue.trim(), uri: customValue.trim(), inherited_from: [], widened_from: [] }
      : selected
    if (!base) return
    onConfirm({
      ...base,
      joinColumn: joinColumn.trim() || null,
      dotOne: dotOne.trim() || null,
      dotOneTarget: dotOneTarget.trim() || null,
    })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { if (infoUri) setInfoUri(null); else onCancel() }
    if (e.key === 'Enter' && selected && !infoUri) handleConfirm()
  }

  const handleInfoClick = (e, p) => {
    e.stopPropagation()
    setInfoUri(infoUri === p.uri ? null : p.uri)
  }

  const srcCols = sourceNode?.data?.tableRows?.[0] ? Object.keys(sourceNode.data.tableRows[0]) : []
  const tgtCols = targetNode?.data?.tableRows?.[0] ? Object.keys(targetNode.data.tableRows[0]) : []

  const renderPropRow = (p) => {
    const isWidened = p.widened_from?.length > 0
    const isSel = selected?.uri === p.uri
    return (
      <div key={p.uri}>
        <button
          onClick={() => { setSelected(p); setMode('list') }}
          onDoubleClick={() => { setSelected(p); setMode('list'); setTimeout(handleConfirm, 0) }}
          style={{
            width: '100%', textAlign: 'left', padding: '7px 14px',
            background: isSel ? 'var(--accent-glow)' : 'transparent',
            border: 'none', cursor: 'pointer',
            borderLeft: isSel ? '2px solid var(--accent)' : isWidened ? '2px solid #d48c1a' : '2px solid transparent',
            display: 'flex', flexDirection: 'column', gap: 2, transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: isSel ? 'var(--accent)' : isWidened ? '#d48c1a' : 'var(--text)' }}>
              {p.label}
            </span>
            {(p.rdfs_comment || p.rdfs_label) && (
              <button onClick={(e) => handleInfoClick(e, p)} style={{
                background: infoUri === p.uri ? 'var(--accent-glow)' : 'transparent',
                border: '1px solid', borderColor: infoUri === p.uri ? 'var(--accent-dim)' : 'var(--border)',
                borderRadius: 3, padding: '0 3px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                color: infoUri === p.uri ? 'var(--accent)' : 'var(--text-muted)',
              }} title="Show definition">
                <Info size={9} />
              </button>
            )}
            {p.inherited_from?.length > 0 && (
              <span style={{ fontSize: 9, color: 'var(--text-muted)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)' }}>
                ↑ {p.inherited_from.map(u => u.split(/[#/]/).pop()).join(', ')}
              </span>
            )}
            {isWidened && (
              <span style={{ fontSize: 9, color: '#d48c1a', background: 'rgba(255,179,0,0.1)', padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(255,179,0,0.25)' }}>
                ↓ {p.widened_from.map(u => u.split(/[#/]/).pop()).join(', ')}
              </span>
            )}
          </div>
          {p.rdfs_label && <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 2 }}>{p.rdfs_label}</span>}
        </button>
        {infoUri === p.uri && (p.rdfs_comment || p.rdfs_label) && (
          <div style={{
            padding: '8px 14px 8px 18px', fontSize: 10, color: 'var(--text-dim)',
            background: 'rgba(99,145,234,0.06)', borderLeft: '2px solid var(--accent)',
            lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
          }}>
            {p.rdfs_comment || p.rdfs_label}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-bright)', borderRadius: 10, width: 520, maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.6)', animation: 'modalIn 0.15s ease' }}
        onKeyDown={handleKeyDown}>

        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitMerge size={14} color="var(--orange)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Select property</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{sourceNode?.data?.label}</span>
              <ChevronRight size={10} />
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{targetNode?.data?.label}</span>
            </div>
          </div>
          <button className="btn-ghost" style={{ padding: '3px 6px' }} onClick={onCancel}><X size={13} /></button>
        </div>

        {/* Search */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input ref={searchRef} placeholder="Search property…" value={search}
              onChange={e => { setSearch(e.target.value); setMode('list') }} style={{ paddingLeft: 28, paddingRight: 10 }} />
          </div>
        </div>

        {/* Property list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 80 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>Lade Properties…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>Keine Properties gefunden</div>
          ) : (
            <>
              {direct.length > 0 && (<>
                <div style={{ padding: '5px 14px 3px', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--bg-card)' }}>
                  Direkte Properties ({direct.length})
                </div>
                {direct.map(p => renderPropRow(p))}
              </>)}
              {inherited.length > 0 && (<>
                <div style={{ padding: '5px 14px 3px', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
                  Geerbte Properties ({inherited.length})
                </div>
                {inherited.map(p => renderPropRow(p))}
              </>)}
              {widened.length > 0 && (<>
                <div style={{ padding: '5px 14px 3px', fontSize: 9, color: '#d48c1a', letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(255,179,0,0.05)', borderTop: '1px solid rgba(255,179,0,0.15)' }}>
                  Widening: from subclasses ({widened.length})
                </div>
                {widened.map(p => renderPropRow(p))}
              </>)}
            </>
          )}
        </div>

        {/* ── Edge options ── */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Join-Key per edge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link2 size={10} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Join-Key:</span>
            <select value={joinColumn} onChange={e => setJoinColumn(e.target.value)}
              style={{ flex: 1, fontSize: 10, padding: '3px 6px', fontFamily: 'var(--mono)', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}>
              <option value="">(kein – Auto-Detect)</option>
              {srcCols.length > 0 && (
                <optgroup label={`${sourceNode?.data?.label} (Domain table)`}>
                  {srcCols.map(c => <option key={`s_${c}`} value={c}>{c}</option>)}
                </optgroup>
              )}
              {tgtCols.length > 0 && (
                <optgroup label={`${targetNode?.data?.label} (Range table)`}>
                  {tgtCols.map(c => <option key={`t_${c}`} value={c}>{c}</option>)}
                </optgroup>
              )}
            </select>
          </div>

          {/* Dot-One property */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Waypoints size={10} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Dot-One:</span>
            <input placeholder="Property (e.g. crm:P2_has_type)" value={dotOne}
              onChange={e => setDotOne(e.target.value)}
              style={{ flex: 1, fontSize: 10, padding: '3px 6px', fontFamily: 'var(--mono)' }} />
            <input placeholder="Target-URI" value={dotOneTarget}
              onChange={e => setDotOneTarget(e.target.value)}
              style={{ width: 130, fontSize: 10, padding: '3px 6px', fontFamily: 'var(--mono)' }} />
          </div>

          {/* Custom free-text */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input placeholder="Or free input: Property URI / label…" value={customValue}
              onChange={e => { setCustomValue(e.target.value); if (e.target.value) setMode('custom') }}
              onFocus={() => { if (customValue) setMode('custom') }}
              style={{ flex: 1, fontSize: 11 }} />
          </div>

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn-secondary" style={{ fontSize: 11 }} onClick={onCancel}>Cancel</button>
            <button className="btn-primary"
              style={{ fontSize: 11, opacity: (mode === 'list' && !selected) || (mode === 'custom' && !customValue.trim()) ? 0.4 : 1 }}
              onClick={handleConfirm}
              disabled={(mode === 'list' && !selected) && (mode === 'custom' && !customValue.trim())}>
              {mode === 'custom' ? 'Confirm free input' : selected ? `"${selected.label}" select` : 'Select'}
            </button>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right' }}>
            ℹ = Definition · Double-click = instant · Enter = confirm · Esc = cancel
          </div>
        </div>
      </div>
      <style>{`@keyframes modalIn { from { transform: scale(0.95) translateY(-8px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }`}</style>
    </div>
  )
}
