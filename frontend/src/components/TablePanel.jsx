import React, { useState, useCallback } from 'react'
import { Upload, Table, X, GripVertical } from 'lucide-react'

let tableIdCounter = 1

function parseCSV(text, separator = ',') {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ''))
  const allRows = lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const cells = line.split(separator).map(c => c.trim().replace(/^"|"$/g, ''))
      const row = {}
      headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
      return row
    })
  return { headers, rows: allRows.slice(0, 10), allRows }
}

function DraggableColumnHeader({ name, index, tableId, allRows }) {
  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/column', JSON.stringify({ name, index, tableId, allRows }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <th
      draggable
      onDragStart={handleDragStart}
      style={{
        padding: '6px 10px', textAlign: 'left',
        fontFamily: 'var(--mono)', fontSize: 10,
        color: 'var(--accent)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)',
        cursor: 'grab', whiteSpace: 'nowrap', userSelect: 'none',
        position: 'sticky', top: 0, zIndex: 1,
      }}
      title="Drag onto node: upper half = Label, lower half = ID"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <GripVertical size={9} color="var(--text-muted)" />
        {name}
      </div>
    </th>
  )
}

export default function TablePanel({ onAllRowsUpdate }) {
  const [tables, setTables] = useState([])
  const [activeTable, setActiveTable] = useState(0)

  const handleFileUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files)
    const newTables = []

    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase()
      const tid = `tbl_${tableIdCounter++}`

      if (ext === 'csv' || ext === 'tsv') {
        const sep = ext === 'tsv' ? '\t' : ','
        const text = await file.text()
        const parsed = parseCSV(text, sep)
        newTables.push({ name: file.name, tableId: tid, ...parsed })

      } else if (ext === 'xlsx' || ext === 'xls') {
        try {
          const XLSX = await import('xlsx')
          const buf = await file.arrayBuffer()
          const wb = XLSX.read(buf)
          const ws = wb.Sheets[wb.SheetNames[0]]
          const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
          const headers = (data[0] || []).map(String)
          const allRows = data.slice(1).filter(r => r.some(v => v != null && v !== '')).map(row => {
            const obj = {}
            headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
            return obj
          })
          newTables.push({ name: file.name, tableId: tid, headers, rows: allRows.slice(0, 10), allRows })
        } catch (err) {
          console.error('XLSX parse error:', err)
        }
      }
    }

    setTables(ts => {
      const updated = [...ts, ...newTables]
      const last = newTables[newTables.length - 1]
      if (last) onAllRowsUpdate?.(last.allRows)
      setActiveTable(updated.length - 1)
      return updated
    })
    e.target.value = ''
  }, [onAllRowsUpdate])

  const removeTable = (idx) => {
    setTables(ts => ts.filter((_, i) => i !== idx))
    setActiveTable(prev => Math.max(0, prev - (idx <= prev ? 1 : 0)))
  }

  const current = tables[activeTable]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <Table size={12} color="var(--text-muted)" />
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', flex: 1 }}>
          Tables
        </span>
        <label style={{ cursor: 'pointer' }}>
          <input type="file" accept=".csv,.tsv,.xlsx,.xls" multiple style={{ display: 'none' }} onChange={handleFileUpload} />
          <div className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 8px' }}>
            <Upload size={10} /> Load
          </div>
        </label>
      </div>

      {tables.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic' }}>
          Load CSV / TSV / XLSX
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            {tables.map((t, i) => (
              <div key={t.tableId} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 'var(--radius)',
                background: i === activeTable ? 'var(--accent-glow)' : 'var(--bg-card)',
                border: `1px solid ${i === activeTable ? 'var(--accent-dim)' : 'var(--border)'}`,
                cursor: 'pointer', fontSize: 10,
                color: i === activeTable ? 'var(--accent)' : 'var(--text-muted)',
              }} onClick={() => setActiveTable(i)}>
                <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <X size={9} onClick={(e) => { e.stopPropagation(); removeTable(i) }} style={{ cursor: 'pointer' }} />
              </div>
            ))}
          </div>

          <div style={{ padding: '5px 12px', fontSize: 9, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            ⠿ Drag column headers onto nodes · {current?.headers.length} columns · {current?.allRows.length} rows
          </div>

          {current && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {current.headers.map((h, i) => (
                      <DraggableColumnHeader
                        key={i} name={h} index={i}
                        tableId={current.tableId}
                        allRows={current.allRows}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                      {current.headers.map((h, ci) => (
                        <td key={ci} style={{
                          padding: '5px 10px', color: 'var(--text-dim)',
                          fontFamily: 'var(--mono)', fontSize: 10,
                          maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {String(row[h] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
