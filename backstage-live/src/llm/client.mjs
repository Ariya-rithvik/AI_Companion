/**
 * The Anthropic client. Every LLM call in this project goes through here so that
 * retries, caching, cost accounting and logging exist in exactly one place.
 *
 * BUILD:
 *  - import Anthropic from '@anthropic-ai/sdk'
 *  - export async function ask({ model, system, messages, tools, maxTokens, sessionId })
 *      * pass system as an array block with { cache_control: { type: 'ephemeral' } }
 *        so the observer's repeated preamble is cached — this is the single biggest
 *        cost lever in the project
 *      * retry on 429 and 5xx with exponential backoff + jitter, max 3 attempts
 *      * on final failure, write a companion.error row and return null. The meeting
 *        must not break because the API had a bad minute
 *      * record usage.input_tokens / output_tokens / cache_read_input_tokens into
 *        ObsSession.costs.llm_usd using current per-model prices
 *  - export askStructured({ ...same, schema }) -> forces a tool call with the given
 *    JSON schema and returns the parsed object. Do not parse JSON out of prose;
 *    use tool calling, it is what makes the output reliably machine-readable.
 *  - export a MODELS map from config so callers never hardcode a model id
 *
 * DO NOT put prompt text in this file. Prompts live in prompts/*.md .
 */
