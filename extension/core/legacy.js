// Convert legacy markup into data without creating a DOM or loading any resources.
export function legacyTokens(html) {
  const clean = String(html).replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const pieces = clean.split(/(<\/?(?:ins|del)\b[^>]*>)/gi), result = [];
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',euro:'€',bull:'•',copy:'©',reg:'®'};
  let type = 'equal';
  for(const piece of pieces) {
    if(/^<ins\b/i.test(piece)) {type='add';continue;}
    if(/^<del\b/i.test(piece)) {type='remove';continue;}
    if(/^<\/(ins|del)\s*>/i.test(piece)) {type='equal';continue;}
    const text=piece.replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(match,key)=>{
      if(key[0]!=='#')return entities[key.toLowerCase()]??match;
      const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):'�';
    });
    if(text)result.push({type,text});
  }
  return result;
}
