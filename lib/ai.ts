// Server-side AI layer (OpenAI, Ludwig's own key). Used to plan weeks with
// actual judgment instead of pure heuristics — the deterministic engine
// stays as the auditor (hard budget math) and the fallback.
//
// Env: OPENAI_API_KEY (required for AI mode), AI_MODEL (default gpt-5.5).

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.5";
// A full invented week (7 days × 3 meals as JSON) is a big completion; the
// caller guards the route's total time budget, so one call gets real room.
const TIMEOUT_MS = 150_000;

export type AiJsonResult<T> = { ok: true; value: T; model: string } | { ok: false; error: string };

export function aiAvailable(): boolean {
  return typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
}

async function requestJson(
  key: string,
  model: string,
  system: string,
  user: string,
  reasoningEffort: string | undefined,
): Promise<{
  status: number;
  data: { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> };
}> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 16_000,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

/**
 * One JSON-mode completion. Returns a typed failure instead of throwing so
 * callers can always fall back to the deterministic path.
 *
 * Structured planning output doesn't need deep chains of thought, so
 * reasoning models are asked for low effort (big latency win); if the model
 * rejects the parameter, the request is retried once without it.
 */
export async function askJson<T>(system: string, user: string): Promise<AiJsonResult<T>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "OPENAI_API_KEY is not set" };
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  try {
    let { status, data } = await requestJson(key, model, system, user, "low");
    if ((status >= 400 || data.error) && /reasoning/i.test(data.error?.message ?? "")) {
      ({ status, data } = await requestJson(key, model, system, user, undefined));
    }
    if (status >= 400 || data.error) {
      return { ok: false, error: data.error?.message ?? `openai returned ${status}` };
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "openai returned an empty response" };
    return { ok: true, value: JSON.parse(content) as T, model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
