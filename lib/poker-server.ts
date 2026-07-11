export type ServerCard = { rank: number; label: string; suit: string; red: boolean };
export type ServerPlayer = { id: string; name: string; human: boolean; host: boolean; level: "简单" | "困难"; chips: number; folded: boolean; bet: number; committed: number; lastAction: string; role: string };
export type ServerGame = { hand: number; street: "preflop"|"flop"|"turn"|"river"|"showdown"; players: ServerPlayer[]; dealerId: string; pot: number; currentBet: number; pending: string[]; log: string[]; winner: string|null; board: ServerCard[]; holes: Record<string,[ServerCard,ServerCard]>; turnSerial: number; deadline: number; timeBankUsedAt: Record<string,number> };
export type GameAction = "fold"|"check"|"call"|"raise";
const names=["高牌","一对","两对","三条","顺子","同花","葫芦","四条","同花顺"];
const streetIndex={preflop:0,flop:1,turn:2,river:3,showdown:4} as const;

function deck(){const suits=[{suit:"♠",red:false},{suit:"♥",red:true},{suit:"♣",red:false},{suit:"♦",red:true}];const labels:Record<number,string>={14:"A",13:"K",12:"Q",11:"J"};const d=suits.flatMap(s=>Array.from({length:13},(_,i)=>({rank:i+2,label:labels[i+2]??String(i+2),...s})));for(let i=d.length-1;i>0;i--){const v=new Uint32Array(1);crypto.getRandomValues(v);const j=v[0]%(i+1);[d[i],d[j]]=[d[j],d[i]];}return d;}
function canAct(p:ServerPlayer){return !p.folded&&p.chips>0;}
function orderAfter(ps:ServerPlayer[],id:string){const start=ps.findIndex(p=>p.id===id),out:string[]=[];for(let n=1;n<=ps.length;n++){const p=ps[(start+n)%ps.length];if(p&&canAct(p))out.push(p.id);}return out;}
function score5(cs:ServerCard[]){const rs=cs.map(c=>c.rank).sort((a,b)=>b-a),u=[...new Set(rs)],groups=u.map(r=>({r,n:rs.filter(x=>x===r).length})).sort((a,b)=>b.n-a.n||b.r-a.r),flush=cs.every(c=>c.suit===cs[0].suit),straight=u.length===5&&(u[0]-u[4]===4||u.join()==="14,5,4,3,2"),sh=straight?(u[0]===14&&u[1]===5?5:u[0]):0;if(flush&&straight)return[8,sh];if(groups[0].n===4)return[7,groups[0].r,groups[1].r];if(groups[0].n===3&&groups[1].n===2)return[6,groups[0].r,groups[1].r];if(flush)return[5,...rs];if(straight)return[4,sh];if(groups[0].n===3)return[3,groups[0].r,...groups.slice(1).map(x=>x.r).sort((a,b)=>b-a)];const pairs=groups.filter(x=>x.n===2).map(x=>x.r).sort((a,b)=>b-a);if(pairs.length===2)return[2,...pairs,groups.find(x=>x.n===1)!.r];if(pairs.length===1)return[1,pairs[0],...groups.filter(x=>x.n===1).map(x=>x.r).sort((a,b)=>b-a)];return[0,...rs];}
function cmp(a:number[],b:number[]){for(let i=0;i<Math.max(a.length,b.length);i++)if((a[i]??0)!==(b[i]??0))return(a[i]??0)-(b[i]??0);return 0;}
function best(cs:ServerCard[]){let top:number[]=[];for(let a=0;a<3;a++)for(let b=a+1;b<4;b++)for(let c=b+1;c<5;c++)for(let d=c+1;d<6;d++)for(let e=d+1;e<7;e++){const s=score5([cs[a],cs[b],cs[c],cs[d],cs[e]]);if(!top.length||cmp(s,top)>0)top=s;}return{score:top,name:names[top[0]]};}

