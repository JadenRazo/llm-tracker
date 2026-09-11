# Dashboard layout decision

The homepage should deliver an actual update in the first viewport and make
models, releases, commands, and original sources easy to reach. The Models page
must have one selected navigation section and real discovery controls.

Three approaches were considered:

1. **Activity first:** a compact introduction, readable update list, and adjacent
   provider resources. Risk: status volume and duplicate prereleases overwhelm
   useful changes. Addressed with separate bounded query slices, grouped CLI
   releases, a product-update default, explicit filters, and prerelease opt-in.
2. **Models first:** put a catalog or comparison tool on the homepage. Rejected
   as the main layout because model fields vary across providers and the product
   also serves release/reference tasks. Search, capability filters, exact context
   values, sorting, and ID copying improve the catalog in its own section.
3. **Tasks first:** begin with large resource shortcuts. Rejected because it
   repeats the previous navigation-before-content problem. Compact task links
   instead sit next to the activity and inside provider pages.

The selected design combines activity first with compact task access. Its visual
identity uses dark forest surfaces, restrained provider colors, serif display
headings, and readable sans-serif content. Source attribution and useful controls
carry the visual hierarchy; decorative illustrations and unsupported ranking or
pricing claims would not help the user's task.

Navigation separates provider context from the current section. Provider homes
match exactly, while detail pages retain their section. The mobile menu uses a
native dialog plus an explicit keyboard loop, Escape dismissal, focus restoration,
and viewport-bounded scrolling. A separate reviewer identified compressed mobile
model filters that a page-overflow check missed; the corrected toolbar uses a grid
with a full-width search row and two adequately sized selects.

The data contract remains: unavailable reads differ from successful empty results;
database routes render dynamically; existing bounded caching and ingestion remain
in place. Stable-only labels reject the shared version reader's prerelease fallback.
Publication dates take precedence over detection timestamps when grouping releases.
Unknown model capabilities and context values remain explicitly unknown.

Independent contexts through the subscription router covered information hierarchy,
model-catalog implementation, and the complete code/visual review. Browser evidence
uses a disposable PostgreSQL database reconstructed from public RSS and rendered
catalogs, rather than production database access. This tests display behavior and
does not establish current ingestion health or completeness of upstream catalogs.
