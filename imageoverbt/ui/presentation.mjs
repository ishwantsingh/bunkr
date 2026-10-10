import {mountBackground} from './background.mjs';

export function dragBounds(start,end,min=.08){
  const clamp=v=>Math.max(0,Math.min(1,v));
  const [x,y]=start.map(clamp),[u,v]=end.map(clamp);
  return Math.abs(u-x)<min||Math.abs(v-y)<min?null:[Math.min(x,u),Math.min(y,v),Math.max(x,u),Math.max(y,v)];
}
export function progressValue(received,total){return total>0?Math.min(100,Math.max(0,Math.round(received/total*100))):0;}

export function mountPresentation(hooks){
  const $=id=>document.getElementById(id);
  mountBackground($('bokeh-background'));
  let draw=null,recording=null,audioContext=null,analyser=null,animation=null,source=null;
  for(const column of document.querySelectorAll('.phone-column')){
    const screen=column.querySelector('.phone-screen'),close=column.querySelector('.viewer-close');
    const photo=column.querySelector('.source-photo,.recipient-photo');
    const open=()=>{
      if(photo.id==='recipient-photo'&&!hooks.previewReady())return;
      screen.classList.add('viewer-open');close.hidden=false;close.focus();
    };
    const dismiss=()=>{screen.classList.remove('viewer-open');close.hidden=true;photo.focus();};
    column.querySelector('.expand-photo')?.addEventListener('click',e=>{e.stopPropagation();open();});
    photo.addEventListener('dblclick',open);
    photo.addEventListener('click',e=>{if(!screen.classList.contains('viewer-open')&&!e.target.closest('#crop-box'))open();});
    photo.addEventListener('keydown',e=>{if(e.target===photo&&['Enter',' '].includes(e.key)){e.preventDefault();open();}});
    close.addEventListener('click',dismiss);
    screen.addEventListener('keydown',e=>{if(e.key==='Escape'&&screen.classList.contains('viewer-open')){e.stopPropagation();dismiss();}});
    const orb=column.querySelector('.node-orb'),info=column.querySelector('.node-info');
    orb.addEventListener('click',()=>{
      info.hidden=!info.hidden;orb.setAttribute('aria-expanded',String(!info.hidden));
      const network=hooks.network(),route=network.getRoute(column.classList.contains('receiver-column'));
      info.textContent=`${column.classList.contains('receiver-column')?'NODE D · SAM':'NODE A · ALEX'}\n${network.preset} · ${network.online?'Network online':'Network disconnected'}\n${route?route.join(' → '):'No route available'}\n${Math.round(network.loss*100)}% modeled loss per hop`;
    });
  }
  const photo=$('recipient-photo');
  photo.addEventListener('pointerdown',e=>{
    if(!photo.closest('.viewer-open')||e.target.closest('#crop-box')||hooks.busy()||!hooks.previewReady())return;
    const rect=photo.getBoundingClientRect();draw={rect,start:[(e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height]};
    photo.setPointerCapture(e.pointerId);e.preventDefault();
  });
  const move=e=>{
    if(!draw)return;
    const {rect,start}=draw,next=dragBounds(start,[(e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height]);
    if(next)hooks.select(next);
  };
  photo.addEventListener('pointermove',move);
  photo.addEventListener('pointerup',e=>{move(e);draw=null;});photo.addEventListener('pointercancel',()=>draw=null);
  $('render-full').addEventListener('click',()=>{if(hooks.busy()||!hooks.previewReady())return;hooks.select([0,0,1,1]);hooks.request();});
  $('alex-photo').addEventListener('click',()=>$('choose-photo').click());
  for(const name of ['alex','sam']){
    $(name+'-cancel-record').addEventListener('click',()=>hooks.cancelRecording());
    const input=$(name+'-text'),send=$(name+'-send');
    const update=()=>{
      const voice=!input.value.trim();
      send.type=voice?'button':'submit';send.setAttribute('aria-label',recording===name?'Send voice note':voice?'Record voice note':'Send message');
      send.innerHTML=`<svg><use href="#i-${voice&&recording!==name?'mic':'arrow'}"/></svg>`;
    };
    input.addEventListener('input',()=>{update();hooks.refreshControls();controls();});
    send.addEventListener('click',e=>{if(recording===name||!input.value.trim()){e.preventDefault();$(name+'-record').click();}});
    update();
  }
  function controls(){
    $('render-full').disabled=hooks.busy()||!hooks.previewReady()||!!recording;
    $('alex-photo').disabled=$('choose-photo').disabled;
    for(const name of ['alex','sam']){
      const send=$(name+'-send');
      const mode=recording===name?'check':$(name+'-text').value.trim()?'arrow':'mic';
      send.dataset.mode=mode;send.innerHTML=`<svg><use href="#i-${mode}"/></svg>`;
      if(recording===name)send.disabled=false;
      else if(!$(name+'-text').value.trim())send.disabled=$(name+'-record').disabled;
      send.setAttribute('aria-label',recording===name?'Send voice note':$(name+'-text').value.trim()?'Send message':'Record voice note');
    }
  }
  function recordingChanged(name,active,stream){
    recording=active?name:null;
    const form=$(name+'-composer');form.classList.toggle('is-recording',active);
    $(name+'-cancel-record').hidden=!active;$(name+'-waveform').hidden=!active;
    $(name+'-send').innerHTML=`<svg><use href="#i-${active?'check':$(name+'-text').value.trim()?'arrow':'mic'}"/></svg>`;
    cancelAnimationFrame(animation);source?.disconnect();source=null;analyser=null;
    if(audioContext){audioContext.close().catch(()=>{});audioContext=null;}
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(active&&Audio){
      try{
        audioContext=new Audio();analyser=audioContext.createAnalyser();analyser.fftSize=256;
        source=audioContext.createMediaStreamSource(stream);source.connect(analyser);
        audioContext.resume().catch(()=>{});
        const data=new Uint8Array(analyser.frequencyBinCount),bars=$(name+'-waveform').children;
        const paint=()=>{if(!analyser)return;analyser.getByteFrequencyData(data);for(let i=0;i<bars.length;i++)bars[i].style.height=`${4+data[i*3]/255*24}px`;animation=requestAnimationFrame(paint);};paint();
      }catch{ /* Recording can continue if visual metering is unavailable. */ }
    }
    controls();
  }
  return {controls,recordingChanged,reset(){draw=null;for(const screen of document.querySelectorAll('.viewer-open')){screen.classList.remove('viewer-open');screen.querySelector('.viewer-close').hidden=true;}$('region-progress').hidden=true;},
    progress(received,total,state='receiving'){
      const value=progressValue(received,total);$('region-progress').hidden=false;$('region-progress-meter').value=value;
      $('region-progress-text').textContent=state==='waiting'?'Waiting for a route':state==='paused'?'Paused':`${value}% received`;
    },clearProgress(){$('region-progress').hidden=true;}
  };
}
