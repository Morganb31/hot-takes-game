const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname));
const questions = [
 ['Friendships','Your best friend should not be friends with your enemy.'],
 ['Relationships','Being left on read is worse than being left on delivered.'],
 ['School','Group projects should be graded individually.'],
 ['Friendships','It is okay to outgrow a friendship without a big argument.'],
 ['Relationships','The talking stage is more stressful than dating.'],
 ['Funny','Cereal is better at night than in the morning.'],
 ['Friendships','Keeping a secret from your best friend is sometimes necessary.'],
 ['School','Homework over the weekend should be banned.'],
 ['Relationships','You should not date someone your friend used to like.'],
 ['Funny','Pineapple belongs on pizza.'],
 ['Friendships','A friend who never texts first is not a real friend.'],
 ['Relationships','Matching outfits are cute, not embarrassing.'],
 ['School','A four-day school week would make students more productive.'],
 ['Funny','Movie spoilers are only bad for the first week.'],
 ['Friendships','It is better to have two close friends than a big friend group.'],
 ['Relationships','A good morning text should not be expected every day.'],
 ['School','Students should be allowed to listen to music during independent work.'],
 ['Funny','Fries taste better than the burger.'],
 ['Friendships','You can be friends with someone without telling them everything.'],
 ['Relationships','A first date at the movies is a bad idea.'],
 ['School','Presentations are worse than tests.'],
 ['Funny','The sequel is sometimes better than the original.'],
 ['Friendships','It is okay to cancel plans just because you need alone time.'],
 ['Relationships','You should tell your friend if you dislike who they are dating.'],
 ['School','Attendance should not affect grades.'],
 ['Funny','Cold pizza is better than reheated pizza.'],
 ['Friendships','Friends should always defend each other in public, even when one is wrong.'],
 ['Relationships','Being funny matters more than having the same interests.'],
 ['School','Open-note tests are more useful than memorization tests.'],
 ['Funny','A playlist says more about a person than their social media.']
];
const cleanName = v => String(v||'').trim().replace(/[<>]/g,'').slice(0,20);
const rooms = new Map();
const teamNames = ['red','orange'];
const makeCode=()=>{let c;do{c=String(crypto.randomInt(100000,1000000));}while(rooms.has(c));return c;};
const shuffle=()=>questions.map((_,i)=>i).sort(()=>Math.random()-.5);
function snapshot(r){return {code:r.code,hostId:r.hostId,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,connected:p.connected,team:p.team})),phase:r.phase,round:r.round,question:r.round<0?null:questions[r.order[r.round]],sides:r.sides,representatives:r.representatives,winner:r.winner,deadline:r.deadline,finalRevealed:r.finalRevealed,score:r.phase==='final'&&!r.finalRevealed?null:r.phase==='final'?r.score:null};}
const emit=r=>io.to(r.code).emit('state',snapshot(r));
const reply=(ack,result)=>{if(typeof ack==='function')ack(result);};
function attach(socket,r,p){socket.join(r.code);socket.data.code=r.code;socket.data.playerId=p.id;p.connected=true;p.socketId=socket.id;emit(r);}
function getPlayer(socket){const r=rooms.get(socket.data.code),p=r?.players.get(socket.data.playerId);return r&&p&&p.socketId===socket.id?{r,p}:null;}
function resetRound(r){r.sides={red:null,orange:null};r.representatives={red:null,orange:null};r.winner=null;r.deadline=null;}
io.on('connection',socket=>{
 socket.on('create',({name}={},ack)=>{name=cleanName(name);if(!name)return reply(ack,{error:'Enter a nickname.'});const c=makeCode(),id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex');const r={code:c,hostId:id,players:new Map(),phase:'lobby',round:-1,order:shuffle(),score:{red:0,orange:0},finalRevealed:false};resetRound(r);r.players.set(id,{id,name,token,team:null,connected:true,socketId:socket.id});rooms.set(c,r);attach(socket,r,r.players.get(id));reply(ack,{ok:true,code:c,id,token});});
 socket.on('join',({code:c,name}={},ack)=>{const r=rooms.get(String(c||'').trim());name=cleanName(name);if(!r)return reply(ack,{error:'Room not found.'});if(!name)return reply(ack,{error:'Enter a nickname.'});if(r.phase!=='lobby')return reply(ack,{error:'Game started. Ask host to return to lobby.'});if(r.players.size>=30)return reply(ack,{error:'Room is full.'});if([...r.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return reply(ack,{error:'Nickname already taken.'});const id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex');const p={id,name,token,team:null,connected:true,socketId:socket.id};r.players.set(id,p);attach(socket,r,p);reply(ack,{ok:true,code:r.code,id,token});});
 socket.on('resume',({code:c,id,token}={},ack)=>{const r=rooms.get(String(c||'')),p=r?.players.get(id);if(!p||p.token!==token)return reply(ack,{error:'Session expired. Join again.'});if(p.socketId&&p.socketId!==socket.id){const old=io.sockets.sockets.get(p.socketId);if(old){old.leave(r.code);old.data={};old.emit('replaced');}}attach(socket,r,p);reply(ack,{ok:true});});
 socket.on('team',({team}={},ack)=>{const x=getPlayer(socket);if(!x||x.r.phase!=='lobby'||!teamNames.includes(team))return reply(ack,{error:'Cannot change teams now.'});x.p.team=team;emit(x.r);reply(ack,{ok:true});});
 socket.on('side',({side}={},ack)=>{const x=getPlayer(socket);if(!x||x.r.phase!=='setup'||!x.p.team||!['agree','disagree'].includes(side))return reply(ack,{error:'Cannot choose a side now.'});x.r.sides[x.p.team]=side;emit(x.r);reply(ack,{ok:true});});
 socket.on('representative',({id}={},ack)=>{const x=getPlayer(socket);if(!x||x.r.phase!=='setup'||!x.p.team)return reply(ack,{error:'Cannot choose a representative now.'});const target=x.r.players.get(id);if(!target||target.team!==x.p.team)return reply(ack,{error:'Choose someone from your team.'});x.r.representatives[x.p.team]=id;emit(x.r);reply(ack,{ok:true});});
 socket.on('hostAction',({action,team,side}={},ack)=>{const x=getPlayer(socket);if(!x||x.r.hostId!==x.p.id)return reply(ack,{error:'Only host can do that.'});const r=x.r;
 if(action==='next'&&(r.phase==='lobby'||r.phase==='results')){if(!teamNames.every(t=>[...r.players.values()].some(p=>p.team===t)))return reply(ack,{error:'Both teams need players.'});if(r.round+1>=r.order.length){r.order=shuffle();r.round=-1;}r.round++;r.phase='setup';resetRound(r);r.deadline=Date.now()+60000;}
 else if(action==='debate'&&r.phase==='setup'){if(!teamNames.every(t=>r.representatives[t]))return reply(ack,{error:'Each team needs a representative.'});if(!r.sides.red||!r.sides.orange||r.sides.red===r.sides.orange)return reply(ack,{error:'Teams must have opposite sides. Host can resolve a tie.'});r.phase='debate';r.deadline=Date.now()+120000;}
 else if(action==='resolve'&&r.phase==='setup'&&teamNames.includes(team)&&['agree','disagree'].includes(side)){r.sides[team]=side;r.sides[team==='red'?'orange':'red']=side==='agree'?'disagree':'agree';}
 else if(action==='award'&&r.phase==='debate'&&teamNames.includes(team)){r.winner=team;r.score[team]++;r.phase='results';r.deadline=null;}
 else if(action==='end'&&r.phase!=='final'){r.phase='final';r.deadline=null;r.finalRevealed=false;}
 else if(action==='revealFinal'&&r.phase==='final'&&!r.finalRevealed){r.finalRevealed=true;}
 else if(action==='lobby'){r.phase='lobby';r.round=-1;r.score={red:0,orange:0};r.order=shuffle();resetRound(r);r.finalRevealed=false;}
 else return reply(ack,{error:'Action not available.'});emit(r);reply(ack,{ok:true});});
 socket.on('disconnect',()=>{const x=getPlayer(socket);if(!x)return;const {r,p}=x;p.connected=false;emit(r);if([...r.players.values()].every(v=>!v.connected)){setTimeout(()=>{if(rooms.get(r.code)===r&&[...r.players.values()].every(v=>!v.connected))rooms.delete(r.code);},3600000);}});
});
const port=process.env.PORT||3000;server.listen(port,()=>console.log(`Hot Takes Team Battle running on port ${port}`));
