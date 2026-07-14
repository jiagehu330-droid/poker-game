"use client";

// Deployment marker: settlement report and explicit suit colors.

import { useEffect, useMemo, useState } from "react";

type Bot = { id: string; name: string; level: "简单" | "困难"; chips: number };
type Stage = "home" | "lobby" | "table";
type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
type Action = "fold" | "check" | "call" | "raise";
type VisualStyle = "classic" | "characters";
type Card = { rank: number; label: string; suit: string; red: boolean };
type Player = Bot & { human: boolean; host: boolean; folded: boolean; bet: number; committed?: number; lastAction: string; role: string; online?: boolean };
type Game = {
  hand: number; street: Street; players: Player[]; dealerId: string; pot: number;
  currentBet: number; pending: string[]; log: string[]; winner: string | null; busy: boolean;
  board: Card[]; holes: Record<string, Card[]>;
  turnSerial: number; deadline?: number; turnSecondsLeft?: number; timeBankUsedAt: Record<string, number>;
};
type OnlinePlayer = { id: string; name: string; human: boolean; host: boolean; level: "简单" | "困难"; chips: number; seated: boolean; queuedChips: number; readyNextHand: boolean; online: boolean };
type Settlement = { createdAt: number; hands: number; players: Array<{ id: string; name: string; host: boolean; human: boolean; finalChips: number; purchasesCount: number; purchasedChips: number; netChips: number }> };
type OnlineRoom = { code: string; phase: "lobby" | "playing"; viewerId: string; isHost: boolean; players: OnlinePlayer[]; updatedAt: number; game?: Game | null; settlement?: Settlement | null };

const HAND_RANKINGS = [
  ["皇家同花顺", "同一花色的 A、K、Q、J、10"], ["同花顺", "同一花色的五张连续牌"],
  ["四条", "四张点数相同的牌"], ["葫芦", "三张相同点数，加一对"],
  ["同花", "五张花色相同，但点数不连续"], ["顺子", "五张点数连续，花色可以不同"],
  ["三条", "三张点数相同的牌"], ["两对", "两组不同点数的对子"],
  ["一对", "两张点数相同的牌"], ["高牌", "无法组成其他牌型时，比较最大单牌"],
] as const;

const BOT_NAMES = ["阿策", "小满", "河牌侠", "老K", "桃子"];
const STREET_NAME: Record<Street, string> = { preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌" };
const HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
const STREET_INDEX: Record<Street, number> = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 4 };

function shuffledDeck(): Card[] {
  const suits = [{ suit: "♠", red: false }, { suit: "♥", red: true }, { suit: "♣", red: false }, { suit: "♦", red: true }];
  const labels: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J" };
  const deck = suits.flatMap(({ suit, red }) => Array.from({ length: 13 }, (_, index) => {
    const rank = index + 2; return { rank, label: labels[rank] ?? String(rank), suit, red };
  }));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1); crypto.getRandomValues(random);
    const swap = random[0] % (index + 1); [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function scoreFive(cards: Card[]) {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = [...new Set(ranks)].map((rank) => ({ rank, count: ranks.filter((item) => item === rank).length })).sort((a, b) => b.count - a.count || b.rank - a.rank);
  const unique = [...new Set(ranks)];
  const straightHigh = unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0] : unique.join(",") === "14,5,4,3,2" ? 5 : 0;
  const flush = cards.every((card) => card.suit === cards[0].suit);
  if (flush && straightHigh) return [8, straightHigh];
  if (counts[0].count === 4) return [7, counts[0].rank, counts[1].rank];
  if (counts[0].count === 3 && counts[1].count === 2) return [6, counts[0].rank, counts[1].rank];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (counts[0].count === 3) return [3, counts[0].rank, ...counts.slice(1).map((item) => item.rank).sort((a, b) => b - a)];
  const pairs = counts.filter((item) => item.count === 2).map((item) => item.rank).sort((a, b) => b - a);
  if (pairs.length === 2) return [2, ...pairs, counts.find((item) => item.count === 1)!.rank];
  if (pairs.length === 1) return [1, pairs[0], ...counts.filter((item) => item.count === 1).map((item) => item.rank).sort((a, b) => b - a)];
  return [0, ...ranks];
}

function bestHand(cards: Card[]) {
  let best: number[] = [];
  for (let a = 0; a < cards.length - 4; a += 1) for (let b = a + 1; b < cards.length - 3; b += 1)
    for (let c = b + 1; c < cards.length - 2; c += 1) for (let d = c + 1; d < cards.length - 1; d += 1)
      for (let e = d + 1; e < cards.length; e += 1) {
        const score = scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
        if (!best.length || compareScore(score, best) > 0) best = score;
      }
  return { score: best, name: HAND_NAMES[best[0]] };
}

function compareScore(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0);
  return 0;
}

function orderedAfter(players: Player[], id: string, includeId = false) {
  const start = players.findIndex((player) => player.id === id);
  const result: string[] = [];
  for (let step = includeId ? 0 : 1; step <= players.length; step += 1) {
    const player = players[(start + step) % players.length];
    if (player && !player.folded && !result.includes(player.id)) result.push(player.id);
    if (result.length === players.filter((item) => !item.folded).length) break;
  }
  return result;
}

