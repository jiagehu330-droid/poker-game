import { settleShowdown } from "../lib/poker-server.ts";

const card = (rank, suit = "♠") => ({ rank, label: String(rank), suit, red: suit === "♥" || suit === "♦" });
const players = [
  { id: "a", name: "A", human: true, host: true, level: "困难", chips: 0, folded: false, bet: 0, committed: 1000, lastAction: "全下", role: "" },
  { id: "b", name: "B", human: true, host: false, level: "困难", chips: 0, folded: false, bet: 0, committed: 500, lastAction: "全下", role: "" },
  { id: "c", name: "C", human: true, host: false, level: "困难", chips: 0, folded: false, bet: 0, committed: 200, lastAction: "全下", role: "" },
];
const game = {
  hand: 1, street: "river", players, dealerId: "a", pot: 1700, currentBet: 0, pending: [], log: [], winner: null,
  board: [card(2,"♠"),card(3,"♥"),card(4,"♦"),card(8,"♣"),card(9,"♠")],
  holes: { a: [card(14,"♥"),card(14,"♣")], b: [card(8,"♥"),card(9,"♣")], c: [card(5,"♥"),card(6,"♣")] },
  turnSerial: 0, deadline: Date.now() + 60000, timeBankUsedAt: {},
};
const result = settleShowdown(game);
const chips = Object.fromEntries(result.players.map((player) => [player.id, player.chips]));
if (chips.a !== 500 || chips.b !== 600 || chips.c !== 600) throw new Error(`边池结算错误: ${JSON.stringify(chips)}`);
if (Object.values(chips).reduce((sum, value) => sum + value, 0) !== game.pot) throw new Error("筹码总数不守恒");
console.log(JSON.stringify({ passed: true, chips, log: result.log }));
