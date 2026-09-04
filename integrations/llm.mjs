/**
 * integrations/llm.mjs — Real LLM Integration
 *
 * Replaces every hard-coded nudge string in the engine with actual LLM calls.
 * Supports Groq (LLaMA 3.3 70B — same API your canvas repo uses) and OpenAI.
 *
 * Key functions:
 *   generateNudge(context)  → AI-generated operator nudge from session state
 *   streamChat(messages, onToken)  → streaming AI chat (token by token, like your canvas bot)
 *   analyzeSession(session) → AI summary of what's happening in the session
 *
 * No API key? Falls back gracefully to a static rule-based nudge so the app
 * still works without credentials.
 */

// ── Provider selection ─────────────────────────────────────────────────────
// We load these lazily so the module still imports even without the packages.
const PROVIDER = process.env.LLM_PROVIDER || 'groq';
const GROQ_KEY = process.env.GROQ_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// ── Groq client (LLaMA 3.3 70B — free tier, fast, real AI) ────────────────
let groqClient = null;
async function getGroq() {
  if (groqClient) return groqClient;
  try {
    const { Groq } = await import('groq-sdk');
    groqClient = new Groq({ apiKey: GROQ_KEY });
    return groqClient;
  } catch (e) {
    console.warn('[llm] groq-sdk not available:', e.message);
    return null;
  }
}

// ── Check whether a real LLM is configured ────────────────────────────────
export function isLLMConfigured() {
  if (PROVIDER === 'groq') return Boolean(GROQ_KEY && GROQ_KEY !== 'your_groq_api_key_here');
  if (PROVIDER === 'openai') return Boolean(OPENAI_KEY);
  return false;
}

// ── Core call: non-streaming, returns full text string ────────────────────
async function callLLM(messages, { maxTokens = 256, temperature = 0.7 } = {}) {
  if (!isLLMConfigured()) {
    // No key — return a rule-based fallback so the app still works
    return null;
  }

  if (PROVIDER === 'groq') {
    const groq = await getGroq();
    if (!groq) return null;
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',   // same model your canvas repo uses
      messages,
      max_tokens: maxTokens,
      temperature,
    });
    return resp.choices[0]?.message?.content ?? null;
  }

  if (PROVIDER === 'openai') {
    // Dynamic import so missing package doesn't crash the whole server
    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_KEY });
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: maxTokens,
      temperature,
    });
    return resp.choices[0]?.message?.content ?? null;
  }

  return null;
}

// ── Streaming call: delivers tokens one by one via callback ───────────────
// This is exactly how your canvas repo's AI bot works — real streaming.
export async function streamChat(messages, onToken) {
  if (!isLLMConfigured()) {
    // Simulate a streaming response with the fallback text
    const text = '[LLM not configured — add GROQ_API_KEY to .env]';
    for (const word of text.split(' ')) {
      onToken(word + ' ');
      await new Promise(r => setTimeout(r, 30));
    }
    onToken(null); // null = stream done
    return;
  }

  if (PROVIDER === 'groq') {
    const groq = await getGroq();
    if (!groq) { onToken('[Groq client unavailable]'); onToken(null); return; }

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 512,
      temperature: 0.7,
      stream: true,  // ← real streaming
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) onToken(token);
    }
    onToken(null); // stream complete
    return;
  }

  // OpenAI streaming
  if (PROVIDER === 'openai') {
    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_KEY });
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
    });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) onToken(token);
    }
    onToken(null);
  }
}

// ── SYSTEM PROMPT: what the AI knows about Backstage ──────────────────────
const SYSTEM_PROMPT = `You are Backstage, an AI operator companion for live business sessions.
You watch a real-time session (webinar, checkout funnel, support queue, etc.) and help the operator take action.

Your role:
- Give SHORT, ACTIONABLE nudges (1-2 sentences max) when you spot problems
- Mention specific numbers (drop %, focus score, stage name) from the data
- Suggest a SPECIFIC lever/action the operator can take RIGHT NOW
- Be direct — the operator is in a live session, no time for fluff

You have access to: actor counts, focus scores, retention %, stage names, recent leave reasons, and the available levers for this surface.`;

// ── generateNudge: AI replaces hard-coded nudge strings ───────────────────
/**
 * Called from server/realtime.mjs and engine/core.mjs hooks.
 * context = {
 *   surface: string,   // "webinar", "checkout", etc.
 *   stage: string,     // current stage id
 *   stageLabel: string,
 *   focus: number,     // 0–1
 *   retention: number, // 0–1
 *   concurrent: number,
 *   peak: number,
 *   dropCount: number, // how many left recently
 *   topReason: string, // most common leave reason
 *   availableLevers: string[], // lever labels the operator can try
 *   triggerType: string, // "burst" | "cliff" | "idle" | "custom"
 * }
 */
