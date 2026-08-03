// Streamable HTTP MCP endpoint, auth-gated.
//
// Accepted auth forms:
//   1. Authorization: Bearer <key>          → POST /api/mcp
//   2. Path key (header-less MCP clients)   → POST /api/mcp/<key>
// Both are checked timing-safely; unknown callers get a uniform 401 and
// learn nothing. The path form appears in the owner's own Vercel logs —
// acceptable at this threat model (documented in ONBOARDING.md).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import { registerAll, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "@/lib/create-server";
import { keyFingerprint, verifyKey } from "@/lib/http/auth";
import { runWithAccount } from "@/lib/http/context";
import { takeToken } from "@/lib/http/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// mcp-handler 1.x reuses a single stateless transport per handler instance,
// which only survives ONE request on a warm serverless instance (the second
// POST gets an empty 500 — verified empirically). Building a fresh handler
// per request sidesteps that; tool registration is just closures and costs
// well under a millisecond.
function makeMcpHandler(): (req: Request) => Promise<Response> {
  return createMcpHandler(
    (server: McpServer) => {
      registerAll(server);
    },
    {
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: SERVER_INSTRUCTIONS,
    },
    {
      basePath: "/api",
      disableSse: true,
      maxDuration: 120,
      verboseLogs: false,
    },
  );
}

function unauthorized(): Response {
  // Identical body and headers for every failure mode.
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="madtrolden"',
    },
  });
}

function extractKey(req: Request, pathSegments: string[]): string | null {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  if (pathSegments.length === 1) {
    return pathSegments[0];
  }
  return null;
}

async function handle(
  req: Request,
  { params }: { params: Promise<{ key?: string[] }> },
): Promise<Response> {
  const { key: pathSegments = [] } = await params;

  // Never accept keys via query string, and reject deeper paths outright.
  if (pathSegments.length > 1) {
    return unauthorized();
  }

  const candidate = extractKey(req, pathSegments);
  const account = verifyKey(candidate);
  if (account === null) {
    console.error(
      `[auth] 401 key=${candidate ? keyFingerprint(candidate) : "none"} ua="${req.headers.get("user-agent") ?? ""}"`,
    );
    return unauthorized();
  }

  const rate = takeToken(account);
  if (!rate.ok) {
    console.error(`[rate] 429 account=${account}`);
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(rate.retryAfterSec),
      },
    });
  }

  console.error(`[auth] ok account=${account}`);

  // mcp-handler resolves the transport from the pathname; normalize the
  // path-key form (/api/mcp/<key>) to the canonical endpoint before handing
  // off. MCP messages are small, so buffering the body (instead of piping the
  // stream, which trips undici's duplex requirement) is fine.
  const url = new URL(req.url);
  url.pathname = "/api/mcp";
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  const headers = new Headers(req.headers);
  headers.delete("authorization"); // the handler never needs the key
  const normalized = new Request(url, { method: req.method, headers, body });

  try {
    const mcpHandler = makeMcpHandler();
    const res = await runWithAccount(account, () => mcpHandler(normalized));
    console.error(`[mcp] ${req.method} -> ${res.status}`);
    return res;
  } catch (err) {
    console.error("[mcp] handler threw:", err);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export { handle as GET, handle as POST, handle as DELETE };
