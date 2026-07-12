import test from "node:test";
import assert from "node:assert/strict";
import { isPresenceOnline, shortenedOfflineDeadline } from "../lib/presence.ts";

test("8 秒内有心跳显示在线，超过后显示离线", () => {
  const now = 100000;
  assert.equal(isPresenceOnline(true, now - 7999, now), true);
  assert.equal(isPresenceOnline(true, now - 8000, now), false);
  assert.equal(isPresenceOnline(false, 0, now), true);
});

test("离线玩家的回合最多保留 15 秒", () => {
  const now = 100000;
  assert.equal(shortenedOfflineDeadline(now + 60000, true, now - 9000, now), now + 15000);
  assert.equal(shortenedOfflineDeadline(now + 10000, true, now - 9000, now), now + 10000);
  assert.equal(shortenedOfflineDeadline(now + 60000, true, now - 1000, now), now + 60000);
});