export async function generateNudge(context) {
  const {
    surface, stage, stageLabel, focus, retention,
    concurrent, peak, dropCount, topReason,
    availableLevers, triggerType,
  } = context;

  const retPct = (retention * 100).toFixed(0);
  const focusPct = (focus * 100).toFixed(0);

  const userMessage = `
Session state:
- Surface: ${surface}
- Stage: "${stageLabel}" (${stage})
- Focus score: ${focusPct}% (${focus < 0.35 ? 'CRITICAL — dangerously low' : focus < 0.55 ? 'declining' : 'healthy'})
- Retention: ${retPct}% of peak (${concurrent}/${peak} actors)
- Recent drop trigger: ${triggerType} — ${dropCount} ${surface === 'webinar' ? 'attendees' : 'actors'} left
- Top leave reason: "${topReason}"
- Available levers: ${availableLevers.length ? availableLevers.join(', ') : 'none armed'}

Generate a SHORT, SPECIFIC, ACTIONABLE nudge for the operator. One or two sentences max. Mention numbers. Suggest the most relevant lever.`;

  // Try real LLM first
  const text = await callLLM([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ], { maxTokens: 120, temperature: 0.6 });

  if (text) return { text: text.trim(), source: 'llm', model: PROVIDER === 'groq' ? 'llama-3.3-70b' : 'gpt-4o-mini' };

  // Fallback: rule-based nudge (same quality as before, but honest about it)
  return {
    text: generateFallbackNudge(context),
    source: 'rules',
    model: null,
  };
}

// ── Fallback rule-based nudge (used when no API key is set) ───────────────
function generateFallbackNudge({ triggerType, dropCount, stageLabel, focus, availableLevers, surface }) {
  const actor = surface === 'webinar' ? 'attendee' : 'actor';
  const plural = surface === 'webinar' ? 'attendees' : 'actors';

  if (triggerType === 'burst') {
    if (availableLevers.length) {
      return `${dropCount} ${plural} just left during "${stageLabel}". Try "${availableLevers[0]}" to re-engage the remaining audience.`;
    }
    return `${dropCount} ${plural} just left during "${stageLabel}". Focus score is ${(focus * 100).toFixed(0)}% — consider changing the content pace.`;
  }

  if (triggerType === 'cliff') {
    return `Focus dropped sharply in "${stageLabel}". Engagement is low — ${availableLevers.length ? `try "${availableLevers[0]}"` : 'consider a direct question or poll'} to recover attention.`;
  }

  return `Session health declining in "${stageLabel}". Focus: ${(focus * 100).toFixed(0)}%. Take action now.`;
}

// ── analyzeSession: full AI session summary ───────────────────────────────
/**
 * Called at end of a session to generate a human-readable summary.
 * Returns an object with { summary, keyFindings, recommendations }
 */
export async function analyzeSession(sessionData) {
  const {
    surface, metrics, topNudges, moments, leversUsed,
  } = sessionData;

  if (!isLLMConfigured()) {
    return {
      summary: `Session on ${surface} completed. ${metrics.retention * 100 | 0}% retention, ${metrics.outcomes} outcomes.`,
      keyFindings: [],
      recommendations: [],
      source: 'rules',
    };
  }

  const prompt = `Analyze this Backstage session and provide a concise report:

Surface: ${surface}
Final metrics:
- Retention: ${(metrics.retention * 100).toFixed(1)}% of peak
- Outcomes: ${metrics.outcomes} (${(metrics.outcome_rate * 100).toFixed(1)}% rate)
- Revenue: $${metrics.revenue?.toLocaleString() ?? 'N/A'}
- ROI: ${((metrics.roi ?? 0) * 100).toFixed(1)}%
- Avg dwell: ${metrics.avg_dwell?.toFixed(1)} ${surface === 'webinar' ? 'minutes' : 'units'}

Nudges sent: ${topNudges?.length ?? 0}
Key moments: ${moments?.slice(0, 5).map(m => m.caption).join('; ') ?? 'none'}
Levers active: ${leversUsed?.join(', ') ?? 'none'}

Respond in JSON with keys: summary (string), keyFindings (array of strings), recommendations (array of strings).`;

  const text = await callLLM([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ], { maxTokens: 400, temperature: 0.5 });

  if (text) {
    try {
      // Extract JSON from the response (LLM sometimes wraps in markdown)
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return { ...JSON.parse(match[0]), source: 'llm' };
    } catch { /* fall through */ }
    return { summary: text, keyFindings: [], recommendations: [], source: 'llm' };
  }

  return {
    summary: `${surface} session ended. ${metrics.outcomes} outcomes at ${(metrics.outcome_rate * 100).toFixed(1)}% rate.`,
    keyFindings: [],
    recommendations: [],
    source: 'rules',
  };
}

// ── Chat: operator can ask questions about the session ────────────────────
/**
 * Powers the AI chat widget in the console.
 * history = array of { role: 'user'|'assistant', content: string }
 * sessionContext = current session state to inject as context
 */
export async function buildChatMessages(history, sessionContext) {
  const contextBlock = sessionContext ? `
Current session context:
- Surface: ${sessionContext.surface}
- Stage: ${sessionContext.stage}
- Retention: ${(sessionContext.retention * 100).toFixed(0)}%
- Focus: ${(sessionContext.focus * 100).toFixed(0)}%
- Dataset rows so far: ${sessionContext.rows}
- Active levers: ${sessionContext.levers?.join(', ') || 'none'}
` : '';

  return [
    { role: 'system', content: SYSTEM_PROMPT + (contextBlock ? '\n\n' + contextBlock : '') },
    ...history.slice(-12), // keep last 12 messages for context window
  ];
}

console.log(`[llm] provider=${PROVIDER} configured=${isLLMConfigured()}`);
