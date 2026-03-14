(function(){
var allLogs=[],allNodes={},allData={},histRows=[];

window.showTab=function(n){
  document.querySelectorAll('.tc').forEach(function(e){e.classList.remove('act')});
  document.querySelectorAll('nav button').forEach(function(e){e.classList.remove('act')});
  var t=document.getElementById('tab-'+n); if(t) t.classList.add('act');
  document.querySelectorAll('nav button').forEach(function(b){
    if(b.getAttribute('onclick')==="showTab('"+n+"')") b.classList.add('act');
  });
  if(n==='logs')    loadLogs();
  if(n==='system')  loadSystem();
  if(n==='nodes')   renderNodes();
  if(n==='history') loadHistory();
};

/* \u2500\u2500 Live-Daten \u2500\u2500 */
window.loadData=function(){
  fetch(window.location.origin+'/api/data').then(function(r){return r.json()}).then(function(j){
    allData=j.data||{}; allNodes=j.nodes||{};
    var on=allData.online===1;
    document.getElementById('sdot').className='sd'+(on?' on':'');
    document.getElementById('stxt').textContent=on?'Online':'Offline';
    if(allData._ts) document.getElementById('lUpd').textContent='Aktualisiert '+new Date(allData._ts).toLocaleTimeString('de-DE');
    var b=document.getElementById('sBadge'); b.textContent=allData.status||'--'; b.className='sb'+(on?' on':'');
    function s(id,k,dec){var v=allData[k];document.getElementById(id).textContent=v!=null?(dec!=null?Number(v).toFixed(dec):v):'--';}
    s('d-acp','ac.power'); s('d-etot','energy.total'); s('d-eday','energy.today');
    s('d-s1v','pv.string1.voltage'); s('d-s1a','pv.string1.current',2);
    s('d-s2v','pv.string2.voltage'); s('d-s2a','pv.string2.current',2);
    s('d-s3v','pv.string3.voltage'); s('d-s3a','pv.string3.current',2);
    var has3=(allData['device.strings']===3);
    ['card-s3v','card-s3a'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.style.display=has3?'':'none';
    });
    s('d-l1v','ac.l1.voltage'); s('d-l1p','ac.l1.power');
    s('d-l2v','ac.l2.voltage'); s('d-l2p','ac.l2.power');
    s('d-l3v','ac.l3.voltage'); s('d-l3p','ac.l3.power');
    s('d-a1','info.analog1',2); s('d-a2','info.analog2',2); s('d-a3','info.analog3',2); s('d-a4','info.analog4',2);
    document.getElementById('d-modem').textContent=allData['info.modemStatus']||'--';
    document.getElementById('d-portal').textContent=allData['info.lastPortalConnection']||'--';
    s('d-s0','info.s0Pulses');
  }).catch(function(){});
};

/* \u2500\u2500 History \u2500\u2500 */
window.loadHistory=function(){
  fetch(window.location.origin+'/api/history').then(function(r){return r.json()}).then(function(j){
    histRows=j.rows||[];
    document.getElementById('h-cnt').textContent=j.recordCount||0;
    document.getElementById('h-ep').textContent=j.pikoEpoch?j.pikoEpoch.substring(0,10):'--';
    document.getElementById('h-li').textContent=j.lastImported?new Date(j.lastImported).toLocaleString('de-DE'):'noch kein Import';
    if(histRows.length){
      var f=histRows[histRows.length-1],l=histRows[0];
      document.getElementById('h-rng').textContent=(f.date||'').substring(0,10)+' \u2013 '+(l.date||'').substring(0,10);
    }
    renderHistTable(); renderSparklines();
  }).catch(function(){});
};

function renderHistTable(){
  var tb=document.getElementById('hTb');
  if(!histRows.length){
    tb.innerHTML='<tr><td colspan="16" style="color:var(--mut);text-align:center;padding:16px">Keine Daten</td></tr>'; return;
  }
  tb.innerHTML=histRows.slice(0,200).map(function(r){
    var dt=r.date?new Date(r.date).toLocaleString('de-DE'):'--';
    var dim=r.acTotalPower===0?'style="color:var(--mut)"':'';
    return '<tr '+dim+'><td style="font-size:11px;white-space:nowrap">'+dt+'</td>'+
      '<td style="font-weight:600">'+r.acTotalPower+'</td>'+
      '<td>'+r.dc1.voltage+'</td><td>'+r.dc1.current.toFixed(3)+'</td><td>'+r.dc1.power+'</td>'+
      '<td>'+r.dc2.voltage+'</td><td>'+r.dc2.current.toFixed(3)+'</td><td>'+r.dc2.power+'</td>'+
      '<td>'+r.ac1.voltage+'</td><td>'+r.ac1.power+'</td>'+
      '<td>'+r.ac2.voltage+'</td><td>'+r.ac2.power+'</td>'+
      '<td>'+r.ac3.voltage+'</td><td>'+r.ac3.power+'</td>'+
      '<td>'+r.frequency+'</td><td>'+r.acStatus+'</td></tr>';
  }).join('');
}

function renderSparklines(){
  var defs=[
    {id:'sp0',fn:function(r){return r.acTotalPower},color:'#f6c90e'},
    {id:'sp1',fn:function(r){return r.dc1.power},   color:'#3fb950'},
    {id:'sp2',fn:function(r){return r.dc2.power},   color:'#58a6ff'},
    {id:'sp3',fn:function(r){return r.ac1.voltage}, color:'#e3b341'},
  ];
  var sample=[].concat(histRows).reverse().slice(0,96);
  defs.forEach(function(ds){
    var cv=document.getElementById(ds.id); if(!cv) return;
    var vals=sample.map(ds.fn);
    var max=Math.max.apply(null,vals)||1;
    var min=Math.min.apply(null,vals.filter(function(v){return v>0}))||0;
    var W=cv.parentElement.clientWidth-20, H=56;
    cv.width=W; cv.height=H;
    var ctx=cv.getContext('2d'), L=vals.length;
    ctx.clearRect(0,0,W,H);
    if(L<2) return;
    ctx.beginPath();
    vals.forEach(function(v,i){
      var x=i/(L-1)*W, y=H-((v-min)/(max-min||1))*(H-4)-2;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
    ctx.fillStyle=ds.color+'25'; ctx.fill();
    ctx.beginPath();
    vals.forEach(function(v,i){
      var x=i/(L-1)*W, y=H-((v-min)/(max-min||1))*(H-4)-2;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.strokeStyle=ds.color; ctx.lineWidth=1.5; ctx.stroke();
  });
}

window.triggerSync=function(){
  var msg=document.getElementById('syncMsg');
  if(msg) msg.textContent='Sync wird gestartet...';
  fetch(window.location.origin+'/api/trigger-history').then(function(){
    if(msg) msg.textContent='Sync l\u00e4uft \u2013 neue Datenpunkte werden \u00fcbertragen. Seite in ca. 10 s neu laden.';
    setTimeout(loadHistory, 8000);
  }).catch(function(e){ if(msg) msg.textContent='Fehler: '+e.message; });
};

window.confirmSyncAll=function(){
  if(!confirm('Sync-All: Alle Datenpunkte der letzten ~6 Monate werden an InfluxDB \u00fcbertragen.\n\nDas kann je nach Datenmenge einige Minuten dauern.\n\nFortfahren?')) return;
  var msg=document.getElementById('syncMsg');
  if(msg) msg.textContent='Vollsync gestartet \u2013 bitte warten, das kann einige Minuten dauern...';
  var btn=document.getElementById('btnSyncAll');
  if(btn){ btn.disabled=true; btn.textContent='\u23F3 L\u00e4uft...'; }
  fetch(window.location.origin+'/api/sync-all').then(function(){
    if(msg) msg.textContent='Vollsync l\u00e4uft. Seite in ca. 30 s aktualisieren.';
    setTimeout(function(){
      loadHistory();
      if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
    }, 30000);
  }).catch(function(e){
    if(msg) msg.textContent='Fehler: '+e.message;
    if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
  });
};

/* \u2500\u2500 Nodes \u2500\u2500 */
window.renderNodes=function(){
  var tb=document.getElementById('nTb'), keys=Object.keys(allNodes).sort();
  if(!keys.length){tb.innerHTML='<tr><td colspan="5" style="color:var(--mut);text-align:center;padding:16px">Daten-Tab zuerst \u00f6ffnen</td></tr>';return;}
  tb.innerHTML=keys.map(function(k){
    var n=allNodes[k], v=allData[k];
    var bc=n.type==='number'?'bn':(n.type==='boolean'?'bb':'bs');
    return '<tr><td style="font-family:monospace;font-size:11px;color:var(--blu)">'+k+'</td>'+
      '<td>'+(n.name||'')+'</td>'+
      '<td><span class="badge '+bc+'">'+(n.type||'')+'</span></td>'+
      '<td style="font-weight:600">'+(v!=null?v:'<span style="color:var(--mut)">--</span>')+'</td>'+
      '<td style="color:var(--mut)">'+(n.unit||'')+'</td></tr>';
  }).join('');
};

/* \u2500\u2500 Logs \u2500\u2500 */
window.loadLogs=function(){
  fetch(window.location.origin+'/api/logs').then(function(r){return r.json()}).then(function(j){allLogs=j.logs||[];renderLogs()});
};
window.renderLogs=function(){
  var f=document.getElementById('lvlF').value, c=document.getElementById('lWrap');
  var rows=f?allLogs.filter(function(l){return l.level===f}):allLogs;
  c.innerHTML=rows.length?rows.map(function(l){
    return '<div class="le"><span class="lts">'+l.ts.replace('T',' ').substring(0,19)+'</span>'+
      '<span class="llv l'+l.level+'">'+l.level+'</span>'+
      '<span class="lm">'+l.message.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span></div>';
  }).join(''):'<div style="color:var(--mut);padding:6px">Keine Eintr\u00e4ge</div>';
  if(document.getElementById('aScrl').checked) c.scrollTop=c.scrollHeight;
};

/* \u2500\u2500 System \u2500\u2500 */
window.loadSystem=function(){
  fetch(window.location.origin+'/api/status').then(function(r){return r.json()}).then(function(s){
    function row(k,v){return '<div class="sr"><span class="sk">'+k+'</span><span class="sv">'+v+'</span></div>';}
    document.getElementById('sysInfo').innerHTML=[
      row('Adapter', s.adapter),
      row('Version', 'v'+s.version),
      row('Ziel-IP', s.ip+':'+s.port),
      row('Poll-Intervall', s.interval+' s'),
      row('Status', s.online?'<span class="sb on">Online</span>':'<span class="sb">Offline</span>'),
    ].join('');
    document.getElementById('sysHist').innerHTML=[
      row('Sync aktiviert', s.historyEnable?'<span class="chip ck">ja</span>':'<span class="chip ce">nein (in Einstellungen aktivieren)</span>'),
      row('Sync-Intervall', s.historyEnable?s.syncInterval+' Minuten':'\u2013'),
      row('InfluxDB-Instanz', '<code>'+s.influxInst+'</code>'),
      row('PIKO Inbetriebnahme', s.pikoEpoch?s.pikoEpoch.substring(0,10):'noch nicht ermittelt'),
      row('Letzter Sync', s.lastImported?new Date(s.lastImported).toLocaleString('de-DE'):'noch kein Sync'),
    ].join('');
  });
};

/* \u2500\u2500 Auto-Refresh \u2500\u2500 */
function tick(){
  var a=document.querySelector('.tc.act');
  if(!a) return;
  if(a.id==='tab-daten')   loadData();
  if(a.id==='tab-logs')    loadLogs();
  if(a.id==='tab-history') loadHistory();
}
loadData(); loadLogs();
setInterval(tick,15000);
})();