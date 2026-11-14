# Research: material reading — parsing, fetching, search (#50)

Ticket #50 (map #46). Scope: PRD §4.9, §5.8. This doc covers facts and trade-offs only. Decisions belong to #59.
Versions come from the npm registry, checked 2026-11-14. Pricing comes from vendor pages fetched the same day.

## 1. Local file parsing (Node, inside the Electron local service)

| Package | Version / license | Last publish | Native deps | Unpacked size | Notes |
|---|---|---|---|---|---|
| `pdfjs-dist` | 6.5.438 / Apache-2.0 | 2026-11-01 | none in the text path; canvas is needed only to render | ~37.6 MB (mostly fonts, cmaps, and multiple builds) | Mozilla's reference engine. `getDocument` → `getPage(n).getTextContent()` gives text per page, with position items and an outline/TOC. In Node use `pdfjs-dist/legacy/build/pdf.mjs` and point it at `standardFontDataUrl`. |
| `unpdf` | 2.2.0 / MIT | 2026-11-14 | none | ~3.1 MB | A serverless bundle of PDF.js 6.5.438 (unjs). `extractText(pdf, { mergePages:false })` returns an array of page strings. The README requires Node 24+. It presents itself as the maintained replacement for pdf-parse. |
| `pdf-parse` | 2.4.5 / Apache-2.0 | 2025-10-29 | **`@napi-rs/canvas` 0.1.80**, a prebuilt native binary | ~21 MB | v2 is a rewrite on pdfjs-dist 5.4.296, which pins an older pdfjs. The native binary adds complexity to Electron packaging and signing. |
| `mammoth` | 1.13.0 / BSD-2-Clause | 2026-09-26 | none (jszip, xmldom) | ~1.7 MB | Converts DOCX to semantic HTML or raw text and keeps the heading styles. It ignores most formatting by design. |
| `officeparser` | 8.7.1 / MIT | 2026-11-09 | none, but pulls in `tesseract.js` (OCR), pdfjs 6.2.108, and file-type | ~36.6 MB | One API for docx/pptx/xlsx/odt/pdf. It is heavy and carries a second pdfjs copy. |
| `mdast-util-from-markdown` | 2.1.0 / MIT | 2026-10-03 | none | small | Builds a Markdown AST with line/column positions. `remark-parse` 11.0.0 wraps it inside unified. `marked` 18.2.0 is faster but gives weaker position info. |

**Citation granularity**
- **PDF:** per-page text is native in all pdfjs-based options. The citation unit is "file + page N". Headings come only from the outline (`getOutline`), which is often missing. Scanned PDFs have no text layer, so text extraction returns empty or near-empty pages. Detecting that and reporting "cannot read" fits the PRD rule against pretending to have read something (§5.8). OCR (tesseract.js) is the only local remedy, and it is large and slow.
- **DOCX:** has no page concept, because pagination happens at render time. Mammoth's HTML keeps `h1..h6`, so chunking uses a heading path ("§ Heading > Subheading") plus a paragraph index.
- **Markdown/plain text:** use the heading path from the mdast tree plus line ranges from `position`. For plain text, use line ranges or paragraph index. Encoding must be sniffed when it isn't UTF-8 (e.g. GBK files). Node's `TextDecoder` supports `gbk`/`gb18030` with full ICU, and Electron ships full ICU.
- **Size/"on demand" (§5.8):** pdfjs can load single pages, so a cheap triage pass can read page count and outline before full extraction. Prior art (below) uses size classes of ≤10, ≤40, and >40 pages.

## 2. Web page fetch + main-content extraction

| Package | Version / license | Last publish | Notes |
|---|---|---|---|
| `@mozilla/readability` | 0.6.0 / Apache-2.0 | 2025-03-03 | The Firefox Reader View algorithm. It needs a DOM `Document`, slow-moving but stable. |
| `linkedom` | 0.18.15 / ISC | 2026-11-01 | A light DOM (~1.2 MB) that runs no scripts. It is enough for Readability and Defuddle. |
| `jsdom` | 31.0.1 / MIT | 2026-11-13 | A fuller DOM (~6.9 MB plus deps such as undici and parse5). It can run scripts, which is unsafe for untrusted pages and not needed here. |
| `defuddle` | 0.19.6 / MIT | 2026-10-24 | By kepano (Obsidian Web Clipper). An alternative to Readability that removes less, standardises footnotes, math, and code, reads schema.org metadata, and can output Markdown (`markdown:true`). The README says "very much a work in progress". It works with linkedom, jsdom, or happy-dom and is ESM-only. |
| `turndown` | 7.2.5 / MIT | 2026-11-04 | Converts HTML to Markdown. It is needed after Readability, while Defuddle has this built in. |
| `robots-parser` | 3.0.1 / MIT | 2023-02-21 | Stable but unmaintained. |

**JS-heavy pages.** A static fetch plus Readability returns little or nothing on SPAs. Options:
- Report "can't read" honestly. This is the simplest option and fits §5.8.
- Render in a hidden Electron `BrowserWindow`/`WebContentsView` with JS on, then hand `document.documentElement.outerHTML` to the extractor. No extra dependency is needed. Costs: memory, the page's own scripts run (sandbox it, turn off node integration, use a separate session partition with no cookies so login-gated content is never reached), and pages can stall (needs a hard timeout).
- Use a hosted reader such as Jina Reader (`r.jina.ai/<url>`). It sends the URL to a third party, so it needs a privacy disclosure like the one for search.

