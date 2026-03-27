/**
 * RdfPipelineModal.jsx – RDF Pipeline (Table2RDF integration)
 *
 * Three-step wizard replacing the standalone Table2RDF tool:
 *   Step 1: Export URI-expanded TSV (replaces Table2RDF Steps 1-3, no PostgreSQL needed)
 *   Step 2: Ontotext Refine – create project + apply mapping
 *   Step 3: GraphDB – import triples into a repository
 *
 * Each step can be run independently.
 */

import React, { useState, useEffect } from 'react'
import { X, FileDown, Database, Upload, Check, AlertTriangle, Loader, ChevronRight, RefreshCw, Trash2, Plus, Download } from 'lucide-react'
import { api } from '../utils/api.js'
import { exportRdfPipelineTSV, downloadText } from '../utils/graphml.js'

const STEPS = [
  { id: 1, label: 'Export', desc: 'Generate URI-expanded TSV' },
  { id: 2, label: 'Ontotext Refine', desc: 'Project & Mapping' },
  { id: 3, label: 'GraphDB', desc: 'Import triples' },
]

export default function RdfPipelineModal({
  nodes, edges, tableData, prefixMap, idPrefix, namedGraphs,
  onClose, toast,
}) {
  const [step, setStep] = useState(1)

  // Step 1 state
  const [exportResult, setExportResult] = useState(null)
  const [rdfFormat, setRdfFormat] = useState('xml')
  const [rdfExportLoading, setRdfExportLoading] = useState(false)

  // Step 2 state
  const [refineUrl, setRefineUrl] = useState('http://localhost:7333')
  const [jarPath, setJarPath] = useState('')
  const [projectName, setProjectName] = useState('OntologyMapper_Export')
  const [refineLoading, setRefineLoading] = useState(false)
  const [refineResult, setRefineResult] = useState(null)      // { project_id }
  const [refineLitResult, setRefineLitResult] = useState(null) // { project_id }
  const [manualTsv, setManualTsv] = useState('')              // manually loaded TSV content
  const [manualTsvLit, setManualTsvLit] = useState('')         // manually loaded literal TSV
  const [manualTsvName, setManualTsvName] = useState('')
  const [manualTsvLitName, setManualTsvLitName] = useState('')

  // Step 3 state
  const [graphdbUrl, setGraphdbUrl] = useState('http://localhost:7200')
  const [graphdbUser, setGraphdbUser] = useState('')
  const [graphdbPass, setGraphdbPass] = useState('')
  const [repos, setRepos] = useState([])
  const [selectedRepo, setSelectedRepo] = useState('')
  const [newRepoName, setNewRepoName] = useState('')
  const [graphdbLoading, setGraphdbLoading] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [importLitDone, setImportLitDone] = useState(false)
  const [manualProjectId, setManualProjectId] = useState('')        // manual Refine project ID
  const [manualProjectIdLit, setManualProjectIdLit] = useState('')  // manual Refine project ID for literals

  // ── Step 1: Generate export ───────────────────────────────────────────────

  const handleExport = () => {
    const nsMap = {}
    Object.entries(prefixMap).forEach(([pfx, ns]) => { nsMap[pfx] = ns })
    const result = exportRdfPipelineTSV(nodes, edges, tableData, nsMap, idPrefix, namedGraphs)
    setExportResult(result)
    toast.success(`Export: ${result.uriRowCount} URI rows, ${result.literalRowCount} literal rows`)
  }

  const handleDownloadUri = () => {
    if (exportResult?.uriTSV) downloadText('Triples_URI.tsv', exportResult.uriTSV, 'text/tab-separated-values')
  }
  const handleDownloadLit = () => {
    if (exportResult?.literalTSV) downloadText('Triples_URI_literal.tsv', exportResult.literalTSV, 'text/tab-separated-values')
  }

  const handleRdfExport = async () => {
    if (!exportResult) { toast.error('Please generate TSV first'); return }
    setRdfExportLoading(true)
    try {
      const res = await api.exportRdf(exportResult.uriTSV, exportResult.literalTSV, rdfFormat)
      const ext = res.extension || '.rdf'
      const mime = res.mime_type || 'application/rdf+xml'
      downloadText(`ontology-export${ext}`, res.rdf, mime)
      toast.success(`RDF exportiert: ${res.triple_count} Triples (${res.format})`)
    } catch (e) {
      toast.error('RDF export error: ' + e.message)
    } finally {
      setRdfExportLoading(false)
    }
  }

  // ── Step 2: Ontotext Refine ───────────────────────────────────────────────

  // Helper: read a file as text
  const readFileAsText = (file) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('File could not be read'))
    r.readAsText(file)
  })

  const handleLoadManualTsv = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    readFileAsText(file).then(text => {
      setManualTsv(text)
      setManualTsvName(file.name)
      toast.success(`TSV loaded: ${file.name}`)
    })
    e.target.value = ''
  }

  const handleLoadManualTsvLit = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    readFileAsText(file).then(text => {
      setManualTsvLit(text)
      setManualTsvLitName(file.name)
      toast.success(`Literal-TSV loaded: ${file.name}`)
    })
    e.target.value = ''
  }

  // Effective TSV data: manual upload takes priority over Step 1 export
  const effectiveUriTsv = manualTsv || exportResult?.uriTSV || ''
  const effectiveLitTsv = manualTsvLit || exportResult?.literalTSV || ''
  const hasUriData = !!effectiveUriTsv
  const hasLitData = !!effectiveLitTsv

  const handleRefine = async () => {
    if (!hasUriData) { toast.error('No TSV data — please run step 1 or load a TSV file'); return }
    setRefineLoading(true)
    try {
      const res = await api.runOntoRefine(effectiveUriTsv, projectName, refineUrl, jarPath)
      setRefineResult(res)
      toast.success(`Ontotext Refine project created: ID ${res.project_id}`)
    } catch (e) {
      toast.error('Ontotext Refine error: ' + e.message)
    } finally {
      setRefineLoading(false)
    }
  }

  const handleRefineLiterals = async () => {
    if (!hasLitData) {
      toast.info('No literal data available')
      return
    }
    setRefineLoading(true)
    try {
      const res = await api.runOntoRefineLiterals(effectiveLitTsv, projectName, refineUrl, jarPath)
      setRefineLitResult(res)
      toast.success(`Ontotext Refine Literal project: ID ${res.project_id}`)
    } catch (e) {
      toast.error('Ontotext Refine (literals) error: ' + e.message)
    } finally {
      setRefineLoading(false)
    }
  }

  // ── Step 3: GraphDB ───────────────────────────────────────────────────────

  const loadRepos = async () => {
    try {
      const res = await api.getGraphDBRepos(graphdbUrl, graphdbUser, graphdbPass)
      setRepos(res.repos || [])
    } catch (e) {
      toast.error('GraphDB unreachable: ' + e.message)
    }
  }

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) return
    try {
      await api.createGraphDBRepo(graphdbUrl, newRepoName.trim(), newRepoName.trim(), graphdbUser, graphdbPass)
      toast.success(`Repository "${newRepoName.trim()}" created`)
      setNewRepoName('')
      loadRepos()
    } catch (e) {
      toast.error('Repo erstellen fehlgeschlagen: ' + e.message)
    }
  }

  const handleDeleteRepo = async () => {
    if (!selectedRepo) return
    if (!confirm(`Repository "${selectedRepo}" really delete? This action cannot be undone.`)) return
    try {
      await api.deleteGraphDBRepo(graphdbUrl, selectedRepo, graphdbUser, graphdbPass)
      toast.success(`Repository "${selectedRepo}" deleted`)
      setSelectedRepo('')
      loadRepos()
    } catch (e) {
      toast.error('Delete failed: ' + e.message)
    }
  }

  // Effective project IDs: manual entry takes priority
  const effectiveProjectId = manualProjectId.trim() || refineResult?.project_id || ''
  const effectiveProjectIdLit = manualProjectIdLit.trim() || refineLitResult?.project_id || ''

  const handleImport = async () => {
    if (!effectiveProjectId) { toast.error('No project ID — please run step 2 or enter an ID'); return }
    const repo = selectedRepo || newRepoName.trim()
    if (!repo) { toast.error('Please select a repository or enter a new name'); return }
    setGraphdbLoading(true)
    try {
      await api.importToGraphDB(effectiveProjectId, graphdbUrl, repo, repo, graphdbUser, graphdbPass, false)
      setImportDone(true)
      toast.success(`Triples importiert in "${repo}"`)
    } catch (e) {
      toast.error('Import fehlgeschlagen: ' + e.message)
    } finally {
      setGraphdbLoading(false)
    }
  }

  const handleImportLiterals = async () => {
    if (!effectiveProjectIdLit) { toast.error('No literal project ID — please run step 2 or enter an ID'); return }
    const repo = selectedRepo || newRepoName.trim()
    if (!repo) { toast.error('Please select a repository'); return }
    setGraphdbLoading(true)
    try {
      await api.importToGraphDB(effectiveProjectIdLit, graphdbUrl, repo, repo, graphdbUser, graphdbPass, true)
      setImportLitDone(true)
      toast.success(`Literals importiert in "${repo}"`)
    } catch (e) {
      toast.error('Literal-Import fehlgeschlagen: ' + e.message)
    } finally {
      setGraphdbLoading(false)
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  }
  const modalStyle = {
    background: 'var(--bg-panel)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)', width: 680, maxHeight: '85vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }
  const headerStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-card)',
  }
  const bodyStyle = {
    padding: '16px 20px', overflowY: 'auto', flex: 1,
  }
  const fieldStyle = {
    display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12,
  }
  const labelStyle = {
    fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.06em',
  }
  const inputStyle = {
    fontSize: 12, padding: '6px 10px', fontFamily: 'var(--mono)',
  }
  const resultBoxStyle = {
    background: 'rgba(76,175,125,0.08)', border: '1px solid rgba(76,175,125,0.25)',
    borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 11,
    fontFamily: 'var(--mono)', color: 'var(--green)', marginTop: 8,
  }
  const warnBoxStyle = {
    ...resultBoxStyle,
    background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)',
    color: '#d48c1a',
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Database size={16} color="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)', letterSpacing: '0.04em' }}>
              RDF <span style={{ color: 'var(--accent)' }}>Pipeline</span>
            </span>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Step tabs */}
        <div style={{
          display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
        }}>
          {STEPS.map((s, i) => (
            <button key={s.id}
              onClick={() => setStep(s.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, padding: '10px 8px', fontSize: 11, border: 'none',
                borderBottom: step === s.id ? '2px solid var(--accent)' : '2px solid transparent',
                background: step === s.id ? 'var(--bg-panel)' : 'transparent',
                color: step === s.id ? 'var(--text)' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: '50%', fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step === s.id ? 'var(--accent)' : 'var(--border)',
                color: step === s.id ? '#fff' : 'var(--text-muted)',
              }}>
                {/* Show checkmark if step completed */}
                {(s.id === 1 && exportResult) || (s.id === 2 && refineResult) || (s.id === 3 && importDone)
                  ? <Check size={10} /> : s.id}
              </span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 11 }}>{s.label}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{s.desc}</div>
              </div>
              {i < STEPS.length - 1 && <ChevronRight size={12} color="var(--border-bright)" />}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={bodyStyle}>

          {/* ── STEP 1: Export ──────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
                Generates URI-expanded TSV files directly from the current graph.
                All prefixes are automatically resolved to full URIs.
              </p>

              <button className="btn-primary" onClick={handleExport}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 20px' }}>
                <FileDown size={14} /> Generate TSV
              </button>

              {exportResult && (
                <div style={{ marginTop: 16 }}>
                  <div style={resultBoxStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Check size={12} /> Export erfolgreich
                    </div>
                    <div>Triples (URI): <strong>{exportResult.uriRowCount}</strong> Zeilen</div>
                    <div>Literals: <strong>{exportResult.literalRowCount}</strong> Zeilen</div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="btn-secondary" onClick={handleDownloadUri}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                      <Download size={11} /> Triples_URI.tsv
                    </button>
                    {exportResult.literalRowCount > 0 && (
                      <button className="btn-secondary" onClick={handleDownloadLit}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                        <Download size={11} /> Triples_URI_literal.tsv
                      </button>
                    )}
                  </div>

                  {/* RDF Export */}
                  <div style={{
                    marginTop: 14, padding: '10px 14px',
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Direct RDF export (no Ontotext Refine / GraphDB needed)
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select value={rdfFormat} onChange={e => setRdfFormat(e.target.value)}
                        style={{ fontSize: 11, padding: '5px 8px', fontFamily: 'var(--mono)', width: 130 }}>
                        <option value="xml">RDF/XML (.rdf)</option>
                        <option value="turtle">Turtle (.ttl)</option>
                        <option value="nt">N-Triples (.nt)</option>
                        <option value="jsonld">JSON-LD (.jsonld)</option>
                      </select>
                      <button className="btn-primary" onClick={handleRdfExport}
                        disabled={rdfExportLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, opacity: rdfExportLoading ? 0.5 : 1 }}>
                        {rdfExportLoading ? <Loader size={11} className="spin" /> : <Download size={11} />}
                        Export RDF
                      </button>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                      Generiert RDF-Instanzdaten inkl. Typen, Labels, Properties, Dot-One und Literals lokal via rdflib.
                    </div>
                  </div>

                  <div style={{ marginTop: 16, textAlign: 'right' }}>
                    <button className="btn-primary" onClick={() => setStep(2)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                      Continue to Ontotext Refine <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Ontotext Refine ───────────────────────────────── */}
          {step === 2 && (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.6 }}>
                Creates projects in Ontotext Refine and applies the CIDOC CRM mappings.
                <br />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Prerequisite: Ontotext Refine must be running · ontorefine-cli JAR must be available
                </span>
              </p>

              {/* Manual TSV upload section */}
              <div style={{
                background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                padding: '10px 14px', marginBottom: 14,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Data source
                </div>
                {exportResult ? (
                  <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                    <Check size={11} /> Step 1: {exportResult.uriRowCount} URI rows, {exportResult.literalRowCount} literal rows
                  </div>
                ) : !manualTsv && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
                    No export from step 1 available — load custom TSV file:
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, cursor: 'pointer' }}>
                    <Upload size={10} /> Load Triples-TSV
                    <input type="file" accept=".tsv,.csv,.txt" style={{ display: 'none' }} onChange={handleLoadManualTsv} />
                  </label>
                  {manualTsvName && (
                    <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
                      ✓ {manualTsvName}
                      <button className="btn-ghost" style={{ padding: '0 4px', fontSize: 9 }}
                        onClick={() => { setManualTsv(''); setManualTsvName('') }}>
                        <X size={9} />
                      </button>
                    </span>
                  )}

                  <label className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, cursor: 'pointer' }}>
                    <Upload size={10} /> Load Literal-TSV
                    <input type="file" accept=".tsv,.csv,.txt" style={{ display: 'none' }} onChange={handleLoadManualTsvLit} />
                  </label>
                  {manualTsvLitName && (
                    <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
                      ✓ {manualTsvLitName}
                      <button className="btn-ghost" style={{ padding: '0 4px', fontSize: 9 }}
                        onClick={() => { setManualTsvLit(''); setManualTsvLitName('') }}>
                        <X size={9} />
                      </button>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                  Custom TSV files override step 1 data. Format: tab-separated with header row.
                </div>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Ontotext Refine URL</label>
                <input style={inputStyle} value={refineUrl} onChange={e => setRefineUrl(e.target.value)} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Path to the ontorefine-cli JAR (empty = search automatically)</label>
                <input style={inputStyle} value={jarPath} onChange={e => setJarPath(e.target.value)}
                  placeholder="z.B. C:/CRM/ontorefine-cli-1.2.1-jar-with-dependencies.jar" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Name of the project</label>
                <input style={inputStyle} value={projectName} onChange={e => setProjectName(e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-primary" onClick={handleRefine}
                  disabled={refineLoading || !hasUriData}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: (!hasUriData || refineLoading) ? 0.5 : 1 }}>
                  {refineLoading ? <Loader size={12} className="spin" /> : <Upload size={12} />}
                  Triples → Refine
                </button>
                {hasLitData && (
                  <button className="btn-secondary" onClick={handleRefineLiterals}
                    disabled={refineLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: refineLoading ? 0.5 : 1 }}>
                    {refineLoading ? <Loader size={12} className="spin" /> : <Upload size={12} />}
                    Literals → Refine
                  </button>
                )}
              </div>

              {refineResult && (
                <div style={resultBoxStyle}>
                  <Check size={12} style={{ marginRight: 6 }} />
                  Triples project: <strong>ID {refineResult.project_id}</strong>
                </div>
              )}
              {refineLitResult && (
                <div style={{ ...resultBoxStyle, marginTop: 6 }}>
                  <Check size={12} style={{ marginRight: 6 }} />
                  Literal project: <strong>ID {refineLitResult.project_id}</strong>
                </div>
              )}

              {(refineResult || hasUriData) && (
                <div style={{ marginTop: 16, textAlign: 'right' }}>
                  <button className="btn-primary" onClick={() => { setStep(3); loadRepos() }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                    Continue to GraphDB <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: GraphDB ───────────────────────────────────────── */}
          {step === 3 && (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.6 }}>
                Loads the generated triples into a GraphDB repository.
                <br />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Prerequisite: GraphDB must be running
                </span>
              </p>

              {/* Manual project ID section */}
              <div style={{
                background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                padding: '10px 14px', marginBottom: 14,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Ontotext Refine Project IDs
                </div>
                {refineResult && (
                  <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                    <Check size={11} /> Triples project from step 2: <strong style={{ fontFamily: 'var(--mono)' }}>{refineResult.project_id}</strong>
                  </div>
                )}
                {refineLitResult && (
                  <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                    <Check size={11} /> Literal project from step 2: <strong style={{ fontFamily: 'var(--mono)' }}>{refineLitResult.project_id}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...labelStyle, fontSize: 9 }}>Triples project ID (overrides step 2)</label>
                    <input style={inputStyle} value={manualProjectId}
                      onChange={e => setManualProjectId(e.target.value)}
                      placeholder={refineResult?.project_id || 'z.B. 2656649006764'} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...labelStyle, fontSize: 9 }}>Literal project ID (overrides step 2)</label>
                    <input style={inputStyle} value={manualProjectIdLit}
                      onChange={e => setManualProjectIdLit(e.target.value)}
                      placeholder={refineLitResult?.project_id || 'z.B. 2656649006765'} />
                  </div>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                  Enter custom project IDs to use an existing Ontotext Refine project directly (without step 2).
                </div>
              </div>

              {!effectiveProjectId && (
                <div style={warnBoxStyle}>
                  <AlertTriangle size={12} style={{ marginRight: 6 }} />
                  No project ID — please run step 2 or enter an ID above
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ ...fieldStyle, flex: 2 }}>
                  <label style={labelStyle}>GraphDB Server</label>
                  <input style={inputStyle} value={graphdbUrl} onChange={e => setGraphdbUrl(e.target.value)} />
                </div>
                <div style={{ ...fieldStyle, flex: 1 }}>
                  <label style={labelStyle}>User</label>
                  <input style={inputStyle} value={graphdbUser} onChange={e => setGraphdbUser(e.target.value)} placeholder="optional" />
                </div>
                <div style={{ ...fieldStyle, flex: 1 }}>
                  <label style={labelStyle}>Password</label>
                  <input type="password" style={inputStyle} value={graphdbPass} onChange={e => setGraphdbPass(e.target.value)} placeholder="optional" />
                </div>
              </div>

              {/* Repository selection */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <label style={labelStyle}>Repositories</label>
                  <button className="btn-ghost" onClick={loadRepos} style={{ padding: '2px 6px', fontSize: 10 }}>
                    <RefreshCw size={10} /> Load
                  </button>
                </div>
                {repos.length > 0 ? (
                  <div style={{
                    maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', background: 'var(--bg)',
                  }}>
                    {repos.map(r => (
                      <div key={r}
                        onClick={() => setSelectedRepo(r)}
                        style={{
                          padding: '6px 10px', fontSize: 11, fontFamily: 'var(--mono)',
                          cursor: 'pointer',
                          background: selectedRepo === r ? 'var(--accent-glow)' : 'transparent',
                          color: selectedRepo === r ? 'var(--accent)' : 'var(--text-dim)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        {r}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Click "Load" to show available repositories
                  </div>
                )}

                {selectedRepo && (
                  <button className="btn-danger" onClick={handleDeleteRepo}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, marginTop: 6 }}>
                    <Trash2 size={10} /> "{selectedRepo}" delete
                  </button>
                )}
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>New Repository (optional)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={newRepoName}
                    onChange={e => setNewRepoName(e.target.value)}
                    placeholder="Enter new repo name" />
                  <button className="btn-secondary" onClick={handleCreateRepo}
                    disabled={!newRepoName.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, whiteSpace: 'nowrap' }}>
                    <Plus size={10} /> Erstellen
                  </button>
                </div>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  If a name is entered, a new repository will be created. If empty, the selected one above will be used.
                </span>
              </div>

              {/* Import buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-primary" onClick={handleImport}
                  disabled={graphdbLoading || !effectiveProjectId}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: (!effectiveProjectId || graphdbLoading) ? 0.5 : 1 }}>
                  {graphdbLoading ? <Loader size={12} className="spin" /> : <Database size={12} />}
                  Import Knowledge Graph
                </button>
                {effectiveProjectIdLit && (
                  <button className="btn-secondary" onClick={handleImportLiterals}
                    disabled={graphdbLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: graphdbLoading ? 0.5 : 1 }}>
                    {graphdbLoading ? <Loader size={12} className="spin" /> : <Database size={12} />}
                    Import Literals
                  </button>
                )}
              </div>

              {importDone && (
                <div style={resultBoxStyle}>
                  <Check size={12} style={{ marginRight: 6 }} />
                  Triples successfully imported into <strong>{selectedRepo || newRepoName}</strong>
                </div>
              )}
              {importLitDone && (
                <div style={{ ...resultBoxStyle, marginTop: 6 }}>
                  <Check size={12} style={{ marginRight: 6 }} />
                  Literals successfully imported into
                </div>
              )}

              {importDone && (
                <div style={{
                  marginTop: 16, padding: '10px 14px',
                  background: 'var(--accent-glow)', border: '1px solid var(--accent-dim)',
                  borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--accent)',
                }}>
                  Refresh GraphDB in your browser, connect to the repository, and view the knowledge graph at <strong>Graph overview</strong>.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
