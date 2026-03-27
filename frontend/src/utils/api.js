const BASE = '/api'

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  health: () => req('/health'),

  uploadOntologies: (files) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    return req('/ontology/upload', { method: 'POST', body: form })
  },

  listOntologies: () => req('/ontology/list'),

  deleteOntology: (filename) =>
    req(`/ontology/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  getClasses: (search = '') =>
    req(`/ontology/classes?search=${encodeURIComponent(search)}`),

  getProperties: (subjectUri, search = '', widening = false) =>
    req(`/ontology/properties?subject_uri=${encodeURIComponent(subjectUri)}&search=${encodeURIComponent(search)}&widening=${widening}`),

  getRange: (subjectUri, propertyUri) =>
    req(`/ontology/range?subject_uri=${encodeURIComponent(subjectUri)}&property_uri=${encodeURIComponent(propertyUri)}`),

  // Hierarchy / inference endpoints (new v1.1)
  getHierarchy: () => req('/ontology/hierarchy'),

  getSuperclasses: (uri) =>
    req(`/ontology/superclasses?uri=${encodeURIComponent(uri)}`),

  getSubclasses: (uri) =>
    req(`/ontology/subclasses?uri=${encodeURIComponent(uri)}`),

  getNamespaces: () => req('/ontology/namespaces'),

  // ── RDF Pipeline (Table2RDF integration) ──────────────────────────────────

  runOntoRefine: (tsvContent, projectName, serverUrl, jarPath) =>
    req('/pipeline/ontorefine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tsv_content: tsvContent,
        project_name: projectName,
        server_url: serverUrl || 'http://localhost:7333',
        jar_path: jarPath || '',
      }),
    }),

  runOntoRefineLiterals: (tsvContent, projectName, serverUrl, jarPath) =>
    req('/pipeline/ontorefine-literals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tsv_content: tsvContent,
        project_name: projectName,
        server_url: serverUrl || 'http://localhost:7333',
        jar_path: jarPath || '',
      }),
    }),

  getGraphDBRepos: (serverUrl, username, password) =>
    req(`/pipeline/graphdb/repos?server_url=${encodeURIComponent(serverUrl || 'http://localhost:7200')}&username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`),

  createGraphDBRepo: (serverUrl, repoId, repoTitle, username, password) =>
    req('/pipeline/graphdb/create-repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_url: serverUrl, repo_id: repoId,
        repo_title: repoTitle || repoId,
        username: username || '', password: password || '',
      }),
    }),

  deleteGraphDBRepo: (serverUrl, repoId, username, password) =>
    req(`/pipeline/graphdb/repo/${encodeURIComponent(repoId)}?server_url=${encodeURIComponent(serverUrl)}&username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`,
      { method: 'DELETE' }),

  importToGraphDB: (projectId, serverUrl, repoId, repoTitle, username, password, isLiterals) =>
    req('/pipeline/graphdb/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        server_url: serverUrl, repo_id: repoId,
        repo_title: repoTitle || '',
        username: username || '', password: password || '',
        is_literals: isLiterals || false,
      }),
    }),

  exportRdf: (uriTsv, literalTsv, format) =>
    req('/pipeline/rdf-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uri_tsv: uriTsv,
        literal_tsv: literalTsv || '',
        format: format || 'xml',
      }),
    }),
}
