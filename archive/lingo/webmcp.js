/**
 * webmcp.js — WebMCP Tool Registration
 *
 * This file implements the core of the WebMCP standard:
 *   document.modelContext.registerTool({ name, description, inputSchema, execute })
 *
 * All 8 Lingo tools are registered here so that:
 *   - AI agents (ChatGPT, Claude, Codex) can call them via the browser
 *   - The Chrome WebMCP flag surfaces them automatically
 *   - The MCP-B browser extension can discover and invoke them
 *   - Regular users can also trigger them via the UI (tools.js)
 *
 * The document.modelContext API is available natively in:
 *   - ChatGPT's in-app browser (WebMCP built-in)
 *   - Chrome with chrome://flags/#enable-webmcp-testing
 *
 * For other browsers, we attempt to load the @mcp-b/global polyfill.
 */

import * as Tools from './tools.js';

// ── Status tracking ────────────────────────────────────────────
export const webmcpState = {
  available: false,
  registered: 0,
  toolNames: [],
};

// ── Tool definitions (what gets registered with document.modelContext) ─────
const TOOL_DEFINITIONS = [
  {
    name: 'explore_topic',
    description:
      'Research and explore any topic in depth. Returns a structured summary with key concepts, facts, and related topics. Supports any language — the query can be in any language and results will be provided in that language.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The topic to explore. Can be in any language.' },
        language: { type: 'string', description: 'ISO 639-1 language code (e.g. "en", "hi", "es", "ar"). Default: "en"' },
        depth: { type: 'string', description: 'Research depth: "brief" | "standard" | "deep". Default: "standard"' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const result = await Tools.exploreTopic(args.query, args.language || 'en', args.depth || 'standard');
      // Emit UI event so the graph updates in real-time
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'explore_topic', result } }));
      return result;
    },
  },

  {
    name: 'build_knowledge_map',
    description:
      'Build a visual knowledge map (mind map) for a topic. Returns a structured graph of nodes and connections that Lingo will render visually. Call after explore_topic to create a navigable knowledge structure.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic to map (should match the explored topic).' },
        sections: {
          type: 'string',
          description: 'JSON array of section names from explore_topic results to include as nodes.',
        },
        depth: { type: 'number', description: 'Map depth: 1 (overview) to 3 (detailed). Default: 2' },
      },
      required: ['topic'],
    },
    execute: async (args) => {
      const sections = args.sections ? JSON.parse(args.sections) : null;
      const result = await Tools.buildKnowledgeMap(args.topic, sections, args.depth || 2);
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'build_knowledge_map', result } }));
      return result;
    },
  },

  {
    name: 'translate_content',
    description:
      'Translate any text into any language. Use this to make knowledge accessible to non-English speakers. Returns translated text with the detected source language.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to translate.' },
        target_language: { type: 'string', description: 'Target language code (e.g. "hi" for Hindi, "ar" for Arabic, "es" for Spanish).' },
        source_language: { type: 'string', description: 'Source language code. Default: auto-detect.' },
      },
      required: ['text', 'target_language'],
    },
    execute: async (args) => {
      const result = await Tools.translateContent(args.text, args.target_language, args.source_language || 'auto');
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'translate_content', result } }));
      return result;
    },
  },

  {
    name: 'generate_quiz',
    description:
      'Generate a quiz with multiple-choice questions about the explored topic. Great for testing knowledge retention. Supports different difficulty levels for learners of any age.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic to quiz on.' },
        count:  { type: 'number', description: 'Number of questions (1-10). Default: 5.' },
        difficulty: { type: 'string', description: 'Difficulty: "easy" | "medium" | "hard". Default: "medium".' },
        language: { type: 'string', description: 'Language for the quiz. Default: "en".' },
      },
      required: ['topic'],
    },
    execute: async (args) => {
      const result = await Tools.generateQuiz(args.topic, args.count || 5, args.difficulty || 'medium', args.language || 'en');
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'generate_quiz', result } }));
      return result;
    },
  },

  {
    name: 'summarize',
    description:
      'Create a summary of the explored topic at a specific complexity level. "child" uses simple words for kids, "general" is for everyone, "expert" uses technical terminology.',
    inputSchema: {
      type: 'object',
      properties: {
        topic:    { type: 'string', description: 'Topic to summarize (must have been explored first).' },
        level:    { type: 'string', description: 'Complexity: "child" | "general" | "expert". Default: "general".' },
        language: { type: 'string', description: 'Output language. Default: "en".' },
        max_words:{ type: 'number', description: 'Maximum words in summary. Default: 150.' },
      },
      required: ['topic'],
    },
    execute: async (args) => {
      const result = await Tools.summarize(args.topic, args.level || 'general', args.language || 'en', args.max_words || 150);
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'summarize', result } }));
      return result;
    },
  },

  {
    name: 'ask_question',
    description:
      'Ask a specific question about the current knowledge map. The agent will answer using information from the explored topic. Great for deep-dive Q&A during a learning session.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to answer.' },
        language: { type: 'string', description: 'Answer language. Default: matches the explored topic language.' },
      },
      required: ['question'],
    },
    execute: async (args) => {
      const result = await Tools.askQuestion(args.question, args.language || 'en');
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'ask_question', result } }));
      return result;
    },
  },

  {
    name: 'connect_topics',
    description:
      'Find relationships and connections between two topics. Reveals how concepts are linked, which is impossible to see manually across large knowledge spaces.',
    inputSchema: {
      type: 'object',
      properties: {
        topic_a: { type: 'string', description: 'First topic.' },
        topic_b: { type: 'string', description: 'Second topic to connect to the first.' },
        language: { type: 'string', description: 'Language for results.' },
      },
      required: ['topic_a', 'topic_b'],
    },
    execute: async (args) => {
      const result = await Tools.connectTopics(args.topic_a, args.topic_b, args.language || 'en');
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'connect_topics', result } }));
      return result;
    },
  },

  {
    name: 'export_knowledge',
    description:
      'Export the current knowledge map in different formats. Use "markdown" for documents, "json" for structured data, "flashcards" for Anki-style learning cards, or "outline" for bullet-point notes.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'Export format: "markdown" | "json" | "flashcards" | "outline". Default: "markdown".' },
        include_quiz: { type: 'boolean', description: 'Include quiz questions in export. Default: false.' },
      },
      required: [],
    },
    execute: async (args) => {
      const result = await Tools.exportKnowledge(args.format || 'markdown', args.include_quiz || false);
      window.dispatchEvent(new CustomEvent('lingo:tool-result', { detail: { tool: 'export_knowledge', result } }));
      return result;
    },
  },
];

