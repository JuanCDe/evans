import {createServer} from 'node:http';
let version=1, tracking=0;
createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1:4174');
  if(u.pathname==='/tracking'){tracking++;res.end('tracking');return;}
  if(u.pathname==='/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tracking}));return;}
  if(u.pathname==='/control'){version=Number(u.searchParams.get('v'))||1;tracking=0;res.end('ok');return;}
  if(u.pathname==='/brand-icon.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#71365e"/></svg>');return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(u.pathname==='/error'){res.writeHead(503);res.end('Temporarily unavailable');return;}
  if(u.pathname==='/empty'){res.end('<html><body></body></html>');return;}
  if(u.pathname==='/dynamic'){
    res.end(`<html><head><title>Dynamic careers</title><link rel="icon" href="/brand-icon.svg"></head><body><main id="jobs">Loading...</main><script>setTimeout(()=>document.querySelector('#jobs').textContent='Open opportunities: ${version===1?'Engineer Madrid':'Designer Barcelona'} · Apply to join our team today.',500)</script></body></html>`);return;
  }
  res.end(`<html><head><title>Static careers</title><link rel="icon" href="/brand-icon.svg"></head><body><img src="http://127.0.0.1:4174/tracking"><nav>Navigation should be ignored</nav><main id="jobs"><h1>Our open opportunities</h1><p>${version===1?'Engineer Madrid':'Engineer Madrid and Product Designer Barcelona'}</p><p hidden>Hidden job must not appear</p></main><footer>Counter ${version}</footer></body></html>`);
}).listen(4174,'127.0.0.1',()=>console.log('Fixtures: http://127.0.0.1:4174'));
