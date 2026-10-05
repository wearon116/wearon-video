export async function convertMp4(blob,{start=0,end,canvas,draw,onProgress=()=>{}}={}) {
  const m=await import('mediabunny');
  const input=new m.Input({formats:m.ALL_FORMATS,source:new m.BlobSource(blob)});
  const output=new m.Output({format:new m.Mp4OutputFormat({fastStart:'in-memory'}),target:new m.BufferTarget()});
  let conversion;
  try{
    const frameCanvas=document.createElement('canvas');
    const options={input,output,trim:{start,...(end?{end}:{})}};
    if(draw&&canvas){options.video={codec:'avc',bitrate:5_000_000,frameRate:30,processedWidth:canvas.width,processedHeight:canvas.height,process:sample=>{
      frameCanvas.width=sample.displayWidth;frameCanvas.height=sample.displayHeight;
      sample.draw(frameCanvas.getContext('2d'),0,0);
      draw(frameCanvas,Math.max(0,sample.timestamp));return canvas;
    }};}
    conversion=await m.Conversion.init(options);
    if(!conversion.isValid||conversion.discardedTracks.length) throw new Error('이 브라우저에서 영상 또는 오디오를 MP4로 변환할 수 없습니다. 최신 Safari 또는 Chrome으로 다시 시도해주세요.');
    conversion.onProgress=onProgress;await conversion.execute();
    return new Blob([output.target.buffer],{type:'video/mp4'});
  }catch(error){await conversion?.cancel().catch(()=>{});throw error;}finally{input.dispose();}
}
