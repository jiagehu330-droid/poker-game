export const OFFLINE_AFTER_MS = 8000;
export const OFFLINE_TURN_MS = 15000;

export function isPresenceOnline(human: boolean, lastSeen: number, now = Date.now()) {
  return !human || now - lastSeen < OFFLINE_AFTER_MS;
}

export function shortenedOfflineDeadline(deadline: number, human: boolean, lastSeen: number, now = Date.now()) {
  if (isPresenceOnline(human, lastSeen, now)) return deadline;
  return Math.min(deadline, now + OFFLINE_TURN_MS);
}
