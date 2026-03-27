"""
Ontology Mapper Backend – FastAPI + rdflib
Includes full rdfs:subClassOf inference (transitive ancestor walk).

Run with: uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, Set, Tuple

try:
    from rdflib import Graph, URIRef, BNode
    from rdflib.namespace import RDF, RDFS, OWL
    RDFLIB_AVAILABLE = True
except ImportError:
    RDFLIB_AVAILABLE = False

app = FastAPI(title="Ontology Mapper API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store
ontology_store: Dict = {
    "graphs": {},   # filename -> rdflib.Graph
    "merged": None, # single merged graph
    # Inference cache – rebuilt whenever merged changes
    "_superclasses": {},   # uri -> set of all transitive superclass uris
    "_subclasses":   {},   # uri -> set of all transitive subclass uris
    "_prop_domains": {},   # property_uri -> set of direct domain uris
    "_prop_ranges":  {},   # property_uri -> set of direct range uris (incl. union expansion)
    "_all_props":    set(), # set of all property uris
}

# ─── URI / Label helpers ──────────────────────────────────────────────────────

def get_local_name(uri: str) -> str:
    if "#" in uri:
        return uri.split("#")[-1]
    return uri.split("/")[-1]


def get_namespaces() -> dict:
    if not ontology_store["merged"]:
        return {}
    return {prefix: str(ns) for prefix, ns in ontology_store["merged"].namespaces()}


def get_prefix_label(uri: str, namespaces: dict) -> str:
    # Sort by length descending so longer (more specific) prefixes match first
    for prefix, ns_uri in sorted(namespaces.items(), key=lambda x: -len(x[1])):
        if uri.startswith(ns_uri):
            local = uri[len(ns_uri):]
            if local and "/" not in local and "#" not in local:
                return f"{prefix}:{local}" if prefix else local
    return get_local_name(uri)


def _preferred_literal(graph: Graph, uri_ref, predicate, lang_prefs=("de", "en", "")):
    """Return the best literal for a predicate, preferring languages in order.
    lang_prefs=("de","en","") means: try German first, then English, then any."""
    candidates = list(graph.objects(uri_ref, predicate))
    if not candidates:
        return None
    for lang in lang_prefs:
        if lang == "":
            # Accept any remaining candidate (fallback)
            return candidates[0]
        for c in candidates:
            c_lang = getattr(c, 'language', None)
            if c_lang == lang:
                return c
    # Fallback: return first available
    return candidates[0] if candidates else None


def uri_to_dict(uri: str, graph: Graph, ns: dict) -> dict:
    label = get_prefix_label(uri, ns)
    uri_ref = URIRef(uri)
    rdfs_label = _preferred_literal(graph, uri_ref, RDFS.label)
    rdfs_comment = _preferred_literal(graph, uri_ref, RDFS.comment)
    return {
        "uri": uri,
        "label": label,
        "rdfs_label": str(rdfs_label) if rdfs_label else None,
        "rdfs_comment": str(rdfs_comment) if rdfs_comment else None,
    }

# ─── Inference Engine ─────────────────────────────────────────────────────────

# OWL / RDFS meta-classes we never want as user-facing classes
_META_URIS = {
    str(OWL.Class), str(RDFS.Class),
    str(OWL.ObjectProperty), str(OWL.DatatypeProperty),
    str(OWL.AnnotationProperty), str(OWL.TransitiveProperty),
    str(OWL.SymmetricProperty), str(OWL.FunctionalProperty),
    str(OWL.InverseFunctionalProperty), str(OWL.Restriction),
    str(RDF.Property), str(OWL.Ontology),
    str(RDFS.Resource), str(RDFS.Literal),
    str(OWL.Thing), str(OWL.Nothing),
}


def _collect_all_classes(graph: Graph) -> Set[str]:
    """Collect every URI that is used as a class."""
    classes: Set[str] = set()

    for s in graph.subjects(RDF.type, OWL.Class):
        if isinstance(s, URIRef):
            classes.add(str(s))
    for s in graph.subjects(RDF.type, RDFS.Class):
        if isinstance(s, URIRef):
            classes.add(str(s))
    # Anything declared as a subClassOf something
    for s in graph.subjects(RDFS.subClassOf, None):
        if isinstance(s, URIRef):
            classes.add(str(s))
    for o in graph.objects(None, RDFS.subClassOf):
        if isinstance(o, URIRef):
            classes.add(str(o))
    # Anything used as domain or range
    for o in graph.objects(None, RDFS.domain):
        if isinstance(o, URIRef):
            classes.add(str(o))
    for o in graph.objects(None, RDFS.range):
        if isinstance(o, URIRef):
            classes.add(str(o))

    return classes - _META_URIS


def _build_subclass_index(graph: Graph, all_classes: Set[str]) -> tuple[dict, dict]:
    """
    Build two indexes:
      direct_super[C] = set of direct superclasses of C
      direct_sub[C]   = set of direct subclasses of C
    from rdfs:subClassOf triples only (BNode restrictions are skipped).
    """
    direct_super: Dict[str, Set[str]] = {c: set() for c in all_classes}
    direct_sub:   Dict[str, Set[str]] = {c: set() for c in all_classes}

    for s, _, o in graph.triples((None, RDFS.subClassOf, None)):
        if isinstance(s, URIRef) and isinstance(o, URIRef):
            cs, co = str(s), str(o)
            if cs in _META_URIS or co in _META_URIS:
                continue
            # Ensure keys exist even if class wasn't in initial set
            direct_super.setdefault(cs, set()).add(co)
            direct_sub.setdefault(co, set()).add(cs)
            direct_super.setdefault(co, set())
            direct_sub.setdefault(cs, set())

    return direct_super, direct_sub


def _transitive_closure(start: str, adjacency: Dict[str, Set[str]]) -> Set[str]:
    """
    BFS / iterative DFS over adjacency to collect all reachable nodes
    (excluding start itself).  Handles cycles safely.
    """
    visited: Set[str] = set()
    stack = list(adjacency.get(start, set()))
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        stack.extend(adjacency.get(node, set()) - visited)
    return visited


def _expand_union(node, graph: Graph) -> Set[str]:
    """Expand owl:unionOf BNode into its member URIs."""
    members: Set[str] = set()
    union = graph.value(node, OWL.unionOf)
    if union:
        for item in graph.items(union):
            if isinstance(item, URIRef):
                members.add(str(item))
    return members


def _build_property_indexes(graph: Graph) -> tuple[dict, dict, set]:
    """
    Build:
      prop_domains[p] = set of direct domain URIs (union-expanded, inverse-inferred)
      prop_ranges[p]  = set of direct range  URIs (union-expanded, inverse-inferred)
      all_props       = set of all property URIs

    owl:inverseOf inference
    ────────────────────────
    CRM extension ontologies (CRMarchaeo, CRMsci, …) often declare inverse
    properties without repeating domain/range – they rely on the rule:

        P owl:inverseOf Q  →  domain(P) = range(Q),  range(P) = domain(Q)

    We resolve this in two passes so that chains like
        AP3i owl:inverseOf AP3 ;  AP3 rdfs:domain A9 ; rdfs:range E27
    are fully expanded even when AP3i has no explicit domain/range triples.

    We also handle the symmetric direction: if Q owl:inverseOf P is stated
    on the forward property instead of the inverse.
    """
    prop_domains: Dict[str, Set[str]] = {}
    prop_ranges:  Dict[str, Set[str]] = {}
    all_props:    Set[str] = set()

    property_types = [
        OWL.ObjectProperty, OWL.DatatypeProperty,
        OWL.AnnotationProperty, RDF.Property,
    ]

    # ── Pass 1: collect all known properties ─────────────────────────────────
    for ptype in property_types:
        for p in graph.subjects(RDF.type, ptype):
            if not isinstance(p, URIRef):
                continue
            ps = str(p)
            all_props.add(ps)
            prop_domains.setdefault(ps, set())
            prop_ranges.setdefault(ps, set())

    # Also pick up properties that only appear in domain/range triples
    for p in graph.subjects(RDFS.domain, None):
        if isinstance(p, URIRef):
            all_props.add(str(p))
            prop_domains.setdefault(str(p), set())
            prop_ranges.setdefault(str(p), set())
    for p in graph.subjects(RDFS.range, None):
        if isinstance(p, URIRef):
            all_props.add(str(p))
            prop_domains.setdefault(str(p), set())
            prop_ranges.setdefault(str(p), set())

    # Also register any property mentioned in owl:inverseOf triples
    for s, _, o in graph.triples((None, OWL.inverseOf, None)):
        for node in (s, o):
            if isinstance(node, URIRef):
                ns = str(node)
                all_props.add(ns)
                prop_domains.setdefault(ns, set())
                prop_ranges.setdefault(ns, set())

    # ── Pass 2: fill direct domain / range from explicit triples ─────────────
    for p in list(all_props):
        for domain_node in graph.objects(URIRef(p), RDFS.domain):
            if isinstance(domain_node, URIRef):
                prop_domains[p].add(str(domain_node))
            elif isinstance(domain_node, BNode):
                prop_domains[p].update(_expand_union(domain_node, graph))

    for p in list(all_props):
        for range_node in graph.objects(URIRef(p), RDFS.range):
            if isinstance(range_node, URIRef):
                prop_ranges[p].add(str(range_node))
            elif isinstance(range_node, BNode):
                prop_ranges[p].update(_expand_union(range_node, graph))

    # ── Pass 3: owl:inverseOf inference (iterate to fixpoint) ────────────────
    # Collect all inverseOf pairs (both directions: P inv Q and Q inv P)
    inverse_pairs: List[Tuple[str, str]] = []
    for s, _, o in graph.triples((None, OWL.inverseOf, None)):
        if isinstance(s, URIRef) and isinstance(o, URIRef):
            ps, po = str(s), str(o)
            inverse_pairs.append((ps, po))   # P inverseOf Q
            inverse_pairs.append((po, ps))   # symmetric: Q inverseOf P

    # Iterate until no new information is added (handles chains)
    changed = True
    while changed:
        changed = False
        for p_inv, p_fwd in inverse_pairs:
            # domain(p_inv) ← range(p_fwd)
            new_domains = prop_ranges.get(p_fwd, set()) - prop_domains.get(p_inv, set())
            if new_domains:
                prop_domains.setdefault(p_inv, set()).update(new_domains)
                all_props.add(p_inv)
                changed = True

            # range(p_inv) ← domain(p_fwd)
            new_ranges = prop_domains.get(p_fwd, set()) - prop_ranges.get(p_inv, set())
            if new_ranges:
                prop_ranges.setdefault(p_inv, set()).update(new_ranges)
                all_props.add(p_inv)
                changed = True

    return prop_domains, prop_ranges, all_props


def rebuild_merged():
    """
    Rebuild the merged graph and all inference caches.
    Called after every upload or delete.
    """
    merged = Graph()
    for g in ontology_store["graphs"].values():
        for triple in g:
            merged.add(triple)
    ontology_store["merged"] = merged

    if not merged:
        ontology_store["_superclasses"] = {}
        ontology_store["_subclasses"]   = {}
        ontology_store["_prop_domains"] = {}
        ontology_store["_prop_ranges"]  = {}
        ontology_store["_all_props"]    = set()
        return

    # --- Class hierarchy ---
    all_classes = _collect_all_classes(merged)
    direct_super, direct_sub = _build_subclass_index(merged, all_classes)

    # Transitive closures
    superclasses: Dict[str, Set[str]] = {}
    subclasses:   Dict[str, Set[str]] = {}
    for c in all_classes:
        superclasses[c] = _transitive_closure(c, direct_super)
        subclasses[c]   = _transitive_closure(c, direct_sub)

    ontology_store["_superclasses"] = superclasses
    ontology_store["_subclasses"]   = subclasses

    # --- Property indexes ---
    pd, pr, ap = _build_property_indexes(merged)
    ontology_store["_prop_domains"] = pd
    ontology_store["_prop_ranges"]  = pr
    ontology_store["_all_props"]    = ap

# ─── Query functions (use inference caches) ───────────────────────────────────

def get_all_classes_dicts() -> List[dict]:
    g  = ontology_store["merged"]
    ns = get_namespaces()
    all_classes = set(ontology_store["_superclasses"].keys()) | set(ontology_store["_subclasses"].keys())
    result = []
    for uri in sorted(all_classes):
        if uri in _META_URIS:
            continue
        d = uri_to_dict(uri, g, ns)
        # Attach direct parents so frontend can show hierarchy hints
        direct_parents = [
            p for p in ontology_store["_superclasses"].get(uri, set())
            if p not in _META_URIS
        ]
        d["parents"] = sorted(direct_parents)
        result.append(d)
    return result


def get_ancestor_uris(uri: str) -> Set[str]:
    """Return uri itself plus all transitive superclasses."""
    return {uri} | ontology_store["_superclasses"].get(uri, set())


def get_descendant_uris(uri: str) -> Set[str]:
    """Return uri itself plus all transitive subclasses."""
    return {uri} | ontology_store["_subclasses"].get(uri, set())


def get_properties_for_subject(subject_uri: str, widening: bool = False) -> List[dict]:
    """
    Return all properties whose domain is compatible with subject_uri.

    A property P is compatible if ANY of the following is true:
      1. subject_uri is directly in domain(P)
      2. An ancestor of subject_uri is in domain(P)   ← inheritance
      3. A descendant of subject_uri is in domain(P)  ← widening (only if widening=True)
      4. P has no domain restriction at all            ← applies to everything

    Standard RDFS semantics = 1 + 2 + 4.
    Widening adds 3: properties defined on subclasses are also offered
    for the superclass, marked with "widened_from".
    """
    g   = ontology_store["merged"]
    ns  = get_namespaces()
    pd  = ontology_store["_prop_domains"]
    ap  = ontology_store["_all_props"]

    # All URIs that "are or represent" the subject in the hierarchy
    subject_ancestors = get_ancestor_uris(subject_uri)
    subject_descendants = get_descendant_uris(subject_uri) - {subject_uri} if widening else set()

    props: Set[str] = set()
    widened_props: Set[str] = set()   # track which ones came via widening

    for p_uri in ap:
        domains = pd.get(p_uri, set())
        if not domains:
            # No domain restriction → property applies to everything
            props.add(p_uri)
        elif domains & subject_ancestors:
            # Intersection: subject or one of its superclasses is in the domain
            props.add(p_uri)
        elif widening and (domains & subject_descendants):
            # Widening: a descendant of subject is in the domain
            props.add(p_uri)
            widened_props.add(p_uri)

    result = []
    for uri in sorted(props):
        d = uri_to_dict(uri, g, ns)
        direct_domains = pd.get(uri, set())

        # Annotate which ancestor(s) provided the property (for UI tooltip)
        inherited_from = []
        if subject_uri not in direct_domains and uri not in widened_props:
            inherited_from = sorted(direct_domains & subject_ancestors - {subject_uri})
        d["inherited_from"] = inherited_from

        # Annotate widening source
        widened_from = []
        if uri in widened_props:
            widened_from = sorted(direct_domains & subject_descendants)
        d["widened_from"] = widened_from

        result.append(d)
    return result


def get_range_for_property(subject_uri: str, property_uri: str) -> List[dict]:
    """
    Return valid range classes for property_uri when used with subject_uri.

    Range inference:
      - Return the direct rdfs:range class(es) of the property
      - PLUS all subclasses of each range class (a subclass is also a valid range)
      - If no range is declared, return nothing (don't guess)
    """
    g   = ontology_store["merged"]
    ns  = get_namespaces()
    pr  = ontology_store["_prop_ranges"]

    direct_ranges = pr.get(property_uri, set())
    if not direct_ranges:
        return []

    # Expand to include all subclasses of each declared range
    expanded: Set[str] = set()
    for r_uri in direct_ranges:
        expanded.add(r_uri)
        expanded |= get_descendant_uris(r_uri)

    # Filter out meta-classes
    expanded -= _META_URIS

    result = []
    for uri in sorted(expanded):
        d = uri_to_dict(uri, g, ns)
        d["is_direct_range"] = uri in direct_ranges
        result.append(d)

    # Sort: direct ranges first, then subclasses alphabetically
    result.sort(key=lambda x: (not x["is_direct_range"], x["label"]))
    return result


def get_class_hierarchy() -> dict:
    """
    Build a tree-like structure for the frontend hierarchy view.
    Returns a dict: uri -> { label, uri, parents: [uri,...], children: [uri,...] }
    """
    g  = ontology_store["merged"]
    ns = get_namespaces()
    sc = ontology_store["_superclasses"]
    sb = ontology_store["_subclasses"]

    result = {}
    all_uris = set(sc.keys()) | set(sb.keys())
    for uri in all_uris:
        if uri in _META_URIS:
            continue
        d = uri_to_dict(uri, g, ns)
        # Only direct parents/children (not transitive)
        direct_parents = []
        for p in sc.get(uri, set()):
            if p not in _META_URIS:
                # Check it's a *direct* parent: no shorter path
                # Approximation: direct = in superclasses but not reachable via another superclass
                other_ancestors = set()
                for q in sc.get(uri, set()):
                    if q != p:
                        other_ancestors |= sc.get(q, set())
                if p not in other_ancestors:
                    direct_parents.append(p)
        direct_children = []
        for c in sb.get(uri, set()):
            if c not in _META_URIS:
                other_descendants = set()
                for q in sb.get(uri, set()):
                    if q != c:
                        other_descendants |= sb.get(q, set())
                if c not in other_descendants:
                    direct_children.append(c)
        d["parents"]  = sorted(direct_parents)
        d["children"] = sorted(direct_children)
        result[uri] = d

    return result


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    sc_count = len(ontology_store["_superclasses"])
    prop_count = len(ontology_store["_all_props"])
    return {
        "status": "ok",
        "rdflib": RDFLIB_AVAILABLE,
        "classes_indexed": sc_count,
        "properties_indexed": prop_count,
    }


@app.post("/ontology/upload")
async def upload_ontology(files: List[UploadFile] = File(...)):
    if not RDFLIB_AVAILABLE:
        raise HTTPException(500, "rdflib not installed. Run: pip install rdflib")

    loaded, errors = [], []
    FORMAT_CANDIDATES = ["turtle", "xml", "n3", "nt", "json-ld"]

    for file in files:
        content = await file.read()
        fn = file.filename or "unknown"
        # Guess primary format from extension
        ext = fn.rsplit(".", 1)[-1].lower()
        fmt_order = {
            "ttl": ["turtle", "n3", "xml"],
            "rdf": ["xml", "turtle"],
            "owl": ["xml", "turtle"],
            "xml": ["xml", "turtle"],
            "nt":  ["nt", "turtle"],
            "n3":  ["n3", "turtle"],
        }.get(ext, FORMAT_CANDIDATES)

        parsed = False
        for fmt in fmt_order:
            try:
                g = Graph()
                g.parse(data=content.decode("utf-8", errors="replace"), format=fmt)
                ontology_store["graphs"][fn] = g
                loaded.append(fn)
                parsed = True
                break
            except Exception:
                continue
        if not parsed:
            errors.append({"file": fn, "error": "Could not parse with any known format"})

    rebuild_merged()

    return {
        "loaded": loaded,
        "errors": errors,
        "total_triples": len(ontology_store["merged"]) if ontology_store["merged"] else 0,
        "ontologies": list(ontology_store["graphs"].keys()),
        "classes_indexed": len(ontology_store["_superclasses"]),
        "properties_indexed": len(ontology_store["_all_props"]),
    }


@app.get("/ontology/list")
def list_ontologies():
    return {
        "ontologies": list(ontology_store["graphs"].keys()),
        "total_triples": len(ontology_store["merged"]) if ontology_store["merged"] else 0,
    }


@app.delete("/ontology/{filename}")
def delete_ontology(filename: str):
    if filename in ontology_store["graphs"]:
        del ontology_store["graphs"][filename]
        rebuild_merged()
        return {"deleted": filename}
    raise HTTPException(404, f"Ontology '{filename}' not found")


@app.get("/ontology/classes")
def get_classes(search: Optional[str] = None):
    if not ontology_store["merged"]:
        return {"classes": []}
    classes = get_all_classes_dicts()
    if search:
        sl = search.lower()
        classes = [
            c for c in classes
            if sl in c["label"].lower()
            or (c["rdfs_label"] and sl in c["rdfs_label"].lower())
        ]
    return {"classes": classes}


@app.get("/ontology/properties")
def get_properties(subject_uri: str, search: Optional[str] = None, widening: bool = False):
    if not ontology_store["merged"]:
        return {"properties": []}
    props = get_properties_for_subject(subject_uri, widening=widening)
    if search:
        sl = search.lower()
        props = [
            p for p in props
            if sl in p["label"].lower()
            or (p["rdfs_label"] and sl in p["rdfs_label"].lower())
        ]
    return {"properties": props}


@app.get("/ontology/range")
def get_range(subject_uri: str, property_uri: str):
    if not ontology_store["merged"]:
        return {"ranges": []}
    ranges = get_range_for_property(subject_uri, property_uri)
    return {"ranges": ranges}


@app.get("/ontology/hierarchy")
def get_hierarchy():
    """
    Full class hierarchy as a flat dict for the frontend tree view.
    Each entry has: uri, label, rdfs_label, parents[], children[]
    """
    if not ontology_store["merged"]:
        return {"hierarchy": {}}
    return {"hierarchy": get_class_hierarchy()}


@app.get("/ontology/superclasses")
def get_superclasses(uri: str):
    """All transitive superclasses of a given URI."""
    ancestors = sorted(get_ancestor_uris(uri) - {uri} - _META_URIS)
    ns  = get_namespaces()
    g   = ontology_store["merged"]
    return {"superclasses": [uri_to_dict(u, g, ns) for u in ancestors]}


@app.get("/ontology/subclasses")
def get_subclasses(uri: str):
    """All transitive subclasses of a given URI."""
    descendants = sorted(get_descendant_uris(uri) - {uri} - _META_URIS)
    ns = get_namespaces()
    g  = ontology_store["merged"]
    return {"subclasses": [uri_to_dict(u, g, ns) for u in descendants]}


@app.get("/ontology/namespaces")
def list_namespaces():
    return {"namespaces": get_namespaces()}


# ─── RDF Pipeline Endpoints (Table2RDF integration) ──────────────────────────

import subprocess, tempfile, json as json_mod, re as re_mod, time as time_mod
from pathlib import Path

try:
    import requests as http_requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

from pydantic import BaseModel
from typing import Optional as Opt


class OntoRefineRequest(BaseModel):
    tsv_content: str
    project_name: str = "OntologyMapper_Export"
    mapping_json: str = ""  # if empty, use built-in default
    server_url: str = "http://localhost:7333"
    jar_path: str = ""  # path to ontorefine-cli JAR; empty = auto-detect


class GraphDBRequest(BaseModel):
    project_id: str
    server_url: str = "http://localhost:7200"
    repo_id: str = ""
    repo_title: str = ""
    username: str = ""
    password: str = ""
    is_literals: bool = False


class GraphDBRepoRequest(BaseModel):
    server_url: str = "http://localhost:7200"
    repo_id: str
    repo_title: str = ""
    ruleset: str = "rdfsplus-optimized"
    username: str = ""
    password: str = ""


# ── Built-in Ontotext Refine mapping templates (from Table2RDF) ──────────────

DEFAULT_MAPPING = {
    "baseIRI": "http://example.com/base/",
    "namespaces": {
        "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
        "crm": "http://www.cidoc-crm.org/cidoc-crm/"
    },
    "subjectMappings": [
        {
            "propertyMappings": [
                {
                    "property": {
                        "transformation": {"expression": "rdfs", "language": "prefix"},
                        "valueSource": {"source": "constant", "constant": "label"}
                    },
                    "values": [{
                        "valueSource": {"columnName": "domain_label", "source": "column"},
                        "valueType": {"type": "language_literal", "language": {"valueSource": {"source": "constant", "constant": "en"}}}
                    }]
                },
                {
                    "property": {
                        "transformation": {"expression": "crm", "language": "prefix"},
                        "valueSource": {"source": "constant", "constant": "P3_has_note"}
                    },
                    "values": [{
                        "valueSource": {"columnName": "p3_has_note", "source": "column"},
                        "valueType": {"type": "literal"}
                    }]
                }
            ],
            "subject": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "id_of_domain_uri", "source": "column"}},
            "typeMappings": [{"transformation": {"language": "raw"}, "valueSource": {"columnName": "class_of_domain_uri", "source": "column"}}]
        },
        {
            "propertyMappings": [
                {
                    "property": {
                        "transformation": {"expression": "rdfs", "language": "prefix"},
                        "valueSource": {"source": "constant", "constant": "label"}
                    },
                    "values": [{
                        "valueSource": {"columnName": "range_label", "source": "column"},
                        "valueType": {"type": "language_literal", "language": {"valueSource": {"source": "constant", "constant": "en"}}}
                    }]
                }
            ],
            "subject": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "id_of_the_range_uri", "source": "column"}},
            "typeMappings": [{"transformation": {"language": "raw"}, "valueSource": {"columnName": "class_of_the_range_uri", "source": "column"}}]
        },
        {
            "propertyMappings": [{
                "property": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "property_uri", "source": "column"}},
                "values": [{
                    "transformation": {"language": "raw"},
                    "valueSource": {"columnName": "id_of_the_range_uri", "source": "column"},
                    "valueType": {"propertyMappings": [], "type": "iri", "typeMappings": []}
                }]
            }],
            "subject": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "id_of_domain_uri", "source": "column"}},
            "typeMappings": []
        },
        {
            "propertyMappings": [{
                "property": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "dot_one_uri", "source": "column"}},
                "values": [{
                    "transformation": {"language": "raw"},
                    "valueSource": {"columnName": "dot_one_target_uri", "source": "column"},
                    "valueType": {"propertyMappings": [], "type": "iri", "typeMappings": []}
                }]
            }],
            "subject": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "i4_uri", "source": "column"}},
            "typeMappings": []
        }
    ]
}

DEFAULT_LITERAL_MAPPING = {
    "baseIRI": "http://example.com/base/",
    "namespaces": {
        "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
        "crm": "http://www.cidoc-crm.org/cidoc-crm/"
    },
    "subjectMappings": [
        {
            "propertyMappings": [
                {
                    "property": {
                        "transformation": {"expression": "rdfs", "language": "prefix"},
                        "valueSource": {"source": "constant", "constant": "label"}
                    },
                    "values": [{
                        "valueSource": {"columnName": "domain_label", "source": "column"},
                        "valueType": {"type": "language_literal", "language": {"valueSource": {"source": "constant", "constant": "en"}}}
                    }]
                },
                {
                    "property": {
                        "transformation": {"expression": "crm", "language": "prefix"},
                        "valueSource": {"source": "constant", "constant": "P3_has_note"}
                    },
                    "values": [{
                        "valueSource": {"columnName": "p3_has_note", "source": "column"},
                        "valueType": {"type": "literal"}
                    }]
                }
            ],
            "subject": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "id_of_domain_uri", "source": "column"}},
            "typeMappings": [{"transformation": {"language": "raw"}, "valueSource": {"columnName": "class_of_domain_uri", "source": "column"}}]
        },
        {
            "propertyMappings": [{
                "property": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "property_uri", "source": "column"}},
                "values": [{
                    "transformation": {"language": "raw"},
                    "valueSource": {"columnName": "id_of_the_range_uri", "source": "column"},
                    "valueType": {
                        "type": "datatype_literal",
                        "datatype": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "class_of_the_range_uri", "source": "column"}}
                    }
                }]
            }],
            "subject": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "id_of_domain_uri", "source": "column"}},
            "typeMappings": []
        },
        {
            "propertyMappings": [{
                "property": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "dot_one_uri", "source": "column"}},
                "values": [{
                    "transformation": {"language": "raw"},
                    "valueSource": {"columnName": "dot_one_target_uri", "source": "column"},
                    "valueType": {"propertyMappings": [], "type": "iri", "typeMappings": []}
                }]
            }],
            "subject": {"transformation": {"language": "raw"}, "valueSource": {"columnName": "i4_uri", "source": "column"}},
            "typeMappings": []
        }
    ]
}


# ── SPARQL templates (from Table2RDF) ────────────────────────────────────────

SPARQL_TRIPLES = r'''
#SPARQL for triples
BASE <http://example.com/base/>
PREFIX mapper: <http://www.ontotext.com/mapper/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX crm: <http://www.cidoc-crm.org/cidoc-crm/>
INSERT { GRAPH ?s4  {
?s1 a ?t_s1 ;
    rdfs:label ?o_label ;
    crm:P3\_has\_note ?o_P3_has_note .
?s2 a ?t_s2 ;
    rdfs:label ?o_label_2 .
?s3 ?p_property_uri ?o_property_uri .
<<?s3 ?p_property_uri ?o_property_uri>> ?p_dot_one_uri ?o_dot_one_uri .
    }} WHERE {
SERVICE <http://localhost:7333/repositories/ontorefine:{PROJECT_ID}>  {
    BIND(IRI(?c_id_of_domain_uri) as ?s1)
    BIND(IRI(?c_class_of_domain_uri) as ?t_s1)
    BIND(STRLANG(?c_domain_label, "en") as ?o_label)
    BIND(STR(?c_p3_has_note) as ?o_P3_has_note)
    BIND(IRI(?c_id_of_the_range_uri) as ?s2)
    BIND(IRI(?c_class_of_the_range_uri) as ?t_s2)
    BIND(STRLANG(?c_range_label, "en") as ?o_label_2)
    BIND(IRI(?c_id_of_domain_uri) as ?s3)
    BIND(IRI(?c_property_uri) as ?p_property_uri)
    BIND(IRI(?c_id_of_the_range_uri) as ?o_property_uri)
    BIND(IRI(?c_i4_uri) as ?s4)
    BIND(IRI(?c_dot_one_uri) as ?p_dot_one_uri)
    BIND(IRI(?c_dot_one_target_uri) as ?o_dot_one_uri)
}
}
'''

SPARQL_TRIPLES_LITERALS = r'''
#SPARQL for triples with literals
BASE <http://example.com/base/>
PREFIX mapper: <http://www.ontotext.com/mapper/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX crm: <http://www.cidoc-crm.org/cidoc-crm/>
INSERT { GRAPH ?s3  {
?s1 a ?t_s1 ;
    rdfs:label ?o_label ;
    crm:P3\_has\_note ?o_P3_has_note .
?s2 ?p_property_uri ?o_property_uri .
    }} WHERE {
SERVICE <http://localhost:7333/repositories/ontorefine:{PROJECT_ID}>  {
    BIND(IRI(?c_id_of_domain_uri) as ?s1)
    BIND(IRI(?c_class_of_domain_uri) as ?t_s1)
    BIND(STRLANG(?c_domain_label, "en") as ?o_label)
    BIND(STR(?c_p3_has_note) as ?o_P3_has_note)
    BIND(IRI(?c_id_of_domain_uri) as ?s2)
    BIND(IRI(?c_property_uri) as ?p_property_uri)
    BIND(STRDT(?c_id_of_the_range_uri, IRI(?c_class_of_the_range_uri)) as ?o_property_uri)
    BIND(IRI(?c_i4_uri) as ?s3)
    BIND(IRI(?c_dot_one_uri) as ?p_dot_one_uri)
    BIND(IRI(?c_dot_one_target_uri) as ?o_dot_one_uri)
}
}
'''


def _find_jar(custom_path: str = "") -> str:
    """Locate ontorefine-cli JAR: custom path > same dir > common locations."""
    if custom_path and Path(custom_path).is_file():
        return custom_path
    jar_name = "ontorefine-cli-1.2.1-jar-with-dependencies.jar"
    # Check same directory as this script
    local = Path(__file__).parent / jar_name
    if local.is_file():
        return str(local)
    # Check common locations
    for d in [Path.cwd(), Path.home(), Path("C:/CRM"), Path("/opt/ontorefine")]:
        p = d / jar_name
        if p.is_file():
            return str(p)
    return ""


@app.post("/pipeline/ontorefine")
def run_ontorefine(req: OntoRefineRequest):
    """
    Create an Ontotext Refine project from TSV content and apply a mapping.
    Steps: write TSV to temp file → java -jar create → java -jar apply mapping
    Returns the Ontotext Refine project ID.
    """
    jar = _find_jar(req.jar_path)
    if not jar:
        raise HTTPException(400, "ontorefine-cli JAR nicht gefunden. Bitte Pfad angeben oder JAR neben backend/main.py ablegen.")

    # Write TSV content to temp file
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".tsv", mode="w", encoding="utf-8")
    tmp.write(req.tsv_content)
    tmp.close()

    try:
        # 1. Create project
        cmd_create = [
            "java", "-jar", jar, "create",
            "--url", req.server_url,
            "--name", req.project_name,
            tmp.name
        ]
        result = subprocess.run(cmd_create, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise HTTPException(500, f"Ontotext Refine Projekt konnte nicht erstellt werden:\n{result.stderr}")

        match = re_mod.search(r"Successfully created project with identifier: (\d+)", result.stdout)
        if not match:
            raise HTTPException(500, f"Projekt erstellt, aber ID nicht gefunden. Output:\n{result.stdout}")
        project_id = match.group(1)

        # 2. Apply mapping
        mapping_data = req.mapping_json if req.mapping_json else json_mod.dumps(DEFAULT_MAPPING)
        tmp_map = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8")
        tmp_map.write(mapping_data)
        tmp_map.close()

        cmd_apply = [
            "java", "-jar", jar, "apply",
            "--url", req.server_url,
            mapping_data if Path(mapping_data).is_file() else tmp_map.name,
            project_id
        ]
        # Fix: always use the temp file path
        cmd_apply = [
            "java", "-jar", jar, "apply",
            "--url", req.server_url,
            tmp_map.name,
            project_id
        ]
        result2 = subprocess.run(cmd_apply, capture_output=True, text=True, timeout=60)

        return {
            "project_id": project_id,
            "project_name": req.project_name,
            "create_output": result.stdout,
            "apply_output": result2.stdout,
            "apply_error": result2.stderr if result2.returncode != 0 else "",
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Ontotext Refine Timeout – läuft der Service?")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        Path(tmp.name).unlink(missing_ok=True)


@app.post("/pipeline/ontorefine-literals")
def run_ontorefine_literals(req: OntoRefineRequest):
    """Same as /pipeline/ontorefine but uses the LITERAL mapping template."""
    jar = _find_jar(req.jar_path)
    if not jar:
        raise HTTPException(400, "ontorefine-cli JAR nicht gefunden.")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".tsv", mode="w", encoding="utf-8")
    tmp.write(req.tsv_content)
    tmp.close()

    try:
        cmd_create = [
            "java", "-jar", jar, "create",
            "--url", req.server_url,
            "--name", req.project_name + "_literals",
            tmp.name
        ]
        result = subprocess.run(cmd_create, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise HTTPException(500, f"Ontotext Refine (literals) fehlgeschlagen:\n{result.stderr}")

        match = re_mod.search(r"Successfully created project with identifier: (\d+)", result.stdout)
        if not match:
            raise HTTPException(500, f"Projekt erstellt, aber ID nicht gefunden. Output:\n{result.stdout}")
        project_id = match.group(1)

        mapping_data = req.mapping_json if req.mapping_json else json_mod.dumps(DEFAULT_LITERAL_MAPPING)
        tmp_map = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8")
        tmp_map.write(mapping_data)
        tmp_map.close()

        cmd_apply = [
            "java", "-jar", jar, "apply",
            "--url", req.server_url,
            tmp_map.name,
            project_id
        ]
        result2 = subprocess.run(cmd_apply, capture_output=True, text=True, timeout=60)

        return {
            "project_id": project_id,
            "project_name": req.project_name + "_literals",
            "create_output": result.stdout,
            "apply_output": result2.stdout,
            "apply_error": result2.stderr if result2.returncode != 0 else "",
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Ontotext Refine Timeout")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        Path(tmp.name).unlink(missing_ok=True)


@app.get("/pipeline/graphdb/repos")
def list_graphdb_repos(server_url: str = "http://localhost:7200", username: str = "", password: str = ""):
    """List all GraphDB repositories."""
    if not REQUESTS_AVAILABLE:
        raise HTTPException(500, "Python 'requests' Paket nicht installiert")
    auth = (username, password) if username or password else None
    try:
        r = http_requests.get(
            f"{server_url.rstrip('/')}/repositories",
            headers={"Accept": "application/sparql-results+json"},
            auth=auth, timeout=20
        )
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"GraphDB Fehler: {r.text[:500]}")
        data = r.json()
        bindings = data.get("results", {}).get("bindings", [])
        repos = []
        for b in bindings:
            rid = (b.get("id", {}) or b.get("ID", {})).get("value", "")
            if rid:
                repos.append(rid)
        return {"repos": sorted(repos)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"GraphDB nicht erreichbar: {e}")


@app.post("/pipeline/graphdb/create-repo")
def create_graphdb_repo(req: GraphDBRepoRequest):
    """Create a new GraphDB repository."""
    if not REQUESTS_AVAILABLE:
        raise HTTPException(500, "Python 'requests' Paket nicht installiert")

    ttl = f"""@prefix rep:   <http://www.openrdf.org/config/repository#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sr:    <http://www.openrdf.org/config/repository/sail#> .
@prefix sail:  <http://www.openrdf.org/config/sail#> .
@prefix graphdb: <http://www.ontotext.com/config/graphdb#> .
@prefix owlim: <http://www.ontotext.com/trree/owlim#> .

[] a rep:Repository ;
rep:repositoryID "{req.repo_id}" ;
rdfs:label "{(req.repo_title or req.repo_id).replace('"', '\\\\"')}" ;
rep:repositoryImpl [
    rep:repositoryType "graphdb:SailRepository" ;
    sr:sailImpl [
        sail:sailType "owlim:Sail" ;
        owlim:ruleset "{req.ruleset}" ;
        owlim:base-URL "http://example.org/" ;
        owlim:disable-sameAs "true" ;
        owlim:enable-context-index "true" ;
        owlim:storage-folder ""
    ]
] .
"""
    auth = (req.username, req.password) if req.username or req.password else None
    url = f"{req.server_url.rstrip('/')}/rest/repositories"
    try:
        r = http_requests.post(
            url,
            files={"config": ("config.ttl", ttl.encode("utf-8"), "text/turtle")},
            headers={"X-Requested-With": "XMLHttpRequest"},
            auth=auth, timeout=30
        )
        if r.status_code in (201, 204):
            return {"success": True, "repo_id": req.repo_id}
        raise HTTPException(r.status_code, f"Repository anlegen fehlgeschlagen: {r.text[:500]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/pipeline/graphdb/repo/{repo_id}")
def delete_graphdb_repo(repo_id: str, server_url: str = "http://localhost:7200", username: str = "", password: str = ""):
    """Delete a GraphDB repository."""
    if not REQUESTS_AVAILABLE:
        raise HTTPException(500, "Python 'requests' Paket nicht installiert")
    from urllib.parse import quote
    auth = (username, password) if username or password else None
    url = f"{server_url.rstrip('/')}/rest/repositories/{quote(repo_id, safe='')}"
    try:
        r = http_requests.delete(url, headers={"X-Requested-With": "XMLHttpRequest"}, auth=auth, timeout=30)
        if r.status_code in (200, 204):
            return {"success": True}
        raise HTTPException(r.status_code, f"Löschen fehlgeschlagen: {r.text[:500]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/pipeline/graphdb/import")
def import_to_graphdb(req: GraphDBRequest):
    """Execute SPARQL INSERT to load triples from Ontotext Refine into GraphDB."""
    if not REQUESTS_AVAILABLE:
        raise HTTPException(500, "Python 'requests' Paket nicht installiert")

    auth = (req.username, req.password) if req.username or req.password else None
    server = req.server_url.rstrip('/')

    # Ensure repo exists, create if needed
    try:
        repos_r = http_requests.get(
            f"{server}/repositories",
            headers={"Accept": "application/sparql-results+json"},
            auth=auth, timeout=20
        )
        existing = set()
        if repos_r.status_code == 200:
            for b in repos_r.json().get("results", {}).get("bindings", []):
                rid = (b.get("id", {}) or b.get("ID", {})).get("value", "")
                if rid: existing.add(rid)

        repo_id = req.repo_id
        if not repo_id:
            repo_id = re_mod.sub(r"[^A-Za-z0-9_\-]", "_", req.repo_title or f"KG_{req.project_id}")

        if repo_id not in existing:
            create_req = GraphDBRepoRequest(
                server_url=req.server_url, repo_id=repo_id,
                repo_title=req.repo_title or repo_id,
                username=req.username, password=req.password,
            )
            create_graphdb_repo(create_req)
            time_mod.sleep(0.6)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Repository-Check fehlgeschlagen: {e}")

    # Build SPARQL update
    template = SPARQL_TRIPLES_LITERALS if req.is_literals else SPARQL_TRIPLES
    sparql = template.replace("{PROJECT_ID}", req.project_id)

    endpoint = f"{server}/repositories/{repo_id}/statements"
    headers = {
        "Content-Type": "application/sparql-update; charset=UTF-8",
        "Accept": "application/sparql-results+json"
    }
    try:
        resp = http_requests.post(
            endpoint, data=sparql.encode("utf-8"),
            headers=headers, auth=auth, timeout=90
        )
        if resp.status_code in (200, 204):
            return {"success": True, "repo_id": repo_id, "project_id": req.project_id, "is_literals": req.is_literals}
        raise HTTPException(resp.status_code, f"SPARQL INSERT fehlgeschlagen: {resp.text[:500]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ─── RDF/XML Export (local, no external tools needed) ────────────────────────

class RdfExportRequest(BaseModel):
    uri_tsv: str          # TSV content for URI triples
    literal_tsv: str = "" # TSV content for literal triples
    format: str = "xml"   # xml, turtle, n3, nt, jsonld


def _safe_uri(val: str) -> str:
    """Ensure a value is a valid URI string; strip whitespace."""
    return val.strip() if val else ""


def _parse_tsv(tsv_content: str) -> list:
    """Parse TSV content into list of dicts."""
    if not tsv_content or not tsv_content.strip():
        return []
    lines = tsv_content.strip().split('\n')
    if len(lines) < 2:
        return []
    headers = lines[0].split('\t')
    rows = []
    for line in lines[1:]:
        cols = line.split('\t')
        row = {}
        for i, h in enumerate(headers):
            row[h.strip()] = cols[i].strip() if i < len(cols) else ""
        rows.append(row)
    return rows



@app.post("/pipeline/rdf-export")
def export_rdf(req: RdfExportRequest):
    """
    Generate RDF from URI-expanded TSV data using rdflib.
    Supports Named Graphs via ConjunctiveGraph.
    Returns debug info to help diagnose issues.
    """
    if not RDFLIB_AVAILABLE:
        raise HTTPException(500, "rdflib nicht verfügbar")

    from rdflib import ConjunctiveGraph, Graph as RdfGraph, URIRef, Literal, Namespace, BNode
    from rdflib.namespace import RDF, RDFS, XSD

    dataset = ConjunctiveGraph()

    CRM = Namespace("http://www.cidoc-crm.org/cidoc-crm/")
    dataset.bind("crm", CRM)
    dataset.bind("rdfs", RDFS)
    dataset.bind("rdf", RDF)
    dataset.bind("xsd", XSD)

    _graph_cache = {}
    DEFAULT_GRAPH_ID = URIRef("urn:x-default:graph")

    def _is_absolute_iri(val: str) -> bool:
        if not val:
            return False
        return "://" in val or val.startswith("urn:")

    def _to_uriref(val: str):
        if not val or not val.strip():
            return None
        v = val.strip()
        if _is_absolute_iri(v):
            return URIRef(v)
        return None

    def _to_uriref_lenient(val: str):
        """Like _to_uriref but also accepts prefixed names, converting them
        to absolute URIs using known namespace prefixes or a base URI.
        This is needed for Named Graph identifiers and dot-one properties
        that might not have been expanded by the frontend."""
        if not val or not val.strip():
            return None
        v = val.strip()
        if _is_absolute_iri(v):
            return URIRef(v)
        # Prefixed name like "crm:P2_has_type" — try known namespaces first
        if ":" in v and not v.startswith("_:"):
            prefix, _, local = v.partition(":")
            # Check if any bound namespace matches this prefix
            for ns_prefix, ns_uri in dataset.namespaces():
                if ns_prefix == prefix:
                    return URIRef(str(ns_uri) + local)
            # Known CRM namespaces as fallback
            known = {
                "crm": "http://www.cidoc-crm.org/cidoc-crm/",
                "crmarchaeo": "http://www.cidoc-crm.org/extensions/crmarchaeo/",
                "crmsci": "http://www.cidoc-crm.org/extensions/crmsci/",
                "lrmoo": "http://www.cidoc-crm.org/extensions/lrmoo/",
                "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
                "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
                "xsd": "http://www.w3.org/2001/XMLSchema#",
                "owl": "http://www.w3.org/2002/07/owl#",
            }
            if prefix in known:
                return URIRef(known[prefix] + local)
            # Generic fallback
            return URIRef(f"http://example.com/base/{prefix}/{local}")
        return None

    def _get_graph(i4_uri: str):
        if not i4_uri or not i4_uri.strip():
            if "__default__" not in _graph_cache:
                _graph_cache["__default__"] = dataset.get_context(DEFAULT_GRAPH_ID)
            return _graph_cache["__default__"]
        i4 = i4_uri.strip()
        # Try absolute IRI first, then lenient conversion
        if _is_absolute_iri(i4):
            graph_uri = URIRef(i4)
        else:
            ref = _to_uriref_lenient(i4)
            if ref:
                graph_uri = ref
            else:
                if "__default__" not in _graph_cache:
                    _graph_cache["__default__"] = dataset.get_context(DEFAULT_GRAPH_ID)
                return _graph_cache["__default__"]
        key = str(graph_uri)
        if key not in _graph_cache:
            _graph_cache[key] = dataset.get_context(graph_uri)
        return _graph_cache[key]

    skipped = []
    added = 0
    rdfstar_annotations = []  # Collect RDF-star triples for manual serialization

    def _add(graph, s, p, o):
        nonlocal added
        try:
            graph.add((s, p, o))
            added += 1
        except Exception as e:
            skipped.append(f"add-error: {e}")

    # Parse TSV
    uri_rows = _parse_tsv(req.uri_tsv)
    lit_rows = _parse_tsv(req.literal_tsv)

    debug_info = {
        "uri_tsv_bytes": len(req.uri_tsv) if req.uri_tsv else 0,
        "literal_tsv_bytes": len(req.literal_tsv) if req.literal_tsv else 0,
        "uri_rows_parsed": len(uri_rows),
        "literal_rows_parsed": len(lit_rows),
        "first_uri_row": uri_rows[0] if uri_rows else None,
    }

    # Process URI triples
    for row in uri_rows:
        domain_ref = _to_uriref(row.get("id_of_domain_uri", ""))
        class_ref = _to_uriref(row.get("class_of_domain_uri", ""))
        prop_ref = _to_uriref(row.get("property_uri", ""))
        range_ref = _to_uriref(row.get("id_of_the_range_uri", ""))
        range_class_ref = _to_uriref(row.get("class_of_the_range_uri", ""))
        dot1_ref = _to_uriref_lenient(row.get("dot_one_uri", ""))
        dot1_target_ref = _to_uriref_lenient(row.get("dot_one_target_uri", ""))
        i4_uri = (row.get("i4_uri", "") or "").strip()
        domain_label = (row.get("domain_label", "") or "").strip()
        range_label = (row.get("range_label", "") or "").strip()
        p3_note = (row.get("p3_has_note", "") or "").strip()

        if not domain_ref:
            val = row.get("id_of_domain_uri", "")
            if val and val.strip():
                skipped.append(f"domain not absolute IRI: {val}")
            continue

        g = _get_graph(i4_uri)

        if class_ref:
            _add(g, domain_ref, RDF.type, class_ref)
        if domain_label:
            _add(g, domain_ref, RDFS.label, Literal(domain_label, lang="en"))
        if p3_note:
            _add(g, domain_ref, CRM.P3_has_note, Literal(p3_note))
        if range_ref and range_class_ref:
            _add(g, range_ref, RDF.type, range_class_ref)
        if range_ref and range_label:
            _add(g, range_ref, RDFS.label, Literal(range_label, lang="en"))
        if prop_ref and range_ref:
            _add(g, domain_ref, prop_ref, range_ref)
        if dot1_ref and dot1_target_ref and prop_ref and range_ref:
            # Collect RDF-star annotation for manual serialization
            rdfstar_annotations.append({
                's': str(domain_ref), 'p': str(prop_ref), 'o': str(range_ref),
                'dot_p': str(dot1_ref), 'dot_o': str(dot1_target_ref),
                'graph': i4_uri,
            })
            # Also add as BNode reification so rdflib's graph has the data
            reif = BNode()
            _add(g, reif, RDF.type, RDF.Statement)
            _add(g, reif, RDF.subject, domain_ref)
            _add(g, reif, RDF.predicate, prop_ref)
            _add(g, reif, RDF.object, range_ref)
            _add(g, reif, dot1_ref, dot1_target_ref)

    # Process literal triples
    for row in lit_rows:
        domain_ref = _to_uriref(row.get("id_of_domain_uri", ""))
        class_ref = _to_uriref(row.get("class_of_domain_uri", ""))
        prop_ref = _to_uriref(row.get("property_uri", ""))
        range_value = (row.get("id_of_the_range_uri", "") or "").strip()
        range_dt_ref = _to_uriref(row.get("class_of_the_range_uri", ""))
        i4_uri = (row.get("i4_uri", "") or "").strip()
        domain_label = (row.get("domain_label", "") or "").strip()
        p3_note = (row.get("p3_has_note", "") or "").strip()

        if not domain_ref:
            continue

        g = _get_graph(i4_uri)

        if class_ref:
            _add(g, domain_ref, RDF.type, class_ref)
        if domain_label:
            _add(g, domain_ref, RDFS.label, Literal(domain_label, lang="en"))
        if p3_note:
            _add(g, domain_ref, CRM.P3_has_note, Literal(p3_note))
        if prop_ref and range_value:
            if range_dt_ref:
                _add(g, domain_ref, prop_ref, Literal(range_value, datatype=range_dt_ref))
            else:
                _add(g, domain_ref, prop_ref, Literal(range_value))

    # ── Post-process: replace BNode reification with RDF-star syntax ─────────
    def _uri_to_prefixed(uri_str, ns_map):
        """Convert absolute URI to prefixed form if possible."""
        for pfx, ns_uri in sorted(ns_map.items(), key=lambda x: -len(str(x[1]))):
            ns = str(ns_uri)
            if uri_str.startswith(ns):
                local = uri_str[len(ns):]
                if local and "/" not in local and "#" not in local:
                    return f"{pfx}:{local}"
        return f"<{uri_str}>"

    def _uri_to_full(uri_str):
        """Always return full <URI> form."""
        if uri_str.startswith("<"):
            return uri_str
        return f"<{uri_str}>"

    def _remove_bnode_reification(rdf_text):
        """Remove BNode-based RDF reification blocks from serialized output."""
        import re
        # rdflib serializes BNode reification in multiple formats:
        # Turtle/TriG: _:Nxxx a rdf:Statement ;\n    rdf:subject ... ;\n    ... .
        # N-Triples/N-Quads: multiple lines starting with _:Nxxx
        
        # Collect BNode IDs that are reification nodes
        reif_bnodes = set()
        for line in rdf_text.split('\n'):
            stripped = line.strip()
            # Match: _:Nxxx a rdf:Statement  OR  _:Nxxx <...22-rdf-syntax-ns#type> <...Statement>
            if 'Statement' in stripped and stripped.startswith('_:'):
                bnode_id = stripped.split()[0]
                reif_bnodes.add(bnode_id)
            # Turtle compact: _:Nxxx a rdf:Statement ;
            if ' a rdf:Statement' in stripped and stripped.startswith('_:'):
                bnode_id = stripped.split()[0]
                reif_bnodes.add(bnode_id)

        if not reif_bnodes:
            return rdf_text

        # Remove all lines/blocks referencing these BNode IDs
        result_lines = []
        skip_block = False
        for line in rdf_text.split('\n'):
            stripped = line.strip()
            # Check if this line starts a BNode reification block
            starts_with_reif = False
            for bn in reif_bnodes:
                if stripped.startswith(bn + ' ') or stripped.startswith(bn + '\t'):
                    starts_with_reif = True
                    break
            if starts_with_reif:
                skip_block = True
            if skip_block:
                # In Turtle/TriG, block ends with a line containing '.'
                if stripped.endswith('.'):
                    skip_block = False
                continue
            result_lines.append(line)
        return '\n'.join(result_lines)

    def _inject_rdfstar(rdf_text, annotations, ns_map, rdf_format):
        """Remove BNode reification and inject proper RDF-star syntax."""
        if not annotations:
            return rdf_text

        cleaned = _remove_bnode_reification(rdf_text)

        if rdf_format in ("nt", "nquads"):
            # N-Triples / N-Quads: must use full URIs, no prefixed names
            star_lines = []
            for ann in annotations:
                s = _uri_to_full(ann['s'])
                p = _uri_to_full(ann['p'])
                o = _uri_to_full(ann['o'])
                dp = _uri_to_full(ann['dot_p'])
                do_val = _uri_to_full(ann['dot_o'])
                if rdf_format == "nquads" and ann.get('graph'):
                    g_uri = _uri_to_full(ann['graph'])
                    star_lines.append(f"<< {s} {p} {o} >> {dp} {do_val} {g_uri} .")
                else:
                    star_lines.append(f"<< {s} {p} {o} >> {dp} {do_val} .")
            return cleaned.rstrip() + "\n" + "\n".join(star_lines) + "\n"

        elif rdf_format == "trig":
            # TriG: annotations must go inside their graph block
            # or in the default graph. Use prefixed names.
            # Group annotations by graph
            by_graph = {}
            for ann in annotations:
                g_key = ann.get('graph', '') or '__default__'
                by_graph.setdefault(g_key, []).append(ann)

            extra_blocks = []
            for g_key, anns in by_graph.items():
                lines_for_graph = []
                for ann in anns:
                    s = _uri_to_prefixed(ann['s'], ns_map)
                    p = _uri_to_prefixed(ann['p'], ns_map)
                    o = _uri_to_prefixed(ann['o'], ns_map)
                    dp = _uri_to_prefixed(ann['dot_p'], ns_map)
                    do_val = _uri_to_prefixed(ann['dot_o'], ns_map)
                    lines_for_graph.append(f"  << {s} {p} {o} >> {dp} {do_val} .")

                if g_key == '__default__':
                    # Append to default graph (no wrapper)
                    extra_blocks.append("\n# RDF-star annotations (dot-one properties)")
                    extra_blocks.extend(lines_for_graph)
                else:
                    g_uri = _uri_to_full(g_key) if not g_key.startswith('<') else g_key
                    extra_blocks.append(f"\n# RDF-star annotations for graph {g_key}")
                    extra_blocks.append(f"{g_uri} {{")
                    extra_blocks.extend(lines_for_graph)
                    extra_blocks.append("}")

            return cleaned.rstrip() + "\n" + "\n".join(extra_blocks) + "\n"

        else:
            # Turtle, N3: use prefixed names
            star_lines = ["\n# RDF-star annotations (dot-one properties)"]
            for ann in annotations:
                s = _uri_to_prefixed(ann['s'], ns_map)
                p = _uri_to_prefixed(ann['p'], ns_map)
                o = _uri_to_prefixed(ann['o'], ns_map)
                dp = _uri_to_prefixed(ann['dot_p'], ns_map)
                do_val = _uri_to_prefixed(ann['dot_o'], ns_map)
                star_lines.append(f"<< {s} {p} {o} >> {dp} {do_val} .")
            return cleaned.rstrip() + "\n" + "\n".join(star_lines) + "\n"

    # Build namespace map for prefix resolution
    _ns_map = {}
    for pfx, ns_uri in dataset.namespaces():
        _ns_map[pfx] = ns_uri

    # Serialize
    fmt_map = {
        "xml": "xml", "turtle": "turtle", "ttl": "turtle",
        "n3": "n3", "nt": "nt", "ntriples": "nt",
        "nq": "nquads", "nquads": "nquads",
        "trig": "trig",
        "jsonld": "json-ld", "json-ld": "json-ld",
    }
    rdf_format = fmt_map.get(req.format.lower().strip(), "xml")

    if rdf_format in ("xml", "turtle", "n3", "nt"):
        flat = RdfGraph()
        for prefix, ns in dataset.namespaces():
            flat.bind(prefix, ns)
        for s, p, o, _ctx in dataset.quads((None, None, None, None)):
            flat.add((s, p, o))
        try:
            rdf_output = flat.serialize(format=rdf_format)
            if isinstance(rdf_output, bytes):
                rdf_output = rdf_output.decode("utf-8")
        except Exception as e:
            raise HTTPException(500, f"Serialisierung fehlgeschlagen: {e}")
    else:
        try:
            rdf_output = dataset.serialize(format=rdf_format)
            if isinstance(rdf_output, bytes):
                rdf_output = rdf_output.decode("utf-8")
        except Exception as e:
            raise HTTPException(500, f"Serialisierung fehlgeschlagen: {e}")

    ext_map = {
        "xml": ".rdf", "turtle": ".ttl", "n3": ".n3", "nt": ".nt",
        "nquads": ".nq", "trig": ".trig", "json-ld": ".jsonld",
    }

    # Inject RDF-star syntax for formats that support it
    if rdfstar_annotations and rdf_format in ("turtle", "trig", "nt", "nquads", "n3"):
        rdf_output = _inject_rdfstar(rdf_output, rdfstar_annotations, _ns_map, rdf_format)

    mime_map = {
        "xml": "application/rdf+xml", "turtle": "text/turtle",
        "n3": "text/n3", "nt": "application/n-triples",
        "nquads": "application/n-quads", "trig": "application/trig",
        "json-ld": "application/ld+json",
    }

    return {
        "rdf": rdf_output,
        "format": rdf_format,
        "extension": ext_map.get(rdf_format, ".rdf"),
        "mime_type": mime_map.get(rdf_format, "application/rdf+xml"),
        "triple_count": added,
        "skipped_uris": sorted(set(skipped))[:30],
        "debug": debug_info,
    }
