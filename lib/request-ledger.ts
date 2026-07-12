export function makeRequestKey(playerId: string, requestId?: string) {
  return requestId ? `${playerId}:${requestId}` : "";
}

export function hasProcessedRequest(recentRequestIds: string[] | undefined, key: string) {
  return !!key && !!recentRequestIds?.includes(key);
}

export function rememberRequest(recentRequestIds: string[] | undefined, key: string, limit = 100) {
  if (!key) return recentRequestIds ?? [];
  if (recentRequestIds?.includes(key)) return recentRequestIds;
  return [...(recentRequestIds ?? []), key].slice(-limit);
}
