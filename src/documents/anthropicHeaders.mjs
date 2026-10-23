// The headers every Anthropic request carries. The hosted platform key is not scoped to a workspace, so Anthropic needs `anthropic-workspace-id` on each call (without it: 400 invalid_request_error).
// The header is sent ONLY when ANTHROPIC_WORKSPACE_ID is set AND the key in use is the platform key (ANTHROPIC_API_KEY): a workspace's own key, or a self-host install with neither variable, is untouched.
export function anthropicHeaders(apiKey, env = process.env, version = "2023-06-01") {
  const ws = typeof env.ANTHROPIC_WORKSPACE_ID === "string" ? env.ANTHROPIC_WORKSPACE_ID.trim() : "";
  const platformKey = typeof env.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY.trim() : "";
  return { "x-api-key": apiKey, "anthropic-version": version, "content-type": "application/json", ...(ws && platformKey && apiKey === platformKey ? { "anthropic-workspace-id": ws } : {}) };
}
