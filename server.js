const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname));
const rooms = new Map();
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
const cleanName = value => String(value || '').trim().replace(/[<>]/g,'').slice(0,20);
const code = () => { let c; do {c = String(crypto.randomInt(100000,1000000));} while (rooms.has(c)); return c; };
function view(room){
 const players = [...room.players.values()].map(p=>({id:p.id,name:p.name,connected:p.connected}));
 const votes = [...room.votes.entries()].map(([id,vote])=>({id,name:room.players.get(id)?.name||'Left player',vote}));
 return {code:room.code,hostId:room.hostId,players,phase:room.phase,round:room.round,question:room.order[room.round]===undefined?null:questions[room.order[room.round]],votes,questionCount:room.order.length};
}
function emit(room){io.to(room.code).emit('state',view(room));}
function respond(ack,data){if(typeof ack==='function')ack(data);}
function joinSocket(socket,room,player){socket.join(room.code);socket.data.code=room.code;socket.data.playerId=player.id;player.connected=true;player.socketId=socket.id;emit(room);}
function shuffle(){return questions.map((_,i)=>i).sort(()=>Math.random()-.5);}
io.on('connection',socket=>{
 socket.on('create',({name}={},ack)=>{
  name=cleanName(name);if(!name)return respond(ack,{error:'Enter a nickname.'});
  const c=code(),id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex');
  const room={code:c,hostId:id,players:new Map(),votes:new Map(),phase:'lobby',round:-1,order:shuffle()};
  room.players.set(id,{id,name,token,connected:true,socketId:socket.id});rooms.set(c,room);
  joinSocket(socket,room,room.players.get(id));respond(ack,{ok:true,code:c,id,token});
 });
 socket.on('join',({code:c,name}={},ack)=>{
  c=String(c||'').trim();name=cleanName(name);const room=rooms.get(c);
  if(!room)return respond(ack,{error:'Room not found. Check the code.'});
  if(!name)return respond(ack,{error:'Enter a nickname.'});
  if(room.phase!=='lobby')return respond(ack,{error:'This game already started. Ask the host to make a new room.'});
  if(room.players.size>=30)return respond(ack,{error:'Room is full (30 players).'});
  if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return respond(ack,{error:'That nickname is taken.'});
  const id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex');
  const player={id,name,token,connected:true,socketId:socket.id};room.players.set(id,player);
  joinSocket(socket,room,player);respond(ack,{ok:true,code:c,id,token});
 });
 socket.on('resume',({code:c,id,token}={},ack)=>{
  const room=rooms.get(String(c||'')),player=room?.players.get(id);
  if(!player||player.token!==token)return respond(ack,{error:'Session expired. Join a new room.'});
  if(player.socketId&&player.socketId!==socket.id){const old=io.sockets.sockets.get(player.socketId);if(old){old.leave(room.code);old.data={};old.emit('replaced');}}
  joinSocket(socket,room,player);respond(ack,{ok:true});
 });
 socket.on('vote',({vote}={},ack)=>{
  const room=rooms.get(socket.data.code),player=room?.players.get(socket.data.playerId);
  if(!room||!player||player.socketId!==socket.id||room.phase!=='voting'||!['agree','disagree'].includes(vote))return respond(ack,{error:'Cannot vote right now.'});
  room.votes.set(player.id,vote);emit(room);respond(ack,{ok:true});
 });
 socket.on('hostAction',({action}={},ack)=>{
  const room=rooms.get(socket.data.code);
  if(!room||room.hostId!==socket.data.playerId||room.players.get(room.hostId)?.socketId!==socket.id)return respond(ack,{error:'Only the host can do that.'});
  if(action==='next'&&(room.phase==='lobby'||room.phase==='results')){
   if(room.round+1>=room.order.length){room.order=shuffle();room.round=-1;}
   room.round++;room.phase='voting';room.votes.clear();
  }else if(action==='reveal'&&room.phase==='voting')room.phase='results';
  else if(action==='lobby'){room.phase='lobby';room.round=-1;room.votes.clear();room.order=shuffle();}
  else return respond(ack,{error:'That action is not available.'});
  emit(room);respond(ack,{ok:true});
 });
 socket.on('disconnect',()=>{
  const room=rooms.get(socket.data.code),player=room?.players.get(socket.data.playerId);
  if(!room||!player||player.socketId!==socket.id)return;
  player.connected=false;emit(room);
  if([...room.players.values()].every(p=>!p.connected)){
   setTimeout(()=>{if(rooms.get(room.code)===room&&[...room.players.values()].every(p=>!p.connected))rooms.delete(room.code);},60*60*1000);
  }
 });
});
const port=process.env.PORT||3000;server.listen(port,()=>console.log(`Hot Takes running on port ${port}`));
