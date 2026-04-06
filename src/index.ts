/**
 * TED Europa API — MCP Server
 * Public endpoints only (no API key required):
 *   • Search  → POST /v3/notices/search
 *   • Dev Ops → GET  /v3/config/sdk-versions
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://api.ted.europa.eu";

async function tedFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const resp = await fetch(`${BASE_URL}${path}`, options);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`TED API ${resp.status} ${resp.statusText}: ${body}`);
  }
  return resp.json();
}

const server = new McpServer({ name: "ted-europa", version: "1.0.0" });

// ---------------------------------------------------------------------------
// search_notices
// ---------------------------------------------------------------------------

const DEFAULT_FIELDS = ["ND", "PD", "TI", "CY", "TY", "PC", "CA", "DD", "RC", "OJ"];

server.tool(
  "search_notices",
  "Search published TED EU procurement notices. No authentication required. " +
    "Uses TED expert query language: FIELD=[VALUE] with AND/OR operators. " +
    "Key fields: ND (notice number), PD (publication date YYYYMMDD), CY (country ISO code), " +
    "PC (CPV code), CA (contracting authority name), TY (notice type 1-7), RC (NUTS region). " +
    "Date range syntax: PD=[20240101..20240131]. " +
    "Examples: 'CY=[FR] AND PC=[45000000]', 'ND=[123456-2024]', 'TY=[3] AND CY=[DE]'.",
  {
    query: z.string().describe(
      "TED expert query string. E.g. 'CY=[FR] AND PC=[45000000]' or 'ND=[123456-2024]'"
    ),
    fields: z.array(z.string()).optional().describe(
      "Fields to return. Default: ND, PD, TI, CY, TY, PC, CA, DD, RC, OJ"
    ),
    page: z.number().int().min(1).default(1).describe("Page number (starts at 1)"),
    limit: z.number().int().min(1).max(100).default(10).describe("Results per page (1–100)"),
    scope: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0).describe(
      "0=ACTIVE notices, 1=ARCHIVED, 2=ALL"
    ),
    onlyLatestVersions: z.boolean().default(true).describe(
      "Return only the latest version of each notice"
    ),
  },
  async ({ query, fields, page, limit, scope, onlyLatestVersions }) => {
    const data = await tedFetch("/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, fields: fields ?? DEFAULT_FIELDS, page, limit, scope, onlyLatestVersions }),
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// get_notice
// ---------------------------------------------------------------------------

server.tool(
  "get_notice",
  "Retrieve a specific TED notice by its document number (e.g. '123456-2024'). " +
    "Returns all available fields. No authentication required.",
  {
    notice_number: z.string().describe("Notice document number, format NNNNNN-YYYY"),
  },
  async ({ notice_number }) => {
    const allFields = [
      "ND", "PD", "TI", "CY", "TY", "PC", "CA", "DD", "RC", "OJ",
      "AC", "RN", "MA", "PR", "RP", "TD", "NC", "CR", "AA",
    ];
    const data = (await tedFetch("/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `ND=[${notice_number}]`,
        fields: allFields,
        page: 1,
        limit: 1,
        scope: 2,
        onlyLatestVersions: false,
      }),
    })) as { notices?: unknown[] };

    const notices = data?.notices ?? [];
    if (notices.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Notice '${notice_number}' not found` }) }] };
    }
    const result = {
      ...(notices[0] as object),
      ted_url: `https://ted.europa.eu/en/notice/${notice_number}`,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// get_notice_xml
// ---------------------------------------------------------------------------

server.tool(
  "get_notice_xml",
  "Download the full XML content of a TED notice (complete description, technical specs, " +
    "award criteria, etc.). No authentication required.",
  {
    notice_number: z.string().describe("Notice document number, format NNNNNN-YYYY"),
  },
  async ({ notice_number }: { notice_number: string }) => {
    const url = `https://ted.europa.eu/udl?uri=TED:NOTICE:${notice_number}:TEXT:EN:XML`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`TED ${resp.status}: notice '${notice_number}' XML not found`);
    }
    const xml = await resp.text();
    return { content: [{ type: "text", text: xml }] };
  }
);

// ---------------------------------------------------------------------------
// get_notice_docs_url
// ---------------------------------------------------------------------------

server.tool(
  "get_notice_docs_url",
  "Extract the procurement documents URL (DCE/dossier de consultation) from a TED notice. " +
    "Works with both legacy TED XML and eForms formats. No authentication required.",
  {
    notice_number: z.string().describe("Notice document number, format NNNNNN-YYYY"),
  },
  async ({ notice_number }: { notice_number: string }) => {
    const url = `https://ted.europa.eu/udl?uri=TED:NOTICE:${notice_number}:TEXT:EN:XML`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`TED ${resp.status}: notice '${notice_number}' not found`);
    }
    const xml = await resp.text();

    // eForms format: <cbc:URI> inside <cac:CallForTendersDocumentReference>
    const eformsMatch = xml.match(
      /<cac:CallForTendersDocumentReference>[\s\S]*?<cbc:URI>(.*?)<\/cbc:URI>/
    );

    // Legacy TED XML format: <URL_DOCUMENT> or <URL_GENERAL>
    const legacyDocMatch = xml.match(/<URL_DOCUMENT>(.*?)<\/URL_DOCUMENT>/);
    const legacyGeneralMatch = xml.match(/<URL_GENERAL>(.*?)<\/URL_GENERAL>/);

    // eForms BT-15 pattern (alternative)
    const bt15Match = xml.match(/name="BT-15[^"]*"[^>]*>(.*?)<\//);

    const docs_url =
      eformsMatch?.[1] ??
      legacyDocMatch?.[1] ??
      bt15Match?.[1] ??
      null;

    const general_url = legacyGeneralMatch?.[1] ?? null;

    if (!docs_url && !general_url) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            notice_number,
            docs_url: null,
            general_url: null,
            ted_url: `https://ted.europa.eu/en/notice/${notice_number}`,
            message: "Aucun lien DCE trouvé dans l'avis — les documents sont peut-être sur le portail acheteur uniquement.",
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          notice_number,
          docs_url,
          general_url,
          ted_url: `https://ted.europa.eu/en/notice/${notice_number}`,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// get_sdk_versions
// ---------------------------------------------------------------------------

server.tool(
  "get_sdk_versions",
  "Get the eForms SDK version range currently supported by the TED Central " +
    "Validation Service (CVS). No authentication required.",
  {},
  async () => {
    const data = await tedFetch("/v3/config/sdk-versions");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