// ── Register all tools with document.modelContext ───────────────
async function registerTools(modelContext) {
  const badge = document.getElementById('webmcpBadge');
  const status = document.getElementById('webmcpStatus');

  for (const toolDef of TOOL_DEFINITIONS) {
    try {
      await modelContext.registerTool(
        {
          name: toolDef.name,
          description: toolDef.description,
          inputSchema: toolDef.inputSchema,
          execute: async (args) => {
            // Track call in UI
            window.dispatchEvent(new CustomEvent('lingo:tool-called', {
              detail: { tool: toolDef.name, args }
            }));
            try {
              const result = await toolDef.execute(args);
              return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (err) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
            }
          },
        },
        // AbortController signal for clean teardown
        { signal: new AbortController().signal }
      );

      webmcpState.registered++;
      webmcpState.toolNames.push(toolDef.name);
      console.log(`[WebMCP] ✓ Registered: ${toolDef.name}`);
    } catch (err) {
      console.warn(`[WebMCP] Failed to register ${toolDef.name}:`, err.message);
    }
  }

  webmcpState.available = webmcpState.registered > 0;

  if (badge && status) {
    if (webmcpState.available) {
      badge.className = 'webmcp-badge live';
      status.textContent = `WebMCP Live — ${webmcpState.registered} tools`;
    } else {
      badge.className = 'webmcp-badge error';
      status.textContent = 'WebMCP — tools available in-page';
    }
  }

  // Notify UI that tools are registered
  window.dispatchEvent(new CustomEvent('lingo:webmcp-ready', { detail: webmcpState }));
}

// ── Bootstrap: find or polyfill document.modelContext ──────────
async function boot() {
  const badge = document.getElementById('webmcpBadge');
  const status = document.getElementById('webmcpStatus');

  // 1. Check for native document.modelContext (ChatGPT browser, Chrome WebMCP flag)
  if (typeof document !== 'undefined' && 'modelContext' in document) {
    console.log('[WebMCP] Native document.modelContext found.');
    await registerTools(document.modelContext);
    return;
  }

  // 2. Check navigator.modelContext (older spec version)
  if (typeof navigator !== 'undefined' && 'modelContext' in navigator) {
    console.log('[WebMCP] navigator.modelContext found (deprecated path).');
    await registerTools(navigator.modelContext);
    return;
  }

  // 3. Try loading @mcp-b/global polyfill from CDN
  // This enables WebMCP in browsers with the MCP-B extension installed
  console.log('[WebMCP] No native modelContext. Trying polyfill…');
  if (badge && status) {
    status.textContent = 'Loading WebMCP polyfill…';
  }

  try {
    const { initializeWebModelContext } = await import(
      'https://unpkg.com/@mcp-b/global@latest/dist/index.js'
    );
    initializeWebModelContext({
      transport: { tabServer: { allowedOrigins: ['*'] } },
    });
    // Give polyfill a moment to inject document.modelContext
    await new Promise(r => setTimeout(r, 200));

    if ('modelContext' in document) {
      console.log('[WebMCP] Polyfill installed successfully.');
      await registerTools(document.modelContext);
      return;
    }
  } catch (err) {
    console.warn('[WebMCP] Polyfill unavailable:', err.message);
  }

  // 4. Graceful fallback — tools work in-page but not via agent
  console.log('[WebMCP] Running in in-page mode. Tools available via UI only.');
  if (badge && status) {
    badge.className = 'webmcp-badge error';
    status.textContent = 'WebMCP: enable Chrome flag or use ChatGPT browser';
  }

  // Still register tools in our in-page registry for the UI
  window.__lingoTools = TOOL_DEFINITIONS;
  webmcpState.available = false;
  webmcpState.toolNames = TOOL_DEFINITIONS.map(t => t.name);

  window.dispatchEvent(new CustomEvent('lingo:webmcp-ready', { detail: webmcpState }));
}

// Export tool definitions for in-page use (ui.js calls these directly)
export { TOOL_DEFINITIONS };

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
