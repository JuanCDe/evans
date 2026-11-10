import {request} from './ui/bridge.js';
import {validUrl} from './core/model.js';
const $=s=>document.querySelector(s);
const open=url=>chrome.tabs.create({url:chrome.runtime.getURL(url)}).then(()=>window.close());
try{
  const {pages,settings}=await request('STATUS');
  const unread=pages.reduce((n,p)=>n+(p.unread||0),0);
  $('#popup-stats').textContent=`${pages.length} ${pages.length===1?'page':'pages'} · ${unread} unread ${unread===1?'change':'changes'}`;
  document.documentElement.dataset.theme=settings.theme;
}catch(e){$('#popup-stats').textContent=e.message;}
$('#open-dashboard').addEventListener('click',()=>open('index.html'));
$('#monitor-site').addEventListener('click',async()=>{
  const button=$('#monitor-site'); button.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    let url;
    try{url=validUrl(tab?.url||'');}catch{throw new Error('Open an HTTP or HTTPS page to monitor it.');}
    const params=new URLSearchParams({add:url});
    await open(`index.html?${params}`);
  }catch(e){$('#popup-message').textContent=e.message;button.disabled=false;}
});
$('#review-now').addEventListener('click',async()=>{
  const button=$('#review-now');button.disabled=true;
  try{await request('RUN');$('#popup-message').textContent='Check started. You can close this popup.';}catch(e){$('#popup-message').textContent=e.message;}finally{button.disabled=false;}
});