function newGame(source: Array<{ id: string; name: string; level: "简单" | "困难"; chips: number; human: boolean; host: boolean }>, hand: number, previousTimeBanks: Record<string, number> = {}): Game {
  const dealerIndex = (hand - 1) % source.length;
  const sbIndex = source.length === 2 ? dealerIndex : (dealerIndex + 1) % source.length;
  const bbIndex = source.length === 2 ? (dealerIndex + 1) % source.length : (dealerIndex + 2) % source.length;
  const players: Player[] = source.map((player, index) => ({
    ...player, folded: false, bet: index === sbIndex ? 50 : index === bbIndex ? 100 : 0,
    lastAction: index === sbIndex ? "小盲 50" : index === bbIndex ? "大盲 100" : "等待",
    role: index === dealerIndex && index === sbIndex ? "D/SB" : index === dealerIndex ? "D" : index === sbIndex ? "SB" : index === bbIndex ? "BB" : "",
    chips: player.chips - (index === sbIndex ? 50 : index === bbIndex ? 100 : 0),
  }));
  const bbId = players[bbIndex].id;
  const deck = shuffledDeck();
  const holes: Record<string, [Card, Card]> = {};
  players.forEach((player) => { holes[player.id] = [deck.shift()!, deck.shift()!]; });
  const board = deck.splice(0, 5);
  return {
    hand, street: "preflop", players, dealerId: players[dealerIndex].id, pot: 150, currentBet: 100,
    pending: orderedAfter(players, bbId), log: [`第 ${hand} 手开始`, `${players[sbIndex].name} 下小盲 50`, `${players[bbIndex].name} 下大盲 100`],
    winner: null, busy: false, board, holes, turnSerial: 0, timeBankUsedAt: previousTimeBanks,
  };
}

function finishHand(game: Game, winnerId: string, reason: string): Game {
  const players = game.players.map((player) => player.id === winnerId
    ? { ...player, chips: player.chips + game.pot, lastAction: `赢得 ${game.pot}` }
    : player);
  const winner = players.find((player) => player.id === winnerId)!;
  return { ...game, players, street: "showdown", pending: [], currentBet: 0, winner: `${winner.name} ${reason}，赢得 ${game.pot.toLocaleString()} 筹码`, log: [...game.log, `${winner.name} ${reason}，赢得底池 ${game.pot}`], busy: false };
}

function finishShowdown(game: Game): Game {
  const contenders = game.players.filter((player) => !player.folded).map((player) => ({ player, hand: bestHand([...game.holes[player.id], ...game.board]) }));
  const best = contenders.reduce((top, entry) => compareScore(entry.hand.score, top.hand.score) > 0 ? entry : top, contenders[0]);
  const winners = contenders.filter((entry) => compareScore(entry.hand.score, best.hand.score) === 0);
  const share = Math.floor(game.pot / winners.length);
  const players = game.players.map((player) => winners.some((entry) => entry.player.id === player.id)
    ? { ...player, chips: player.chips + share, lastAction: `赢得 ${share}` } : player);
  const names = winners.map((entry) => entry.player.name).join("、");
  const result = `${names} 以${best.hand.name}赢得摊牌${winners.length > 1 ? `，平分底池各 ${share}` : `，获得 ${game.pot}`}`;
  return { ...game, players, street: "showdown", pending: [], currentBet: 0, winner: result, log: [...game.log, result], busy: false };
}

function advanceStreet(game: Game): Game {
  const active = game.players.filter((player) => !player.folded);
  if (active.length === 1) return finishHand(game, active[0].id, "成为最后未弃牌玩家");
  if (game.street === "river") return finishShowdown(game);
  const nextStreet: Street = game.street === "preflop" ? "flop" : game.street === "flop" ? "turn" : "river";
  const players = game.players.map((player) => ({ ...player, bet: 0, lastAction: player.folded ? "已弃牌" : "等待" }));
  const pending = orderedAfter(players, game.dealerId);
  return { ...game, street: nextStreet, players, currentBet: 0, pending, log: [...game.log, `进入${STREET_NAME[nextStreet]}圈`], busy: false };
}

function applyAction(game: Game, actorId: string, action: Action, requestedRaiseTo?: number): Game {
  if (game.winner || game.pending[0] !== actorId) return game;
  const actor = game.players.find((player) => player.id === actorId)!;
  const callAmount = Math.max(0, game.currentBet - actor.bet);
  let paid = 0;
  let nextBet = game.currentBet;
  let label = "";
  let resetPending = false;
  const players = game.players.map((player) => {
    if (player.id !== actorId) return player;
    if (action === "fold") { label = "弃牌"; return { ...player, folded: true, lastAction: label }; }
    if (action === "check") { label = "过牌"; return { ...player, lastAction: label }; }
    if (action === "call") {
      paid = Math.min(callAmount, player.chips); label = paid ? `跟注 ${paid}` : "过牌";
      return { ...player, chips: player.chips - paid, bet: player.bet + paid, lastAction: label };
    }
    const minimum = Math.max(game.currentBet + 100, game.currentBet === 0 ? 100 : game.currentBet * 2);
    const raiseTo = Math.min(player.bet + player.chips, Math.max(minimum, requestedRaiseTo ?? minimum));
    paid = Math.min(raiseTo - player.bet, player.chips); nextBet = player.bet + paid; label = `加注至 ${nextBet}`; resetPending = true;
    return { ...player, chips: player.chips - paid, bet: nextBet, lastAction: label };
  });
  let pending = resetPending ? orderedAfter(players, actorId).filter((id) => id !== actorId) : game.pending.slice(1);
  pending = pending.filter((id) => !players.find((player) => player.id === id)?.folded);
  let next: Game = { ...game, players, pot: game.pot + paid, currentBet: nextBet, pending, log: [...game.log, `${actor.name} ${label}`], busy: false, turnSerial: game.turnSerial + 1 };
  if (players.filter((player) => !player.folded).length === 1 || pending.length === 0) next = advanceStreet(next);
  return next;
}