**Safety and politeness facts relevant to §5.8**
- Fetch only the URL the user gave, with no crawling or link following beyond redirects.
- SSRF: a user-pasted link or a link in a fetched page could point at `localhost`, private IP ranges, or `169.254.169.254`. Block it at DNS-lookup time, including after redirects.
- Hard timeout (`AbortSignal.timeout`, 30 s in prior art) and a response size cap (5 MB HTML, 25 MB PDF in prior art). Check the content type before parsing, and route PDFs to the PDF path.
- Robots.txt formally governs crawlers. A single fetch the user explicitly asked for is closer to browser behaviour, and many reader tools ignore robots for it. Whether to honour it is a policy choice for #59.
- No cookies, no auth headers. This satisfies "do not access sites that need login".
- Extracted text is untrusted data. Wrap it in delimiters and attach source metadata (final URL, HTTP status, fetch time) for citation and for the "data, not instructions" rule.

## 3. Search services (BYOK, off by default per §5.8)

| Service | API shape | Free tier | Paid | Privacy notes |
|---|---|---|---|---|
| **Brave Search API** | `GET api.search.brave.com/res/v1/web/search?q=&count=&country=&search_lang=`, header `X-Subscription-Token`. Also `/res/v1/llm/context` (grounding snippets, token budget) and an OpenAI-compatible Answers endpoint. | $5 credit each month (the page also says "up to $20", which isn't reconciled). Credit card required. | Search $5 per 1k requests, 50 QPS. Answers $4 per 1k plus tokens. | Brave runs its own index with no Google/Bing fallback. Zero data retention is listed under Enterprise. The page gives no retention period for standard plans. Storing results needs a custom plan. |
| **Tavily** | `POST api.tavily.com/search` (Bearer). JSON body: `query`, `search_depth`, `max_results`, optional `include_answer`/`include_raw_content`. Also offers Extract, Map, and Crawl. JS SDK `@tavily/core` 1.1.0 (MIT). | 1,000 credits/month, no card | Pay-as-you-go $0.008/credit. Plans $30/4k to $500/100k. Basic search 1 credit, advanced 2. Extract 1 credit per 5 URLs. | Built for LLM use and returns cleaned content. Data-use terms weren't checked here; review them before shipping. |
| **Exa** | `POST api.exa.ai/search` (`x-api-key`). Neural/keyword search types plus a separate `contents` call. JS SDK `exa-js` 2.28.0 (MIT). | $10 credit, resets monthly, no card | Search lite/instant $4 per 1k, auto/fast $7 per 1k, deep $12–15 per 1k. Contents $1 per 1k pages. | Zero data retention requires Enterprise ($12k/yr) or a team upgrade. |
| **SearXNG (self-hosted)** | `GET /search?q=&format=json&language=&pageno=&time_range=` | Free, but the user must run an instance (e.g. Docker) | — | A meta-search engine that forwards queries to upstream engines. `format=json` must be enabled in `settings.yml`, otherwise the API returns 403, and most public instances disable it. There is no built-in API auth. It is the most private option but needs the most setup. |

All of these send the query text to the provider. §5.8 already requires the UI to say so.

## 4. Prior art: `~/code/learnharness` (the path in the brief, `~/code/learningharness`, doesn't exist)

Directly relevant, working code:
- `src/agent/tools/web.ts`: `safeFetch`, then a content-type check, then linkedom with Readability and Turndown into Markdown, then truncation at 40k characters. It falls back to Jina Reader for JS pages and puts a source line (final URL and HTTP status) at the top of every result.
- `src/agent/tools/safe-fetch.ts` (106 lines): a DNS-lookup-time SSRF guard covering private, loopback, link-local, and metadata ranges, and redirects.
- `src/agent/subagents/pdf-ops.ts` and `src/agent/tools/pdf-read.ts`: a pdfjs-dist legacy build with no native deps. Provides `pdf_info` (triage by page count) and `pdf_extract`/`pdf_search` (page-cited), and caps downloads at 25 MB.
- `src/server/search.ts` and `src/core/search.ts`: a `SearchProvider { search(query, count) }` interface with adapters for Tavily, Brave, Exa, Firecrawl, and Ollama web search. It resolves keys from env/settings and reports an "honest status" for the UI.
- **License caveat:** learnharness is **AGPL-3.0-only**. Copying code into aimthread is fine only if the same author owns it and relicenses, or if aimthread accepts AGPL.

## 5. Trade-offs for #59

1. **PDF engine.**
   - `pdfjs-dist`: full control and the same engine as prior art, but large.
   - `unpdf`: small, page arrays out of the box, tracks pdfjs closely, but needs Node 24+ (check Electron's bundled Node version).
   - `pdf-parse` v2: brings a native dependency and an older pdfjs.
2. **DOCX.** `mammoth` (light, heading-aware) or `officeparser` (covers more formats, ~37 MB, OCR included).
3. **Extractor.** Readability with Turndown (proven, used in prior art) or Defuddle (better structure and Markdown, less mature).
4. **JS pages.** Report "can't read", render in a hidden Electron window, or use a hosted reader (privacy cost).
5. **Search providers at launch.** Brave (own index, simple), Tavily (generous free tier, LLM-oriented), Exa, and/or SearXNG (privacy-first, self-hosted). Prior art shows a provider-agnostic interface is about 300 lines.
6. **Scanned PDFs.** No OCR (say "cannot read") or local tesseract.js (size and speed cost).

## Sources

- npm registry metadata (`npm view <pkg> version license time.modified dependencies dist.unpackedSize`), 2026-11-14
- https://github.com/unjs/unpdf · https://github.com/kepano/defuddle · https://github.com/mozilla/pdf.js · https://github.com/mwilliamson/mammoth.js
- https://brave.com/search/api/ · https://docs.tavily.com/documentation/api-credits · https://exa.ai/pricing · https://docs.searxng.org/dev/search_api.html
- `~/code/learnharness` at its local HEAD (files cited in §4)
