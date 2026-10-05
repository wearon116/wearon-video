const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const quoteSource=fs.readFileSync('lib/credits.js','utf8').replaceAll('export ','');
const quotes=vm.runInNewContext(quoteSource+';({creditQuote,OUTPUT_SIZES,selectRelevantComments})');
test('selected interval quote and all five dimensions',()=>{
 assert.equal(quotes.creditQuote({start:120,end:180,template:'댓글형',clipCount:3}).total,7);
 assert.equal(quotes.creditQuote({start:120,end:181,template:'미니멀',clipCount:3}).total,2);
 for(const [ratio,[w,h]] of Object.entries(quotes.OUTPUT_SIZES)){
  const [x,y]=ratio.split(':').map(Number);assert.equal(w*y,h*x);
 }
 assert.equal(Object.keys(quotes.OUTPUT_SIZES).length,5);
});
function route(provider){
 const refunds=[];
 const source=fs.readFileSync('app/api/ai/recreate/route.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const ctx={createHmac:crypto.createHmac,timingSafeEqual:crypto.timingSafeEqual,Buffer,URL,Response,console,
  process:{env:{OPUSCLIP_API_KEY:'test',YOUTUBE_API_KEY:'test',SUPABASE_SECRET_KEY:'test'}},
  NextResponse:{json:(body,options)=>({body,status:options?.status||200})},
  ...quotes,requireUser:async()=>({id:'fixture'}),
  reserveCredits:async()=>({id:'request',reused:false}),
  settleCredits:async(...args)=>{refunds.push(args);return{};},updateGeneration:async()=>{},getGeneration:async()=>null,
  fetch:async url=>url.includes('googleapis')?Response.json({items:[{contentDetails:{duration:'PT10M'}}]}):provider()
 };
 vm.createContext(ctx);vm.runInContext(source+';this.post=POST;',ctx);
 return {ctx,refunds,run:()=>ctx.post({json:async()=>({youtubeUrl:'https://www.youtube.com/watch?v=aqz-KE-bpKQ',aspectRatio:'9:16',analysisStart:60,analysisEnd:120,template:'댓글형',expectedCredits:7,requestId:'request'})})};
}
test('provider transport failure refunds once',async()=>{
 const r=route(()=>{throw new Error('network failure');});assert.equal((await r.run()).status,500);assert.deepEqual(r.refunds,[['request',0,true]]);
});
test('provider success without project ID refunds once',async()=>{
 const r=route(()=>Response.json({}));assert.equal((await r.run()).status,500);assert.deepEqual(r.refunds,[['request',0,true]]);
});
test('provider insufficient credits refunds once',async()=>{
 const r=route(()=>Response.json({message:'insufficient'},{status:402}));assert.equal((await r.run()).status,402);assert.deepEqual(r.refunds,[['request',0,true]]);
});
test('reused failed request does not call provider or debit again',async()=>{
 const r=route(()=>{throw Error('must not call provider');});r.ctx.reserveCredits=async()=>({id:'request',reused:true,state:'failed'});
 assert.equal((await r.run()).body.code,'GENERATION_FAILED');assert.equal(r.refunds.length,0);
});
test('trimmed MP4 overlay receives output-relative time, preserving rotating comments and subtitles',async()=>{
 const elapsed=[];
 const source=fs.readFileSync('lib/mp4.js','utf8').replace('export async function','async function').replace("await import('mediabunny')",'mock');
 const mock={Input:class{dispose(){}},BlobSource:class{},Output:class{constructor(){this.target={buffer:new Uint8Array([1])};}},Mp4OutputFormat:class{},BufferTarget:class{},
  Conversion:{init:async options=>({isValid:true,discardedTracks:[],execute:async()=>{
   for(const timestamp of [0,4,8])options.video.process({displayWidth:1920,displayHeight:1080,timestamp,draw(){}});
  },cancel:async()=>{}})}};
 const ctx={mock,Blob,document:{createElement:()=>({getContext:()=>({})})}};vm.createContext(ctx);vm.runInContext(source+';this.convert=convertMp4;',ctx);
 await ctx.convert(new Blob(['fixture']),{start:120,end:140,canvas:{width:1080,height:1920},draw:(_,time)=>elapsed.push(time)});
 assert.deepEqual(elapsed,[0,4,8]);
});