function turnKeyFor(game: Game | null) {
  if (!game || game.winner || !game.pending[0]) return "idle";
  return `${game.hand}-${game.turnSerial}-${game.street}-${game.pending[0]}`;
}

function timeoutAction(game: Game): Game {
  const actorId = game.pending[0];
  const actor = game.players.find((player) => player.id === actorId);
  if (!actor) return game;
  const mustCall = game.currentBet > actor.bet;
  const next = applyAction(game, actorId, mustCall ? "fold" : "check");
  const timeoutLabel = mustCall ? "超时自动弃牌" : "超时自动过牌";
  return { ...next, players: next.players.map((player) => player.id === actorId ? { ...player, lastAction: timeoutLabel } : player), log: [...next.log, `${actor.name} ${timeoutLabel}`] };
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("home");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [roomToken, setRoomToken] = useState("");
  const [onlineRoom, setOnlineRoom] = useState<OnlineRoom | null>(null);
  const [onlineError, setOnlineError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [dismissedSettlementAt, setDismissedSettlementAt] = useState<number | null>(null);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [gameMenuTab, setGameMenuTab] = useState<"shop" | "rules">("shop");
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("classic");
  const [bots, setBots] = useState<Bot[]>([]);
  const [botLevel, setBotLevel] = useState<"简单" | "困难">("简单");
  const [copied, setCopied] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  const [raiseAmount, setRaiseAmount] = useState(200);
  const [turnClock, setTurnClock] = useState({ key: "idle", seconds: 60 });

  const seats = useMemo(() => onlineRoom ? onlineRoom.players.map((player) => ({ ...player, id: player.id === onlineRoom.viewerId ? "you" : player.id })) : [
    { id: "you", name: "玩家", chips: 10000, human: true, host: true, level: "困难" as const }, ...bots.map((bot) => ({ ...bot, human: false, host: false })),
  ], [bots, onlineRoom]);

  const actor = game?.players.find((player) => player.id === game.pending[0]);
  const actorId = actor?.id;
  const actorHuman = actor?.human ?? false;
  const actorLevel = actor?.level;
  const isHeroTurn = actorId === "you";
  const isOnline = !!onlineRoom;
  const turnKey = turnKeyFor(game);
  const secondsLeft = turnClock.key === turnKey ? turnClock.seconds : 60;
  const hero = game?.players.find((player) => player.id === "you");
  const onlineViewer = onlineRoom?.players.find((player) => player.id === onlineRoom.viewerId);
  const isSpectator = !!onlineRoom && onlineViewer?.seated === false;
  const callAmount = game && hero ? Math.max(0, game.currentBet - hero.bet) : 0;
  const minimumRaise = game ? Math.max(game.currentBet + 100, game.currentBet === 0 ? 100 : game.currentBet * 2) : 100;
  const maximumRaise = hero ? hero.bet + hero.chips : minimumRaise;
  const clampedRaise = Math.min(maximumRaise, Math.max(minimumRaise, raiseAmount));
  const halfPotRaise = game ? Math.min(maximumRaise, Math.max(minimumRaise, game.currentBet + callAmount + Math.round(game.pot / 100) * 50)) : minimumRaise;
  const potRaise = game ? Math.min(maximumRaise, Math.max(minimumRaise, game.currentBet + callAmount + Math.round(game.pot / 50) * 50)) : minimumRaise;
  const visibleCards = !game ? 0 : game.street === "preflop" ? 0 : game.street === "flop" ? 3 : game.street === "turn" ? 4 : 5;
  const currentRound = game ? (game.hand - 1) * 4 + STREET_INDEX[game.street] : 0;
  const timeBankReady = !!game && currentRound - (game.timeBankUsedAt.you ?? -99) >= 2;

  useEffect(() => {
    const savedStyle = window.localStorage.getItem("pocket-poker-visual-style");
    if (savedStyle === "classic" || savedStyle === "characters") setVisualStyle(savedStyle);
  }, []);

  function changeVisualStyle(style: VisualStyle) {
    setVisualStyle(style);
    window.localStorage.setItem("pocket-poker-visual-style", style);
  }

  useEffect(() => {
    if (onlineRoom || !actorId || actorHuman || game?.winner) return;
    const timer = window.setTimeout(() => {
      setGame((current) => {
        if (!current || current.pending[0] !== actorId) return current;
        const currentActor = current.players.find((player) => player.id === actorId)!;
        const toCall = current.currentBet - currentActor.bet;
        const shouldFold = toCall >= 400 && currentActor.level === "简单" && (current.hand + current.players.indexOf(currentActor)) % 3 === 0;
        return applyAction(current, actorId, shouldFold ? "fold" : toCall > 0 ? "call" : "check");
      });
    }, actorLevel === "困难" ? 650 : 900);
    return () => window.clearTimeout(timer);
  }, [actorId, actorHuman, actorLevel, game?.winner, turnKey, onlineRoom]);

  useEffect(() => {
    if (turnKey === "idle") return;
    const syncClock = () => {
      if (isOnline && game?.turnSecondsLeft !== undefined) {
        setTurnClock({ key: turnKey, seconds: game.turnSecondsLeft });
        return;
      }
      setTurnClock((current) => ({ key: turnKey, seconds: Math.max(0, (current.key === turnKey ? current.seconds : 60) - 1) }));
    };
    syncClock();
    const interval = window.setInterval(() => {
      syncClock();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [turnKey, game?.turnSecondsLeft, isOnline]);

  useEffect(() => {
    if (onlineRoom || turnKey === "idle" || secondsLeft > 0) return;
    const fallback = window.setTimeout(() => {
      setGame((current) => current && turnKeyFor(current) === turnKey ? timeoutAction(current) : current);
    }, 0);
    return () => window.clearTimeout(fallback);
  }, [secondsLeft, turnKey, onlineRoom]);

  useEffect(() => {
    if (!roomCode || !roomToken) return;
    const sync = async () => {
      try {
        const response = await fetch(`/api/rooms?code=${roomCode}&token=${encodeURIComponent(roomToken)}`, { cache: "no-store" });
        if (response.status === 403 || response.status === 404) {
          window.localStorage.removeItem("pocket-poker-session");
          setOnlineRoom(null); setGame(null); setRoomCode(""); setRoomToken(""); setStage("home");
          setOnlineError("你已离开该房间");
          return;
        }
        if (response.ok) {
          const next = (await response.json()).room as OnlineRoom;
          setOnlineRoom(next);
          if (next.game) { setGame(next.game); setStage("table"); }
          else if (next.phase === "lobby") { setGame(null); setStage("lobby"); }
        }
      } catch { /* 下一次轮询自动重试 */ }
    };
    void sync();
    const interval = window.setInterval(sync, 500);
    return () => window.clearInterval(interval);
  }, [stage, roomCode, roomToken]);

  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
    if (queryCode) window.setTimeout(() => setJoinCode(queryCode), 0);
    const saved = window.localStorage.getItem("pocket-poker-session");
    if (!saved) return;
    let session: { code: string; token: string };
    try { session = JSON.parse(saved) as { code: string; token: string }; } catch { return; }
    if (queryCode && queryCode !== session.code) return;
    void fetch(`/api/rooms?code=${session.code}&token=${encodeURIComponent(session.token)}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      setRoomCode(session.code); setRoomToken(session.token); setOnlineRoom(result.room); setStage("lobby");
    }).catch(() => undefined);
  }, []);

  async function roomRequest(payload: Record<string, unknown>) {
    setOnlineError("");
    const response = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, requestId: crypto.randomUUID() }) });
    const result = await response.json();
    if (!response.ok && result.room) {
      const latest = result.room as OnlineRoom;
      setOnlineRoom(latest);
      if (latest.game) { setGame(latest.game); setStage("table"); }
      else if (latest.phase === "lobby") { setGame(null); setStage("lobby"); }
    }
    if (!response.ok) throw new Error(result.error ?? "房间操作失败");
    return result as { token?: string; room: OnlineRoom };
  }

  async function createOnlineRoom() {
    try {
      const result = await roomRequest({ action: "create", name: nickname });
      setRoomCode(result.room.code); setRoomToken(result.token ?? ""); setOnlineRoom(result.room); setStage("lobby");
      window.localStorage.setItem("pocket-poker-session", JSON.stringify({ code: result.room.code, token: result.token }));
    } catch (error) { setOnlineError(error instanceof Error ? error.message : "创建失败"); }
  }

  async function joinOnlineRoom() {
    try {
      const result = await roomRequest({ action: "join", code: joinCode.trim().toUpperCase(), name: nickname });
      setRoomCode(result.room.code); setRoomToken(result.token ?? ""); setOnlineRoom(result.room); setStage("lobby");
      window.localStorage.setItem("pocket-poker-session", JSON.stringify({ code: result.room.code, token: result.token }));
    } catch (error) { setOnlineError(error instanceof Error ? error.message : "加入失败"); }
  }

  async function updateNickname() {
    if (!onlineRoom) return;
    try { const result = await roomRequest({ action: "updateName", code: roomCode, token: roomToken, name: nickname }); setOnlineRoom(result.room); }
    catch (error) { setOnlineError(error instanceof Error ? error.message : "修改失败"); }
  }

  async function addBot() {
    if (onlineRoom) {
      try { const result = await roomRequest({ action: "addBot", code: roomCode, token: roomToken, level: botLevel }); setOnlineRoom(result.room); }
      catch (error) { setOnlineError(error instanceof Error ? error.message : "添加失败"); }
      return;
    }
    if (bots.length >= 5) return;
    setBots((current) => [...current, { id: `bot-${Date.now()}`, name: BOT_NAMES[current.length], level: botLevel, chips: 10000 }]);
  }

  async function removeSeat(playerId: string) {
    if (onlineRoom) {
      try { const result = await roomRequest({ action: "removePlayer", code: roomCode, token: roomToken, playerId }); setOnlineRoom(result.room); }
      catch (error) { setOnlineError(error instanceof Error ? error.message : "移除失败"); }
    } else setBots(bots.filter((bot) => bot.id !== playerId));
  }

  async function endOnlineGame() {
    if (!onlineRoom?.isHost || !window.confirm("结束当前牌局，让所有玩家返回大厅？")) return;
    if (actionPending) return;
    setActionPending(true);
    try {
      const result = await roomRequest({ action: "endGame", code: roomCode, token: roomToken });
      setOnlineRoom(result.room); setGame(null); setStage("lobby");
    } catch (error) { setOnlineError(error instanceof Error ? error.message : "结束牌局失败"); }
    finally { setActionPending(false); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(`${window.location.origin}?room=${roomCode}`); } catch { /* local preview */ }
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }

  async function startGame(hand = 1, source = seats) {
    if (onlineRoom) {
      try { const result = await roomRequest({ action: "start", code: roomCode, token: roomToken }); setOnlineRoom(result.room); if (result.room.game) { setGame(result.room.game); setStage("table"); } }
      catch (error) { setOnlineError(error instanceof Error ? error.message : "开局失败"); }
      return;
    }
    setGame(newGame(source, hand)); setStage("table");
  }

  async function heroAction(action: Action, target?: number) {
    if (onlineRoom) {
      if (actionPending) return;
      setActionPending(true);
      try { const result = await roomRequest({ action: "gameAction", code: roomCode, token: roomToken, gameAction: action, raiseTo: target }); setOnlineRoom(result.room); if (result.room.game) setGame(result.room.game); }
      catch (error) { setOnlineError(error instanceof Error ? error.message : "行动失败"); }
      finally { setActionPending(false); }
      return;
    }
    setGame((current) => current ? applyAction(current, "you", action, target) : current);
  }

  async function nextHand() {
    if (!game) return;
    if (onlineRoom) {
      try { const result = await roomRequest({ action: "nextHand", code: roomCode, token: roomToken }); setOnlineRoom(result.room); if (result.room.game) setGame(result.room.game); }
      catch (error) { setOnlineError(error instanceof Error ? error.message : "下一手失败"); }
      return;
    }
    const source = game.players.map(({ id, name, level, chips, human, host }) => ({ id, name, level, chips, human, host }));
    setGame(newGame(source, game.hand + 1, game.timeBankUsedAt));
  }

  async function addTime() {
    if (!game || !isHeroTurn || !timeBankReady) return;
    if (onlineRoom) {
      try { const result = await roomRequest({ action: "extendTime", code: roomCode, token: roomToken }); setOnlineRoom(result.room); if (result.room.game) setGame(result.room.game); }
      catch (error) { setOnlineError(error instanceof Error ? error.message : "加时失败"); }
      return;
    }
    setTurnClock((current) => ({ key: turnKey, seconds: (current.key === turnKey ? current.seconds : 60) + 20 }));
    setGame((current) => current ? { ...current, timeBankUsedAt: { ...current.timeBankUsedAt, you: currentRound }, log: [...current.log, "房主 · 你 使用时间卡 +20 秒"] } : current);
  }

  async function buyChips(amount: number) {
    if (!onlineRoom || actionPending) return;
    setActionPending(true);
    try { const result = await roomRequest({ action: "buyChips", code: roomCode, token: roomToken, buyIn: amount }); setOnlineRoom(result.room); }
    catch (error) { setOnlineError(error instanceof Error ? error.message : "购买筹码失败"); }
    finally { setActionPending(false); }
  }

  async function enterNextHand() {
    if (!onlineRoom || actionPending) return;
    setActionPending(true);
    try { const result = await roomRequest({ action: "enterNextHand", code: roomCode, token: roomToken }); setOnlineRoom(result.room); }
    catch (error) { setOnlineError(error instanceof Error ? error.message : "进场失败"); }
    finally { setActionPending(false); }
  }

  return (
    <main className={`app-shell stage-${stage} ${stage === "table" ? `visual-shell-${visualStyle}` : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setStage("home")} aria-label="返回首页"><span className="brand-mark">♠</span><span>口袋牌局</span></button>
        {stage !== "home" && <span className="room-pill">房间 {roomCode}</span>}
        {stage === "table" && game && visualStyle === "characters" && <>
          <div className="cinema-status">
            <span>第 <b>{game.hand}</b> 手</span><i />
            <span>{STREET_NAME[game.street]}</span><i />
            {!game.winner && <span className={`cinema-clock ${secondsLeft <= 10 ? "urgent" : ""}`}>◷ <b>{secondsLeft}s</b></span>}
            <span className="cinema-pot">底池 <b>{game.pot.toLocaleString()}</b></span>
          </div>
          <div className="cinema-actions">
            <button className="game-menu-button" onClick={() => setGameMenuOpen(true)}>☰ 菜单⌄</button>
            <div className="cinema-wallet"><strong>◉ {(onlineViewer?.queuedChips ?? 0).toLocaleString()}</strong><small><i />{onlineViewer?.readyNextHand ? "下一手已申请" : "下一手补码"}</small></div>
            {onlineRoom ? (onlineRoom.isHost ? <button className="end-game" onClick={endOnlineGame} disabled={actionPending}>结束牌局 / 大厅</button> : <small>房主可结束牌局</small>) : <button onClick={() => setStage("lobby")}>返回房间</button>}
          </div>
        </>}
      </header>

      {stage === "home" && <section className="home-card">
        <div className="eyebrow">PRIVATE TEXAS HOLD’EM</div><h1>今晚，<br />开一桌。</h1>
        <p>建个好友房，发链接叫人。人数不够，就让人机补位。</p>
        <input className="nickname-input" aria-label="昵称" value={nickname} maxLength={12} onChange={(event) => setNickname(event.target.value)} placeholder="你的昵称" />
        <button className="primary jumbo" onClick={createOnlineRoom}>创建联机好友房 <span>→</span></button>
        <div className="join-row"><input aria-label="房间码" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="输入 6 位房间码" maxLength={6} /><button onClick={joinOnlineRoom}>加入</button></div>
        {onlineError && <p className="online-error">{onlineError}</p>}
        <div className="feature-line"><span>无需注册</span><i /><span>最多 6 人</span><i /><span>好友专属</span></div>
      </section>}

      {stage === "lobby" && <section className="lobby-wrap">
        <div className="section-head"><div><span className="eyebrow">WAITING ROOM</span><h1>等朋友上桌</h1></div><button className="invite" onClick={copyInvite}>{copied ? "已复制 ✓" : "复制邀请链接"}</button></div>
        {onlineRoom && <div className="nickname-editor"><label>我的昵称</label><input value={nickname} maxLength={12} onChange={(event) => setNickname(event.target.value)} /><button onClick={updateNickname}>保存</button></div>}
        {onlineError && <p className="online-error">{onlineError}</p>}
        <div className="lobby-grid">
          <div className="seats-card"><div className="card-title"><span>座位</span><small>{seats.length} / 6</small></div>
            {seats.map((seat, index) => <div className="player-row" key={seat.id}>
              <div className={`avatar avatar-${index} ${seat.online === false ? "offline" : ""}`}>{seat.human ? "人" : "AI"}</div><div className="player-copy"><strong>{seat.name}{seat.host && <i className="identity-tag host-tag">房主</i>}{seat.id === "you" && <i className="identity-tag self-tag">你</i>}</strong><small>{seat.human ? seat.online === false ? "离线" : "在线" : `${seat.level}人机`}</small></div>
              <span className="chips">{seat.chips.toLocaleString()}</span>{((onlineRoom?.isHost && seat.id !== "you") || (!onlineRoom && !seat.human)) && <button className="remove" onClick={() => removeSeat(seat.id)}>{seat.human ? "移出" : "移除"}</button>}
            </div>)}
            {Array.from({ length: 6 - seats.length }).map((_, index) => <div className="empty-seat" key={index}><span>+</span>等待玩家加入</div>)}
          </div>
          <aside className="setup-card"><div className="card-title"><span>房间设置</span></div>
            <div className="setting"><span>初始筹码</span><strong>10,000</strong></div><div className="setting"><span>盲注</span><strong>50 / 100</strong></div><div className="setting"><span>行动方式</span><strong>依次行动</strong></div><div className="divider" />
            <label>添加人机</label><div className="segment">{(["简单", "困难"] as const).map((level) => <button key={level} className={botLevel === level ? "active" : ""} onClick={() => setBotLevel(level)}>{level}</button>)}</div>
            <button className="secondary" onClick={addBot} disabled={seats.length >= 6 || (!!onlineRoom && !onlineRoom.isHost)}>＋ 添加{botLevel}人机</button>
          </aside>
        </div>
        <button className="primary start" onClick={() => startGame()} disabled={seats.length < 2 || (!!onlineRoom && !onlineRoom.isHost)}>开始联机牌局 <span>{seats.length} 人</span></button>
        {seats.length < 2 && <p className="hint">至少添加一位人机后才能开始</p>}
        {onlineRoom && <p className="sync-note">座位与牌局均由服务端实时同步</p>}
      </section>}

      {stage === "lobby" && onlineRoom?.settlement && dismissedSettlementAt !== onlineRoom.settlement.createdAt && <div className="settlement-backdrop"><section className="settlement-sheet"><div className="settlement-head"><div><span className="eyebrow">SESSION REPORT</span><h2>本场结算单</h2><p>共进行 {onlineRoom.settlement.hands} 手</p></div><button onClick={() => setDismissedSettlementAt(onlineRoom.settlement!.createdAt)}>关闭</button></div><div className="settlement-table"><div className="settlement-row heading"><span>玩家</span><span>最终筹码</span><span>补码</span><span>净输赢</span></div>{onlineRoom.settlement.players.map((player) => <div className="settlement-row" key={player.id}><strong>{player.name}{player.host ? " · 房主" : ""}{!player.human ? " · AI" : ""}</strong><span>{player.finalChips.toLocaleString()}</span><span>{player.purchasesCount} 次 / {player.purchasedChips.toLocaleString()}</span><b className={player.netChips >= 0 ? "profit" : "loss"}>{player.netChips >= 0 ? "+" : ""}{player.netChips.toLocaleString()}</b></div>)}</div><small>净输赢 = 最终筹码 − 初始 10,000 − 累计补码</small></section></div>}

      {stage === "table" && game && <section className={`table-screen visual-${visualStyle}`}>
        <div className="table-meta"><span>第 {game.hand} 手 · {STREET_NAME[game.street]}</span><div className="table-meta-actions"><button className="game-menu-button" onClick={() => setGameMenuOpen(true)}>局内菜单</button>{onlineRoom ? (onlineRoom.isHost ? <button className="end-game" onClick={endOnlineGame} disabled={actionPending}>结束牌局并返回大厅</button> : <small>房主可结束牌局</small>) : <button onClick={() => setStage("lobby")}>返回房间</button>}</div></div>
        <div className="round-strip"><span className="live-dot" />{game.winner ? game.winner : actor ? `${actor.name} 正在行动` : "正在推进牌局"}
          {!game.winner && <div className={`turn-timer ${secondsLeft <= 10 ? "urgent" : ""}`}><div><i style={{ width: `${Math.min(100, secondsLeft / 60 * 100)}%` }} /></div><b>{secondsLeft}s</b></div>}
          <small>底池 {game.pot.toLocaleString()}</small></div>
        <div className="table-layout">
          <div className="poker-table">
            {game.players.filter((player) => player.id !== "you").map((player, index) => <div className={`table-player seat-${index + 1} ${actor?.id === player.id ? "acting" : ""} ${player.folded ? "folded" : ""} ${player.online === false ? "offline-player" : ""}`} key={player.id}>
              <div className={`character-portrait character-${index % 5}`} aria-hidden="true" />
              {player.role && <span className={`role role-${player.role.includes("BB") ? "bb" : player.role.includes("SB") ? "sb" : "d"}`}>{player.role}</span>}<div className={`mini-avatar ${player.online === false ? "offline" : ""}`}>{player.human ? "友" : "AI"}</div><strong>{player.name}{player.host && <i className="identity-tag host-tag">房主</i>}</strong><small>{player.online === false ? "离线" : player.chips.toLocaleString()}</small>
              <span className="last-action">{player.lastAction}</span>{!player.folded && (game.street === "showdown"
                ? <div className="revealed-cards">{game.holes[player.id].map((card, cardIndex) => <b className={card.red ? "red-card" : "black-card"} key={cardIndex}>{card.label}<span className={card.red ? "red-suit" : "black-suit"}>{card.suit}</span></b>)}</div>
                : <div className="card-backs"><i /><i /></div>)}
            </div>)}
            <div className="pot"><small>底池</small><strong>{game.pot.toLocaleString()}</strong></div>
            <div className="community">{game.board.map((card, index) => index < visibleCards
              ? <b key={index} className={card.red ? "red" : ""}>{card.label}<span>{card.suit}</span></b>
              : <em key={index} />)}</div>
            {hero ? <div className={`hero-seat ${isHeroTurn ? "acting" : ""} ${hero.folded ? "folded" : ""}`}>
              {hero?.role && <span className={`role role-${hero.role.includes("BB") ? "bb" : hero.role.includes("SB") ? "sb" : "d"}`}>{hero.role}</span>}
              <div className="hero-info"><strong>{hero?.name}{hero?.host && <i className="identity-tag host-tag">房主</i>}<i className="identity-tag self-tag">你</i></strong><small>{hero?.chips.toLocaleString()}</small><span>{hero?.lastAction}</span></div>
              {!hero?.folded && game.holes.you.map((card, index) => <div className={`hole-card ${card.red ? "red-card" : "black-card"}`} key={index}>{card.label}<span className={card.red ? "red-suit" : "black-suit"}>{card.suit}</span></div>)}
            </div> : <div className="hero-seat spectator-seat"><div className="hero-info"><strong>观战席</strong><span>等待下一手进场</span></div></div>}
          </div>
          <aside className="hand-log" aria-label="鏈墜琛屽姩">
            <span className="crt-rods" aria-hidden="true"><i /><i /></span>
            <div className="crt-face">
              <div className="crt-glass">{game.log.slice(-9).map((line, index) => <p key={`${line}-${index}`}><span>{index + 1}</span>{line}</p>)}</div>
              <span className="crt-controls" aria-hidden="true"><i /><i /><i /></span>
            </div>
            <span className="crt-side" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </aside>
        </div>
        <div className="action-panel">
          {game.winner ? <><p className="result-text">{game.winner}</p><button className="primary next-round" onClick={nextHand} disabled={!!onlineRoom && !onlineRoom.isHost}>{onlineRoom && !onlineRoom.isHost ? "等待房主开始下一手" : `开始第 ${game.hand + 1} 手 →`}</button></>
          : isHeroTurn ? <><div className="turn-prompt"><p>{actionPending ? "正在提交操作…" : callAmount > 0 ? `轮到你 · 需跟注 ${callAmount}` : "轮到你 · 可以过牌"}</p><button className="time-bank" onClick={addTime} disabled={!timeBankReady || actionPending}>{timeBankReady ? "+20秒" : "时间卡冷却中"}</button></div><div className="bet-controls">
            <div className="quick-bets">
              <button onClick={() => setRaiseAmount(halfPotRaise)}>半池 <strong>{halfPotRaise}</strong></button>
              <button onClick={() => setRaiseAmount(potRaise)}>满池 <strong>{potRaise}</strong></button>
              <button onClick={() => setRaiseAmount(maximumRaise)}>全下 <strong>{maximumRaise}</strong></button>
            </div>
            <label className="raise-slider"><span>加注到</span><input aria-label="加注金额" type="range" min={Math.min(minimumRaise, maximumRaise)} max={maximumRaise} step={50} value={clampedRaise} onChange={(event) => setRaiseAmount(Number(event.target.value))} /><output>{clampedRaise.toLocaleString()}</output></label>
          </div><div className="actions">
            <button className="fold" disabled={actionPending} onClick={() => heroAction("fold")}>弃牌</button>
            <button disabled={actionPending} onClick={() => heroAction(callAmount ? "call" : "check")}>{callAmount ? "跟注" : "过牌"}<strong>{callAmount || "无需下注"}</strong></button>
            <button className="raise" onClick={() => heroAction("raise", clampedRaise)} disabled={actionPending || maximumRaise <= game.currentBet}>加注<strong>到 {clampedRaise.toLocaleString()}</strong></button>
          </div></>
          : <p className="thinking">{actor?.name ?? "系统"} 正在思考，牌局会自动继续…</p>}
          {onlineError && <p className="table-error">{onlineError}</p>}
        </div>
      </section>}

      {stage === "table" && gameMenuOpen && <div className="game-menu-backdrop">
        <section className="game-menu">
          <div className="game-menu-head"><h2>局内菜单</h2><button onClick={() => setGameMenuOpen(false)}>关闭</button></div>
          <div className="visual-style-picker">
            <div><span>牌桌风格</span><small>只影响你自己的显示，不影响其他玩家和牌局进度。</small></div>
            <div className="visual-style-options">
              <button className={visualStyle === "classic" ? "active" : ""} onClick={() => changeVisualStyle("classic")}><i className="classic-preview" /><strong>经典牌桌</strong><small>信息最清晰</small></button>
              <button className={visualStyle === "characters" ? "active" : ""} onClick={() => changeVisualStyle("characters")}><i className="character-preview" /><strong>角色牌桌</strong><small>静止 MAD 风格</small></button>
            </div>
          </div>
          <div className="game-menu-tabs"><button className={gameMenuTab === "shop" ? "active" : ""} onClick={() => setGameMenuTab("shop")}>补码商店</button><button className={gameMenuTab === "rules" ? "active" : ""} onClick={() => setGameMenuTab("rules")}>新手规则</button></div>
          {gameMenuTab === "shop" ? <div className="menu-shop"><h3>补码商店</h3><p>购买的筹码只在下一手生效，不会改变当前手筹码。</p>{onlineRoom ? <>{(onlineViewer?.queuedChips ?? 0) > 0 && <strong>已预购：{onlineViewer?.queuedChips.toLocaleString()} 筹码</strong>}<div>{[5000, 10000, 20000].map((amount) => <button key={amount} onClick={() => buyChips(amount)} disabled={actionPending}>＋{amount.toLocaleString()}</button>)}</div>{isSpectator && <button className="menu-enter" onClick={enterNextHand} disabled={!onlineViewer?.queuedChips || onlineViewer?.readyNextHand || actionPending}>{onlineViewer?.readyNextHand ? "已申请入局，等待下一手" : "申请下一手入局"}</button>}</> : <small>单机牌局不使用补码商店。</small>}</div> : <div className="rules-content"><h3>德州扑克简单规则</h3><p>每人会拿到两张只有自己能看到的手牌。牌桌再依次发出五张公共牌，从这七张牌中选出最强的五张组成最终牌型。</p><div className="rule-rounds"><span><b>翻牌前</b>拿到两张手牌</span><span><b>翻牌</b>发出三张公共牌</span><span><b>转牌</b>发出第四张公共牌</span><span><b>河牌</b>发出第五张公共牌</span></div><p><b>过牌</b>是不下注继续；<b>跟注</b>是补到当前金额；<b>加注</b>是提高金额；<b>弃牌</b>是放弃本手；<b>全下</b>是投入全部剩余筹码。</p><p>其他玩家全部弃牌时，最后未弃牌者直接获胜。多人坚持到最后则摊牌，牌型最大者赢得底池；牌型相同则平分。</p><h3>牌型大小</h3><div className="hand-rankings">{HAND_RANKINGS.map(([name, description], index) => <div key={name}><i>{index + 1}</i><strong>{name}</strong><span>{description}</span></div>)}</div><small>牌型从上到下、由大到小。同类牌型先比较主要点数，再比较剩余较大的单牌。</small></div>}
        </section>
      </div>}
    </main>
  );
}
