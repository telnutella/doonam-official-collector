// Read-only public access check. No credentials, cookies, CAPTCHA handling or TLS overrides.
for(const url of ['https://www.disaster.go.th/contents/disaster_news','https://www.disaster.go.th/contents/disaster_alert_report']) {
 try {const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(25000)});const text=await r.text();console.log(JSON.stringify({source:'ddpm-public',url,status:r.status,challenge:/Just a moment|verify you are human|cf-chl-/i.test(text),renderedArticleLinks:(text.match(/href=["'][^"']*\/cms\//g)||[]).length}));}catch(e){console.log(JSON.stringify({source:'ddpm-public',url,error:String(e)}));}
}
