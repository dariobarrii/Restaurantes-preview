// DESIGN MODEL ONLY. Not imported by product, not PostgreSQL and not durable storage.
// The serial queue models a future atomic transaction; it does not prove DB locking.
export function createIdempotencyModel({cards, now=()=>Date.now(), intervalMs=2000}) {
 const attempts=new Map(),events=[],lastEvent=new Map(),tails=new Map();
 return {events, async register(input){
  const previous=tails.get(input.cardId)||Promise.resolve();let release;
  const current=new Promise(resolve=>{release=resolve});tails.set(input.cardId,current);
  await previous;
  try{
   const card=cards.get(input.cardId);
   if(!card||!card.active||card.archived||!card.approved||!card.tokenActive||input.tokenGeneration!==card.tokenGeneration)return {ok:false,error:'invalid_card'};
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId||'')||!['mobile','desktop','tablet','unknown'].includes(input.deviceType))return{ok:false,error:'invalid_request'};
   let target;try{target=new URL(card.target)}catch{return{ok:false,error:'invalid_destination'}}
   if(target.protocol!=='https:'||target.username||target.password)return{ok:false,error:'invalid_destination'};
   const key=JSON.stringify([card.id,input.requestId]);
   const fingerprint=JSON.stringify([card.businessId,card.channel,card.tokenGeneration,input.deviceType]);
   const existing=attempts.get(key);
   if(existing)return existing.fingerprint===fingerprint?{ok:true,replayed:true,target:target.href}:{ok:false,error:'idempotency_conflict'};
   if(lastEvent.has(card.id)&&now()-lastEvent.get(card.id)<intervalMs)return{ok:false,error:'rate_limited'};
   // Proposed atomic event + ledger write. A real implementation needs a DB unique
   // constraint, rollback and role-restricted RPC; Maps cannot establish those facts.
   const event={cardId:card.id,businessId:card.businessId,eventType:card.channel==='qr'?'qr_scan':'nfc_tap',requestId:input.requestId,createdAt:now()};
   events.push(event);attempts.set(key,{fingerprint});lastEvent.set(card.id,now());
   return{ok:true,replayed:false,target:target.href};
  }finally{release();if(tails.get(input.cardId)===current)tails.delete(input.cardId)}
 }};
}
