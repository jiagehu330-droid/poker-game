import test from "node:test";
import assert from "node:assert/strict";
import { serverAction, settleShowdown, startServerGame } from "../lib/poker-server.ts";

const player = (id, chips = 10000) => ({ id, name: id.toUpperCase(), human: true, host: id === "a", level: "困难", chips });
const card = (rank, suit = "♠") => ({ rank, label: String(rank), suit, red: suit === "♥" || suit === "♦" });
const totalChips = (game) => game.players.reduce((sum, item) => sum + item.chips, 0);
const committed = (game) => game.players.reduce((sum, item) => sum + item.committed, 0);

function assertGameInvariant(game, bankroll) {
  assert.ok(game.players.every((item) => item.chips >= 0 && item.bet >= 0 && item.committed >= 0), "筹码、下注和累计投入不能为负数");
  assert.equal(game.pot, committed(game), "底池必须等于所有玩家累计投入");
  assert.equal(game.winner ? totalChips(game) : totalChips(game) + game.pot, bankroll, "每手牌筹码必须守恒");
  assert.equal(new Set([...game.board, ...Object.values(game.holes).flat()].map((item) => `${item.rank}${item.suit}`)).size, 5 + game.players.length * 2, "一副牌不能出现重复牌");
}

test("两人桌与三人桌的盲注、庄家和翻牌前行动顺序", () => {
  const headsUp = startServerGame([player("a"), player("b")]);
  assert.equal(headsUp.players.find((item) => item.id === "a").role, "D/SB");
  assert.equal(headsUp.players.find((item) => item.id === "b").role, "BB");
  assert.equal(headsUp.pending[0], "a");
  const three = startServerGame([player("a"), player("b"), player("c")]);
  assert.equal(three.players.find((item) => item.id === "a").role, "D");
  assert.equal(three.players.find((item) => item.id === "b").role, "SB");
  assert.equal(three.players.find((item) => item.id === "c").role, "BB");
  assert.equal(three.pending[0], "a");
});

test("短筹码盲注和全下跟注不会产生负数", () => {
  let game = startServerGame([player("a", 40), player("b", 1000), player("c", 1000)]);
  assertGameInvariant(game, 2040);
  while (!game.winner) {
    const actor = game.players.find((item) => item.id === game.pending[0]);
    game = serverAction(game, actor.id, game.currentBet > actor.bet ? "call" : "check");
    assertGameInvariant(game, 2040);
  }
});

test("同一个回合的重复操作会被拒绝", () => {
  const game = startServerGame([player("a"), player("b"), player("c")]);
  const actor = game.pending[0];
  const next = serverAction(game, actor, "call");
  assert.throws(() => serverAction(next, actor, "call"), /还没轮到你/);
});

test("三层边池分别发给对应赢家", () => {
  const players = [
    { ...player("a",0), folded:false, bet:0, committed:1000, lastAction:"全下", role:"" },
    { ...player("b",0), folded:false, bet:0, committed:500, lastAction:"全下", role:"" },
    { ...player("c",0), folded:false, bet:0, committed:200, lastAction:"全下", role:"" },
  ];
  const game = { hand:1, street:"river", players, dealerId:"a", pot:1700, currentBet:0, pending:[], log:[], winner:null,
    board:[card(2,"♠"),card(3,"♥"),card(4,"♦"),card(8,"♣"),card(9,"♠")], holes:{a:[card(14,"♥"),card(14,"♣")],b:[card(8,"♥"),card(9,"♣")],c:[card(5,"♥"),card(6,"♣")]}, turnSerial:0,deadline:Date.now()+60000,timeBankUsedAt:{} };
  const result = settleShowdown(game), chips = Object.fromEntries(result.players.map((item) => [item.id,item.chips]));
  assert.deepEqual(chips,{a:500,b:600,c:600});
  assert.equal(totalChips(result),1700);
});

test("平局分池包含奇数筹码且弃牌者不能获奖", () => {
  const players = [
    { ...player("a",0), folded:false, bet:0, committed:101, lastAction:"全下", role:"" },
    { ...player("b",0), folded:false, bet:0, committed:101, lastAction:"全下", role:"" },
    { ...player("c",0), folded:true, bet:0, committed:101, lastAction:"弃牌", role:"" },
  ];
  const game = { hand:1, street:"river", players, dealerId:"a", pot:303, currentBet:0, pending:[], log:[], winner:null,
    board:[card(10,"♠"),card(11,"♥"),card(12,"♦"),card(13,"♣"),card(14,"♠")], holes:{a:[card(2,"♥"),card(3,"♣")],b:[card(4,"♥"),card(5,"♣")],c:[card(14,"♥"),card(14,"♣")]}, turnSerial:0,deadline:Date.now()+60000,timeBankUsedAt:{} };
  const result=settleShowdown(game), chips=Object.fromEntries(result.players.map((item)=>[item.id,item.chips]));
  assert.equal(chips.a+chips.b,303); assert.equal(Math.abs(chips.a-chips.b),1); assert.equal(chips.c,0);
});

test("2–6 人随机策略连续运行 120 手", () => {
  let seed=20260711;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  let roster=Array.from({length:6},(_,index)=>player(String.fromCharCode(97+index),5000));
  for(let hand=1;hand<=120;hand++){
    const active=roster.filter((item)=>item.chips>0);
    while(active.length<2){const busted=roster.find((item)=>item.chips===0);busted.chips=5000;active.push(busted);}
    const entrants=active.slice(0,2+Math.floor(random()*Math.min(5,active.length-1)));
    const bankroll=entrants.reduce((sum,item)=>sum+item.chips,0);
    let game=startServerGame(entrants,hand), guard=0;assertGameInvariant(game,bankroll);
    while(!game.winner&&guard++<500){
      const actor=game.players.find((item)=>item.id===game.pending[0]);assert.ok(actor,"进行中的牌局必须有行动者");
      const call=Math.max(0,game.currentBet-actor.bet),roll=random();let action="check",target;
      if(call>0) action=roll<.12?"fold":roll<.72?"call":"raise"; else action=roll<.55?"check":"raise";
      if(action==="raise") { const max=actor.bet+actor.chips;if(max<=game.currentBet)action="call";else target=Math.min(max,Math.max(game.currentBet+100,Math.round((game.currentBet+100+random()*(max-game.currentBet-100))/50)*50)); }
      game=serverAction(game,actor.id,action,target);assertGameInvariant(game,bankroll);
    }
    assert.ok(game.winner,`第 ${hand} 手未能结束`);
    const chips=new Map(game.players.map((item)=>[item.id,item.chips]));roster=roster.map((item)=>chips.has(item.id)?{...item,chips:chips.get(item.id)}:item);
  }
});