export function startServerGame(source:Array<{id:string;name:string;human:boolean;host:boolean;level:"简单"|"困难";chips:number}>,hand=1,banks:Record<string,number>={}):ServerGame{
  if(source.length<2)throw new Error("至少需要两位有筹码的玩家");
  const di=(hand-1)%source.length,si=source.length===2?di:(di+1)%source.length,bi=source.length===2?(di+1)%source.length:(di+2)%source.length;
  const ps:ServerPlayer[]=source.map((p,i)=>{const blind=i===si?Math.min(50,p.chips):i===bi?Math.min(100,p.chips):0;return{...p,folded:false,bet:blind,committed:blind,lastAction:i===si?`小盲 ${blind}`:i===bi?`大盲 ${blind}`:"等待",role:i===di&&i===si?"D/SB":i===di?"D":i===si?"SB":i===bi?"BB":"",chips:p.chips-blind};});
  const d=deck(),holes:Record<string,[ServerCard,ServerCard]>={};ps.forEach(p=>holes[p.id]=[d.shift()!,d.shift()!]);
  const currentBet=Math.max(...ps.map(p=>p.bet));
  return{hand,street:"preflop",players:ps,dealerId:ps[di].id,pot:ps.reduce((n,p)=>n+p.committed,0),currentBet,pending:orderAfter(ps,ps[bi].id),log:[`第 ${hand} 手开始`,`${ps[si].name} 下小盲 ${ps[si].bet}`,`${ps[bi].name} 下大盲 ${ps[bi].bet}`],winner:null,board:d.splice(0,5),holes,turnSerial:0,deadline:Date.now()+60000,timeBankUsedAt:banks};
}

function finish(g:ServerGame,id:string,why:string){const ps=g.players.map(p=>p.id===id?{...p,chips:p.chips+g.pot,lastAction:`赢得 ${g.pot}`}:p),w=ps.find(p=>p.id===id)!;return{...g,players:ps,street:"showdown" as const,pending:[],currentBet:0,winner:`${w.name} ${why}，获得 ${g.pot}`,log:[...g.log,`${w.name} ${why}，获得 ${g.pot}`]};}

export function settleShowdown(g:ServerGame){
  const scored=new Map(g.players.filter(p=>!p.folded).map(p=>[p.id,best([...g.holes[p.id],...g.board])]));
  const levels=[...new Set(g.players.map(p=>p.committed).filter(n=>n>0))].sort((a,b)=>a-b);
  const awards=new Map<string,number>(),details:string[]=[];let previous=0;
  for(const level of levels){
    const contributors=g.players.filter(p=>p.committed>=level),amount=(level-previous)*contributors.length;previous=level;
    const eligible=contributors.filter(p=>!p.folded);if(!eligible.length)continue;
    const top=eligible.reduce((a,b)=>cmp(scored.get(b.id)!.score,scored.get(a.id)!.score)>0?b:a);
    const winners=eligible.filter(p=>cmp(scored.get(p.id)!.score,scored.get(top.id)!.score)===0);
    const share=Math.floor(amount/winners.length),remainder=amount%winners.length;
    winners.forEach((p,i)=>awards.set(p.id,(awards.get(p.id)??0)+share+(i<remainder?1:0)));
    details.push(`${amount} 筹码由 ${winners.map(p=>p.name).join("、")} 赢得`);
  }
  const awarded=[...awards.values()].reduce((sum,n)=>sum+n,0),legacyRemainder=Math.max(0,g.pot-awarded);
  if(legacyRemainder){const eligible=g.players.filter(p=>!p.folded),top=eligible.reduce((a,b)=>cmp(scored.get(b.id)!.score,scored.get(a.id)!.score)>0?b:a),winners=eligible.filter(p=>cmp(scored.get(p.id)!.score,scored.get(top.id)!.score)===0),share=Math.floor(legacyRemainder/winners.length),remainder=legacyRemainder%winners.length;winners.forEach((p,i)=>awards.set(p.id,(awards.get(p.id)??0)+share+(i<remainder?1:0)));}
  const ps=g.players.map(p=>{const won=awards.get(p.id)??0;return won?{...p,chips:p.chips+won,lastAction:`赢得 ${won}`}:p;});
  const winnerNames=ps.filter(p=>awards.has(p.id)).map(p=>p.name).join("、"),result=`${winnerNames} 完成摊牌结算`;
  return{...g,players:ps,street:"showdown" as const,pending:[],currentBet:0,winner:result,log:[...g.log,...details,result]};
}

