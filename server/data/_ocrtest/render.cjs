const fs=require('fs'),path=require('path');
(async()=>{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {createCanvas}=require('@napi-rs/canvas');
  const data=new Uint8Array(fs.readFileSync('data/_ocrtest/ehhn102.pdf'));
  const doc=await pdfjs.getDocument({data,disableWorker:true}).promise;
  const page=await doc.getPage(3);
  const vp=page.getViewport({scale:2.0});
  const canvas=createCanvas(vp.width,vp.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  fs.writeFileSync('data/_ocrtest/page3.png',canvas.toBuffer('image/png'));
  console.log('rendered page3.png',fs.statSync('data/_ocrtest/page3.png').size,'bytes');
})().catch(e=>console.log('render err',e.message));
