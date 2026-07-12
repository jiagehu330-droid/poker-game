import type { ServerGame } from "./poker-server";

export type Settlement = { createdAt: number; hands: number; players: Array<{ id: string; name: string; host: boolean; human: boolean; finalChips: number; purchasesCount: number; purchasedChips: number; netChips: number }> };
export type SettlementPlayer = { id: string; name: string; host: boolean; human: boolean; chips: number; queuedChips: number; purchasesCount: number; purchasedChips: number };

export function createSessionSettlement(players: SettlementPlayer[], game?: ServerGame, now = Date.now()): Settlement {
  const gamePlayers = new Map(game?.players.map((player) => [player.id, player]) ?? []);
  return {
    createdAt: now,
    hands: game?.hand ?? 0,
    players: players.map((player) => {
      const gamePlayer = gamePlayers.get(player.id);
      const tableChips = gamePlayer ? gamePlayer.chips + (game?.winner ? 0 : gamePlayer.committed) : player.chips;
      const finalChips = tableChips + player.queuedChips;
      return { id: player.id, name: player.name, host: player.host, human: player.human, finalChips, purchasesCount: player.purchasesCount, purchasedChips: player.purchasedChips, netChips: finalChips - 10000 - player.purchasedChips };
    }),
  };
}
