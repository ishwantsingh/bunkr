import {parseManifest} from './protocol.mjs';

export const MAX_PHOTO_UPLOAD=12*1024*1024;
const help='JPG, PNG, WebP or HEIC · up to 12 MiB';
export async function uploadPhoto(file,signal){
  const response=await fetch('/api/photo',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Could not import this photo.');
  return result;
}

export function mountPhotoImport(hooks){
  const {button,input,status}=hooks;
  let loading=false,operation=0,controller=null;
  const upload=hooks.upload||uploadPhoto;
  function controls(disabled=hooks.isBusy()){
    button.disabled=disabled||loading||!hooks.ready();input.disabled=button.disabled;
  }
  button.addEventListener('click',()=>{
    if(button.disabled)return;
    hooks.cancelAutoStart();input.value='';input.click();
  });
  input.addEventListener('change',async()=>{
    const file=input.files?.[0];
    if(!file||loading||hooks.isBusy())return;
    const version=hooks.generation(),token=++operation;
    try{
      if(!file.size||file.size>MAX_PHOTO_UPLOAD)throw Error('Choose a photo up to 12 MiB.');
      loading=true;controller=new AbortController();hooks.cancelAutoStart();hooks.setBusy(true);controls();
      status.textContent='Preparing photo…';status.classList.remove('error');
      const result=await upload(file,controller.signal);hooks.guard(version);
      if(token!==operation)return;
      const manifest=parseManifest(result.preview.manifest);
      if(manifest.imageId!==result.image_id)throw Error('Imported preview does not match this photo.');
      hooks.applyPhoto(result,file.name||'Imported photo');
      status.textContent='Ready. Send the preview across the mesh.';
    }catch(error){
      if(error.name!=='AbortError'&&token===operation){status.textContent=error.message;status.classList.add('error');}
    }finally{
      if(token===operation){loading=false;controller=null;input.value='';hooks.setBusy(false);controls();}
    }
  });
  function reset(){operation++;controller?.abort();controller=null;loading=false;input.value='';status.textContent=help;status.classList.remove('error');}
  reset();controls();
  return {controls,reset};
}
