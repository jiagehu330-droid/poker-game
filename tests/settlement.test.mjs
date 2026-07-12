import test from "node:test";
import assert from "node:assert/strict";
import { createSessionSettlement } from "../lib/settlement.ts";

const roomPlayer = (id, extra = {}) => ({ id, name: id.toUpperCase(), host: id === "a", human: true, chips: 10000, queuedChips: 0, purchasesCount: 0, purchasedChips: 0, ...extra });
const gamePlayer = (id, chips, committed) => ({ id, name: id.toUpperCase(), host: id === "a", human: true, level: "困难", chips, folded: false, bet: committed, committed, lastAction: "", role: "" });

test("中途结束时退回本手投入，并计入尚未生效的补码", () => {
  const players = [roomPlayer("a"), roomPlayer("b", { queuedChips: 5000, purchasesCount: 1, purchasedChips: 5000 })];
  const game = { hand: 3, winner: null, players: [gamePlayer("a", 9000, 1000), gamePlayer("b", 8500, 1500)] };
  const report = createSessionSettlement(players, game, 123);
  assert.equal(report.createdAt, 123); assert.equal(report.hands, 3);
  assert.deepEqual(report.players.map((item) => ({ id:item.id, final:item.finalChips, buys:item.purchasesCount, net:item.netChips })), [
    { id:"a", final:10000, buys:0, net:0 },
    { id:"b", final:15000, buys:1, net:0 },
  ]);
});

test("已完成牌局直接使用结算后的筹码，不重复退回投入", () => {
  const players = [roomPlayer("a"), roomPlayer("b")];
  const game = { hand: 5, winner: "A 获胜", players: [gamePlayer("a", 13000, 1000), gamePlayer("b", 7000, 1000)] };
  const report = createSessionSettlement(players, game, 456);
  assert.deepEqual(report.players.map((item) => item.finalChips), [13000,7000]);
  assert.deepEqual(report.players.map((item) => item.netChips), [3000,-3000]);
});
