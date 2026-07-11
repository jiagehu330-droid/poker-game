import { eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { pokerRooms } from "../../../db/schema";
import { extendServerTime, publicServerGame, runServerAutomation, serverAction, startServerGame, type GameAction, type ServerGame } from "../../../lib/poker-server";

type RoomPlayer = { id: string; token: string; name: string; human: boolean; host: boolean; level: "简单" | "困难"; chips: number; seated: boolean; queuedChips: number; readyNextHand: boolean };
type RoomState = { code: string; phase: "lobby" | "playing"; players: RoomPlayer[]; updatedAt: number; game?: ServerGame };

async function ensureRoomsTable() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poker_rooms (
    code TEXT PRIMARY KEY NOT NULL,
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function publicRoom(room: RoomState, token: string) {
  const viewer = room.players.find((player) => player.token === token);
  return {
    code: room.code,
    phase: room.phase,
    viewerId: viewer?.id ?? null,
    isHost: viewer?.host ?? false,
    players: room.players.map((player) => ({ id: player.id, name: player.name, human: player.human, host: player.host, level: player.level, chips: player.chips, seated: player.seated, queuedChips: player.queuedChips, readyNextHand: player.readyNextHand })),
    game: room.game && viewer ? publicServerGame(room.game, viewer.id) : null,
    updatedAt: room.updatedAt,
  };
}

async function findRoom(code: string) {
  const [row] = await getDb().select().from(pokerRooms).where(eq(pokerRooms.code, code)).limit(1);
  if (!row) return null;
  const state = JSON.parse(row.stateJson) as RoomState;
  state.players = state.players.map((player) => ({ ...player, seated: player.seated ?? player.chips > 0, queuedChips: player.queuedChips ?? 0, readyNextHand: player.readyNextHand ?? false }));
  if (state.game) state.game.players = state.game.players.map((player) => ({ ...player, committed: player.committed ?? player.bet ?? 0 }));
  return { row, state };
}

function syncSettledPlayers(room: RoomState) {
  if (!room.game?.winner) return;
  const chips = new Map(room.game.players.map((player) => [player.id, player.chips]));
  room.players = room.players.map((player) => {
    if (!chips.has(player.id)) return player;
    const nextChips = chips.get(player.id)!;
    if (!player.human && nextChips === 0) return { ...player, chips: 0, seated: false, queuedChips: 10000, readyNextHand: true };
    return { ...player, chips: nextChips, seated: nextChips > 0 };
  });
}

async function saveRoom(room: RoomState) {
  room.updatedAt = Date.now();
  await getDb().update(pokerRooms).set({ stateJson: JSON.stringify(room), revision: sql`${pokerRooms.revision} + 1`, updatedAt: new Date().toISOString() }).where(eq(pokerRooms.code, room.code));
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(6); crypto.getRandomValues(values);
  return [...values].map((value) => chars[value % chars.length]).join("");
}

export async function GET(request: Request) {
  await ensureRoomsTable();
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").toUpperCase();
  const token = url.searchParams.get("token") ?? "";
  const found = await findRoom(code);
  if (!found || !found.state.players.some((player) => player.token === token)) return Response.json({ error: "房间不存在或身份已失效" }, { status: 404 });
  const before = found.state.game?.turnSerial;
  if (found.state.game) { found.state.game = runServerAutomation(found.state.game); syncSettledPlayers(found.state); }
  if (found.state.game?.turnSerial !== before) await saveRoom(found.state);
  return Response.json({ room: publicRoom(found.state, token) }, { headers: { "cache-control": "no-store, no-cache, must-revalidate" } });
}

export async function POST(request: Request) {
  await ensureRoomsTable();
  const payload = await request.json() as { action?: string; code?: string; token?: string; name?: string; level?: "简单" | "困难"; playerId?: string; gameAction?: GameAction; raiseTo?: number; buyIn?: number };
  const action = payload.action ?? "";
  if (action === "create") {
    const name = payload.name?.trim().slice(0, 12) ?? "";
    if (!name) return Response.json({ error: "请先填写昵称" }, { status: 400 });
    let code = roomCode();
    while (await findRoom(code)) code = roomCode();
    const token = crypto.randomUUID();
    const room: RoomState = { code, phase: "lobby", updatedAt: Date.now(), players: [{ id: crypto.randomUUID(), token, name, human: true, host: true, level: "困难", chips: 10000, seated: true, queuedChips: 0, readyNextHand: false }] };
    await getDb().insert(pokerRooms).values({ code, stateJson: JSON.stringify(room) });
    return Response.json({ token, room: publicRoom(room, token) }, { status: 201 });
  }

  const code = (payload.code ?? "").toUpperCase();
  const found = await findRoom(code);
  if (!found) return Response.json({ error: "没有找到这个房间" }, { status: 404 });
  const room = found.state;

  if (action === "join") {
    const name = payload.name?.trim().slice(0, 12) ?? "";
    if (!name) return Response.json({ error: "请先填写昵称" }, { status: 400 });
    if (room.phase !== "lobby") return Response.json({ error: "牌局已经开始" }, { status: 409 });
    if (room.players.length >= 6) return Response.json({ error: "房间已满" }, { status: 409 });
    const token = crypto.randomUUID();
    room.players.push({ id: crypto.randomUUID(), token, name, human: true, host: false, level: "困难", chips: 10000, seated: true, queuedChips: 0, readyNextHand: false });
    await saveRoom(room);
    return Response.json({ token, room: publicRoom(room, token) }, { status: 201 });
  }

  const viewer = room.players.find((player) => player.token === payload.token);
  if (!viewer) return Response.json({ error: "身份已失效" }, { status: 403 });
  if (action === "updateName") {
    const name = payload.name?.trim().slice(0, 12) ?? "";
    if (!name) return Response.json({ error: "昵称不能为空" }, { status: 400 });
    if (room.phase !== "lobby") return Response.json({ error: "开局后不能修改昵称" }, { status: 409 });
    viewer.name = name; await saveRoom(room);
    return Response.json({ room: publicRoom(room, payload.token ?? "") });
  }
  if (action === "gameAction" || action === "extendTime") {
    if (!room.game) return Response.json({ error: "牌局尚未开始" }, { status: 409 });
    try { room.game = action === "extendTime" ? extendServerTime(room.game, viewer.id) : serverAction(room.game, viewer.id, payload.gameAction!, payload.raiseTo); room.game = runServerAutomation(room.game); syncSettledPlayers(room); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "操作无效" }, { status: 409 }); }
    await saveRoom(room); return Response.json({ room: publicRoom(room, payload.token ?? "") });
  }
  if (action === "buyChips") {
    const amount = Number(payload.buyIn);
    if (![5000, 10000, 20000].includes(amount)) return Response.json({ error: "无效筹码包" }, { status: 400 });
    viewer.queuedChips += amount;
    if (!viewer.seated || viewer.chips === 0) viewer.readyNextHand = false;
    await saveRoom(room);
    return Response.json({ room: publicRoom(room, payload.token ?? "") });
  }
  if (action === "enterNextHand") {
    if (viewer.seated || viewer.chips > 0) return Response.json({ error: "你已经在牌桌中" }, { status: 409 });
    if (!viewer.queuedChips) return Response.json({ error: "请先在商店选择筹码包" }, { status: 409 });
    viewer.readyNextHand = true; await saveRoom(room);
    return Response.json({ room: publicRoom(room, payload.token ?? "") });
  }
  if (!viewer.host) return Response.json({ error: "只有房主可以操作" }, { status: 403 });

  if (action === "start") {
    if (room.phase !== "lobby") return Response.json({ error: "牌局已经开始" }, { status: 409 });
    const seated = room.players.filter((player) => player.seated && player.chips > 0);
    if (seated.length < 2) return Response.json({ error: "至少需要两位有筹码的玩家" }, { status: 409 });
    room.phase = "playing"; room.game = startServerGame(seated);
    room.game = runServerAutomation(room.game);
  } else if (action === "endGame") {
    if (room.phase !== "playing") return Response.json({ error: "当前没有进行中的牌局" }, { status: 409 });
    room.phase = "lobby";
    room.game = undefined;
    room.players = room.players.map((player) => ({ ...player, chips: 10000, seated: true, queuedChips: 0, readyNextHand: false }));
  } else if (action === "nextHand") {
    if (!room.game?.winner) return Response.json({ error: "本手尚未结束" }, { status: 409 });
    syncSettledPlayers(room);
    room.players = room.players.map((player) => {
      if (player.seated && player.chips > 0 && player.queuedChips > 0) return { ...player, chips: player.chips + player.queuedChips, queuedChips: 0 };
      if (player.readyNextHand && player.queuedChips > 0) return { ...player, chips: player.queuedChips, seated: true, queuedChips: 0, readyNextHand: false };
      return player;
    });
    const source = room.players.filter((player) => player.seated && player.chips > 0);
    if (source.length < 2) return Response.json({ error: "至少需要两位玩家进场才能开始下一手" }, { status: 409 });
    room.game = startServerGame(source, room.game.hand + 1, room.game.timeBankUsedAt); room.game = runServerAutomation(room.game);
  } else if (action === "addBot") {
    if (room.phase !== "lobby") return Response.json({ error: "牌局中不能调整座位" }, { status: 409 });
    if (room.players.length >= 6) return Response.json({ error: "房间已满" }, { status: 409 });
    const botCount = room.players.filter((player) => !player.human).length;
    const names = ["阿策", "小满", "河牌侠", "老K", "桃子"];
    room.players.push({ id: crypto.randomUUID(), token: "", name: names[botCount] ?? `人机${botCount + 1}`, human: false, host: false, level: payload.level ?? "简单", chips: 10000, seated: true, queuedChips: 0, readyNextHand: false });
  } else if (action === "removePlayer") {
    if (room.phase !== "lobby") return Response.json({ error: "牌局中不能调整座位" }, { status: 409 });
    room.players = room.players.filter((player) => player.id !== payload.playerId || player.host);
  } else return Response.json({ error: "未知操作" }, { status: 400 });

  await saveRoom(room);
  return Response.json({ room: publicRoom(room, payload.token ?? "") });
}
