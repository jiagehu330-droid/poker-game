import test from "node:test";
import assert from "node:assert/strict";
import { applyPresenceTimestamps, isPresenceOnline, shortenedOfflineDeadline } from "../lib/presence.ts";

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

test("刷新在线状态时保留玩家对象引用，后续补码能写回房间", () => {
  const player = { id: "a", human: true, lastSeen: 0, queuedChips: 0, readyNextHand: false };
  const players = [player];
  const result = applyPresenceTimestamps(players, new Map([["a", 12345]]), 20000);
  assert.equal(result, players); assert.equal(result[0], player); assert.equal(player.lastSeen, 12345);
  player.queuedChips += 5000; player.readyNextHand = true;
  assert.equal(players[0].queuedChips, 5000); assert.equal(players[0].readyNextHand, true);
});
