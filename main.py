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


def uri_to_dict(uri: str, graph: Graph, ns: dict) -> dict:
    label = get_prefix_label(uri, ns)
    rdfs_label = graph.value(URIRef(uri), RDFS.label)
    rdfs_comment = graph.value(URIRef(uri), RDFS.comment)
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