function advance(g:ServerGame):ServerGame{
  const active=g.players.filter(p=>!p.folded);if(active.length===1)return finish(g,active[0].id,"成为最后未弃牌玩家");if(g.street==="river")return settleShowdown(g);
  const s=g.street==="preflop"?"flop":g.street==="flop"?"turn":"river",ps=g.players.map(p=>({...p,bet:0,lastAction:p.folded?"已弃牌":p.chips===0?"全下":"等待"}));
  const next:ServerGame={...g,street:s,players:ps,currentBet:0,pending:orderAfter(ps,g.dealerId),log:[...g.log,`进入${s==="flop"?"翻牌":s==="turn"?"转牌":"河牌"}圈`],deadline:Date.now()+60000};
  return next.pending.length?next:advance(next);
}

export function serverAction(g:ServerGame,id:string,action:GameAction,target?:number):ServerGame{
  if(g.winner||g.pending[0]!==id)throw new Error("还没轮到你");const actor=g.players.find(p=>p.id===id)!;if(actor.chips<=0)throw new Error("你已经全下");
  const call=Math.max(0,g.currentBet-actor.bet);let paid=0,nextBet=g.currentBet,label="",reset=false;
  const ps=g.players.map(p=>{if(p.id!==id)return p;if(action==="fold"){label="弃牌";return{...p,folded:true,lastAction:label};}if(action==="check"){if(call>0)throw new Error("当前不能过牌");label="过牌";return{...p,lastAction:label};}if(action==="call"){paid=Math.min(call,p.chips);label=paid===p.chips&&paid<call?`全下跟注 ${paid}`:paid?`跟注 ${paid}`:"过牌";return{...p,chips:p.chips-paid,bet:p.bet+paid,committed:p.committed+paid,lastAction:label};}const min=Math.max(g.currentBet+100,g.currentBet===0?100:g.currentBet*2),maxTo=p.bet+p.chips;if(maxTo<=g.currentBet){paid=p.chips;label=`全下跟注 ${paid}`;return{...p,chips:0,bet:p.bet+paid,committed:p.committed+paid,lastAction:label};}const to=Math.min(maxTo,Math.max(min,target??min));paid=to-p.bet;nextBet=to;reset=true;label=paid===p.chips?`全下至 ${to}`:`加注至 ${to}`;return{...p,chips:p.chips-paid,bet:to,committed:p.committed+paid,lastAction:label};});
  let pending=reset?orderAfter(ps,id).filter(x=>x!==id):g.pending.slice(1);pending=pending.filter(x=>canAct(ps.find(p=>p.id===x)!));
  let n:ServerGame={...g,players:ps,pot:g.pot+paid,currentBet:nextBet,pending,log:[...g.log,`${actor.name} ${label}`],turnSerial:g.turnSerial+1,deadline:Date.now()+60000};if(ps.filter(p=>!p.folded).length===1||!pending.length)n=advance(n);return n;
}

export function runServerAutomation(g:ServerGame){let n=g,guard=0;while(!n.winner&&guard++<40){const a=n.players.find(p=>p.id===n.pending[0]);if(!a){n=advance(n);continue;}if(a.human&&Date.now()<n.deadline)break;const call=n.currentBet-a.bet;n=serverAction(n,a.id,a.human?(call>0?"fold":"check"):(call>0?"call":"check"));}return n;}
export function extendServerTime(g:ServerGame,id:string){if(g.pending[0]!==id)throw new Error("还没轮到你");const round=(g.hand-1)*4+streetIndex[g.street],last=g.timeBankUsedAt[id]??-99;if(round-last<2)throw new Error("时间卡仍在冷却");return{...g,deadline:g.deadline+20000,timeBankUsedAt:{...g.timeBankUsedAt,[id]:round},log:[...g.log,`${g.players.find(p=>p.id===id)?.name} 使用时间卡 +20 秒`]};}
export function publicServerGame(g:ServerGame,viewerId:string){const map=(id:string)=>id===viewerId?"you":id,show=g.street==="showdown",viewerInGame=!!g.holes[viewerId];const holes:Record<string,ServerCard[]>={you:viewerInGame?g.holes[viewerId]:[]};if(show)Object.entries(g.holes).forEach(([id,c])=>holes[map(id)]=c);return{...g,turnSecondsLeft:Math.max(0,Math.ceil((g.deadline-Date.now())/1000)),players:g.players.map(p=>({...p,id:map(p.id)})),dealerId:map(g.dealerId),pending:g.pending.map(map),holes};}
