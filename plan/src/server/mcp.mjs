/**
 * The same capabilities as MCP tools, over REAL data. Port from
 * ../../server/mcp.mjs - the JSON-RPC plumbing there is already correct and
 * protocol-compliant; only the handlers change.
 *
 * KEEP the transport: POST /mcp, JSON-RPC 2.0, initialize / tools/list /
 * tools/call, protocol version 2025-06-18.
 *
 * REPLACE every handler with a real query:
 *   sessions_list        recent real meetings
 *   session_status       live vitals for a meeting happening right now
 *   observe_stream       real rows since a seq cursor
 *   dataset_query        filter real rows
 *   dataset_export       real JSONL / CSV
 *   session_report       the validated analyst report
 *   experiment_register / experiment_assign / experiment_analyze
 *   skill_list / skill_promote / skill_arm
 *   nudge_host           push a nudge into a live meeting's host channel
 *
 * DELETE these prototype tools - they only made sense against a simulator:
 *   experiment_run (Monte Carlo), roi_portfolio, skill_transfer, surfaces_list
 *
 * Every tool that returns a metric must also return the n it rests on, and null
 * with a reason when n is too small. An agent consuming this API deserves the same
 * honesty as a human reading the console.
 */
