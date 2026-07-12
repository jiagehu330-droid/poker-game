import test from "node:test";
import assert from "node:assert/strict";
import { hasProcessedRequest, makeRequestKey, rememberRequest } from "../lib/request-ledger.ts";

test("同一玩家的同一请求只登记一次", () => {
  const key = makeRequestKey("player-a", "request-1");
  let ledger = rememberRequest([], key);
  ledger = rememberRequest(ledger, key);
  assert.deepEqual(ledger, ["player-a:request-1"]);
  assert.equal(hasProcessedRequest(ledger, key), true);
});

test("不同玩家使用相同请求编号不会互相误判", () => {
  const first = makeRequestKey("player-a", "same-id");
  const second = makeRequestKey("player-b", "same-id");
  const ledger = rememberRequest([], first);
  assert.equal(hasProcessedRequest(ledger, second), false);
});

test("请求账本只保留最近 100 条", () => {
  let ledger = [];
  for (let index = 0; index < 140; index += 1) ledger = rememberRequest(ledger, `player:${index}`);
  assert.equal(ledger.length, 100);
  assert.equal(ledger[0], "player:40");
  assert.equal(ledger.at(-1), "player:139");
});
