(function(){
var allLogs=[],allNodes={},allData={},histRows=[],histStringCfg={enabled:false,strings:[]};
var liveStringCfg={enabled:false,strings:[]};
var liveTempCfg={enabled:false,strings:[],system:null};
var liveInvSpecs={enabled:false};
var histLastCount=0,histStringCount=2;
var chartInstances={};
var yieldsData=null;
var yieldsChartUnit='mwh';
var yieldsChartYears=null;
var YIELD_COLORS=['#58a6ff','#3fb950','#e3b341','#f85149','#a371f7','#79c0ff','#56d364','#ffa657','#ff7b72','#d2a8ff','#7ee787','#e6edf3'];

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
  if(n==='history') loadHistory(true);
  if(n==='yields')  loadYields();
};

/* ── Chart.js Theme ── */
function initChartTheme(){
  if(typeof Chart==='undefined') return;
  Chart.defaults.color='#8b949e';
  Chart.defaults.borderColor='rgba(48,54,61,.8)';
  Chart.defaults.font.family="'Segoe UI',system-ui,sans-serif";
  Chart.defaults.font.size=11;
  Chart.defaults.plugins.legend.display=false;
  Chart.defaults.plugins.tooltip.backgroundColor='rgba(22,27,34,.95)';
  Chart.defaults.plugins.tooltip.borderColor='#30363d';
  Chart.defaults.plugins.tooltip.borderWidth=1;
  Chart.defaults.plugins.tooltip.titleColor='#e6edf3';
  Chart.defaults.plugins.tooltip.bodyColor='#8b949e';
  Chart.defaults.plugins.tooltip.padding=10;
  Chart.defaults.elements.point.radius=0;
  Chart.defaults.elements.point.hoverRadius=4;
  Chart.defaults.elements.line.borderWidth=2;
  Chart.defaults.elements.line.tension=0.25;
}

function destroyCharts(){
  Object.keys(chartInstances).forEach(function(k){
    if(chartInstances[k]){chartInstances[k].destroy();chartInstances[k]=null;}
  });
}

function tsOpt(mode){
  var isDay=mode==='day';
  return {
    type:'time',
    time:{
      unit:isDay?'hour':'day',
      displayFormats:{hour:'HH:mm',day:'dd.MM',week:'dd.MM',month:'MMM yy'},
      tooltipFormat:isDay?'dd.MM.yyyy HH:mm':'dd.MM.yyyy'
    },
    grid:{color:'rgba(48,54,61,.5)'},
    ticks:{maxTicksLimit:isDay?12:8,color:'#8b949e'}
  };
}

function valOpt(label,unit,color){
  return {
    display:true,
    position:'left',
    title:{display:!!label,text:label||'',color:'#8b949e',font:{size:10}},
    grid:{color:'rgba(48,54,61,.35)'},
    ticks:{
      color:color||'#8b949e',
      callback:function(v){return unit?v+unit:v;}
    }
  };
}

function makeChart(id,cfg){
  if(typeof Chart==='undefined') return null;
  var el=document.getElementById(id);
  if(!el) return null;
  if(chartInstances[id]){chartInstances[id].destroy();}
  chartInstances[id]=new Chart(el,cfg);
  return chartInstances[id];
}

function rowTs(r){return r.date?new Date(r.date).getTime():r.ts;}

function dcPower(r,n){
  var d=r['dc'+n];
  return d&&d.power?d.power:0;
}
function dcVolt(r,n){
  var d=r['dc'+n];
  return d&&d.voltage?d.voltage:0;
}
function dcCurr(r,n){
  var d=r['dc'+n];
  return d&&d.current?d.current:0;
}

/* ── Live-Daten ── */
window.loadData=function(){
  fetch(window.location.origin+'/api/data').then(function(r){return r.json()}).then(function(j){
    allData=j.data||{}; allNodes=j.nodes||{};
    liveStringCfg=j.stringAnalysis||{enabled:false,strings:[]};
    liveTempCfg=j.temperatureAnalysis||{enabled:false,strings:[],system:null};
    liveInvSpecs=j.inverterSpecs||{enabled:false};
    var on=allData.online===1;
    document.getElementById('sdot').className='sd'+(on?' on':'');
    document.getElementById('stxt').textContent=on?'Online':'Offline';
    if(allData._ts) document.getElementById('lUpd').textContent='Aktualisiert '+new Date(allData._ts).toLocaleTimeString('de-DE');
    var b=document.getElementById('sBadge'); b.textContent=allData.status||'--'; b.className='sb'+(on?' on':'');
    function s(id,k,dec){var v=allData[k];document.getElementById(id).textContent=v!=null?(dec!=null?Number(v).toFixed(dec):v):'--';}
    s('d-acp','ac.power'); s('d-etot','energy.total'); s('d-eday','energy.today');
    s('d-dcp','dc.totalPower',0);
    var eff=allData['efficiency.ratio'];
    var effExp=allData['efficiency.expected'];
    var effEl=document.getElementById('d-eff');
    if(effEl) effEl.textContent=(eff>0)?Number(eff).toFixed(1):'--';
    var effHint=document.getElementById('d-eff-hint');
    if(effHint) effHint.textContent=effExp>0?'Soll ~'+Number(effExp).toFixed(1)+' %':'DC \u2192 AC';
    s('d-s1v','pv.string1.voltage',0); s('d-s1a','pv.string1.current',2);
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
    renderStringAnalysis();
    renderTemperatureAnalysis();
    renderInvSpecsCard(liveInvSpecs);
    renderWeatherCard(j.weather);
    document.getElementById('d-portal').textContent=allData['info.lastPortalConnection']||'--';
    s('d-s0','info.s0Pulses');
    var mdl=document.getElementById('d-model');
    if(mdl) mdl.textContent=allData['device.model']||'PIKO';
  }).catch(function(){});
};

/* ── History Navigation ── */
var navViewMode='day';
var navOffset=0;

function navGetRange(){
  var now=new Date(); now.setHours(0,0,0,0);
  var from=new Date(now), to=new Date(now);
  if(navViewMode==='day'){
    from.setDate(from.getDate()+navOffset);
    to=new Date(from); to.setDate(to.getDate()+1);
  } else if(navViewMode==='week'){
    var dow=now.getDay(); var mon=dow===0?6:dow-1;
    from.setDate(now.getDate()-mon+navOffset*7);
    to=new Date(from); to.setDate(to.getDate()+7);
  } else {
    from.setDate(1); from.setMonth(from.getMonth()+navOffset);
    to=new Date(from); to.setMonth(to.getMonth()+1);
  }
  return {from:from,to:to};
}

function navLabel(range){
  var f=range.from, t=new Date(range.to); t.setDate(t.getDate()-1);
  if(navViewMode==='day') return f.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  if(navViewMode==='week') return f.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+' – '+t.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  return f.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
}

function navFilter(rows){
  var r=navGetRange();
  var fromMs=r.from.getTime(), toMs=r.to.getTime();
  return rows.filter(function(row){
    var ts=row.date?new Date(row.date).getTime():row.ts||0;
    return ts>=fromMs && ts<toMs;
  });
}

window.navMode=function(m){
  navViewMode=m; navOffset=0;
  ['day','week','month'].forEach(function(k){
    var b=document.getElementById('nb-'+k);
    if(b) b.className='nav-btn'+(m===k?' active':'');
  });
  renderNavView();
};

window.navShift=function(d){
  navOffset+=d;
  if(navOffset>0) navOffset=0;
  renderNavView();
};

function voltColor(voltage,cfg){
  if(!cfg||!voltage||cfg.mppMin==null) return 'var(--txt)';
  if(voltage>=cfg.mppMin&&voltage<=cfg.mppMax) return 'var(--grn)';
  if(voltage>=cfg.mppMin*0.93&&voltage<=cfg.mppMax*1.04) return 'var(--orn)';
  return 'var(--red)';
}

function voltStatus(voltage,cfg){
  if(!cfg||!voltage||cfg.mppMin==null) return {pct:0,label:'--',color:'var(--mut)'};
  var mid=(cfg.mppMin+cfg.mppMax)/2;
  var pct=Math.round(voltage/mid*100);
  var color=voltColor(voltage,cfg);
  var label=pct+'%';
  if(voltage>=cfg.mppMin&&voltage<=cfg.mppMax) label+=' im MPP-Korridor';
  else if(voltage<cfg.mppMin) label+=' unter Korridor';
  else label+=' über Korridor';
  return {pct:pct,label:label,color:color};
}

function tempColor(t){
  if(t==null||isNaN(t)) return 'var(--mut)';
  if(t<35) return '#3fb950';
  if(t<50) return '#e3b341';
  if(t<60) return '#f0883e';
  if(t<70) return '#f85149';
  return '#ff0000';
}

function tempAlertIcon(alert){
  if(alert==='NORMAL') return '\ud83d\udfe2';
  if(alert==='WARM') return '\ud83d\udfe1';
  if(alert==='HEISS') return '\ud83d\udfe0';
  if(alert==='WARNUNG') return '\ud83d\udd34';
  if(alert==='KRITISCH') return '\u26d4';
  return '\u2013';
}

function calcHistTemp(vString, modules, vmppStc, betaVmpp){
  if(!vString||!modules||!vmppStc) return null;
  var beta=Math.abs(betaVmpp||0.0045);
  var vmppMod=vString/modules;
  return Math.round((25+(vmppStc-vmppMod)/(vmppStc*beta))*10)/10;
}

function calcHistTempPoint(r, cfg, histCfg){
  var d=r['dc'+cfg.id];
  if(!d||!d.voltage||!d.current) return null;
  var p=d.voltage*d.current;
  if((r.acTotalPower||0)<50) return null;
  var vmppStc=cfg.vmppStc||histCfg.vmpp;
  var mppUtil=vmppStc?Math.round((d.voltage/cfg.modules)/vmppStc*1000)/10:null;
  var coolModule=mppUtil!=null&&mppUtil>=97;
  if(!coolModule&&p<50) return null;
  if(coolModule&&p<10) return null;
  var t=calcHistTemp(d.voltage,cfg.modules,vmppStc,cfg.betaVmpp||histCfg.betaVmpp);
  if(t==null) return null;
  var imppStr=cfg.imppString||0;
  if(imppStr>0&&d.current/imppStr<0.01) return null;
  return t;
}

function tempQualityLabel(q){
  if(q==='ABSOLUT') return {text:'\u2713 absolut valide',color:'var(--grn)'};
  if(q==='EINGESCHRAENKT') return {text:'~ eingeschr\u00e4nkt',color:'var(--orn)'};
  return {text:'\u00d7 ung\u00fcltig',color:'var(--mut)'};
}

function invLimitWarnings(vMin,vMax,current,cfg){
  var w=[];
  if(!cfg||!vMax) return w;
  if(cfg.invDcMaxV&&vMax>cfg.invDcMaxV) w.push('Spitze '+vMax+'V > Udcmax '+cfg.invDcMaxV+'V');
  if(cfg.invDcMinV&&current>0.1&&vMin<cfg.invDcMinV) w.push('Minimum '+vMin+'V < Udcmin '+cfg.invDcMinV+'V');
  if(cfg.invDcMaxA&&current>cfg.invDcMaxA) w.push('I > Idmax '+cfg.invDcMaxA+'A');
  return w;
}

function renderStringCard(cfg,volts,currs,titlePrefix){
  if(!volts.length){
    return '<div class="vc"><div class="vl">'+titlePrefix+cfg.id+'</div><div style="color:var(--mut);font-size:12px;margin-top:4px">Keine Erzeugung im Zeitraum</div></div>';
  }
  var vMin=Math.min.apply(null,volts), vMax=Math.max.apply(null,volts);
  var vAvg=Math.round(volts.reduce(function(a,b){return a+b;},0)/volts.length);
  var vPerMod=(vAvg/cfg.modules).toFixed(1);
  var iMax=currs.length?Math.max.apply(null,currs):0;
  var invW=invLimitWarnings(vMin,vMax,iMax,cfg);
  var ok=0;
  volts.forEach(function(v){if(v>=cfg.mppMin&&v<=cfg.mppMax) ok++;});
  var okPct=Math.round(ok/volts.length*100);
  var st=voltStatus(vAvg,cfg);
  var invLine='';
  if(cfg.invDcMaxA||cfg.invMppMin){
    invLine='<div style="font-size:10px;color:var(--mut);margin-top:2px">WR-Grenzen (Sicherheit): U '+cfg.invDcMinV+'–'+cfg.invDcMaxV+'V · I<sub>max</sub> '+cfg.invDcMaxA+'A · MPP '+cfg.invMppMin+'–'+cfg.invMppMax+'V = Nennleistungsbereich</div>';
  }
  var warnLine=invW.length?'<div style="font-size:10px;color:var(--red);margin-top:2px">⚠ '+invW.join(' · ')+'</div>':'';
  return '<div class="vc">'+
    '<div class="vl">'+titlePrefix+cfg.id+' ('+cfg.modules+' Module)</div>'+
    '<div style="font-size:13px;font-weight:700;margin:4px 0">'+
      '<span style="color:'+st.color+'">'+vMin+'–'+vMax+'</span> V '+
      '<span style="color:var(--mut);font-weight:400">(Ø '+vAvg+' · '+vPerMod+' V/Mod)</span></div>'+
    '<div style="font-size:11px;color:var(--mut)">MPP-Korridor: '+cfg.mppMin+'–'+cfg.mppMax+' V · '+okPct+'% im Bereich</div>'+
    '<div style="font-size:11px;color:var(--mut)">I<sub>max</sub>: '+iMax.toFixed(2)+' A · Nenn: '+cfg.expectedPower+' Wp · Soll-MPP: '+cfg.expectedMpp+' V</div>'+
    invLine+warnLine+
    '</div>';
}

function getStringCfg(id){
  if(!histStringCfg.enabled) return null;
  for(var i=0;i<histStringCfg.strings.length;i++){
    if(histStringCfg.strings[i].id===id) return histStringCfg.strings[i];
  }
  return null;
}

function calcPeriodStats(rows){
  if(!rows.length) return null;
  var sorted=rows.slice().sort(function(a,b){return rowTs(a)-rowTs(b);});
  var peak=sorted[0], peakW=0, peakTs=0;
  var prod=[], maxDc=0, energyStart=null, energyEnd=null;
  sorted.forEach(function(r){
    if(r.acTotalPower>peakW){peakW=r.acTotalPower;peak=r;peakTs=rowTs(r);}
    if(r.acTotalPower>=50) prod.push(r);
    var dcSum=dcPower(r,1)+dcPower(r,2)+dcPower(r,3);
    if(dcSum>maxDc) maxDc=dcSum;
    if(r.totalEnergy>0){
      if(energyStart===null) energyStart=r.totalEnergy;
      energyEnd=r.totalEnergy;
    }
  });
  var yieldKwh=0;
  if(energyStart!==null&&energyEnd!==null&&energyEnd>energyStart){
    yieldKwh=Math.round((energyEnd-energyStart)*100)/100;
  } else {
    yieldKwh=Math.round(sorted.reduce(function(s,r){return s+(r.acTotalPower||0)*0.25;},0))/1000;
  }
  var avgW=prod.length?Math.round(prod.reduce(function(s,r){return s+r.acTotalPower;},0)/prod.length):0;
  return {
    peakW:peakW,
    peakTime:peakTs?new Date(peakTs).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'--',
    yieldKwh:yieldKwh,
    avgW:avgW,
    maxDc:maxDc,
    points:sorted.length,
    energyEnd:energyEnd
  };
}

function renderKpis(stats){
  if(!stats){
    ['kpi-peak','kpi-yield','kpi-avg','kpi-dc','kpi-pts','kpi-energy'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.textContent='--';
    });
    var pt=document.getElementById('kpi-peak-t'); if(pt) pt.textContent='--';
    return;
  }
  document.getElementById('kpi-peak').textContent=stats.peakW+' W';
  document.getElementById('kpi-peak-t').textContent='um '+stats.peakTime;
  document.getElementById('kpi-yield').textContent=stats.yieldKwh.toFixed(2);
  document.getElementById('kpi-avg').textContent=stats.avgW+' W';
  document.getElementById('kpi-dc').textContent=stats.maxDc+' W';
  document.getElementById('kpi-pts').textContent=stats.points;
  document.getElementById('kpi-energy').textContent=stats.energyEnd!=null?stats.energyEnd.toFixed(1):'--';
}

function dsLine(rows,fn,color,label,yAxis){
  return {
    label:label,
    data:rows.map(function(r){return {x:rowTs(r),y:fn(r)};}),
    borderColor:color,
    backgroundColor:color+'22',
    fill:false,
    yAxisID:yAxis||'y',
    spanGaps:true
  };
}

function renderCharts(filtered,range){
  if(typeof Chart==='undefined'){
    var hint=document.getElementById('cache-hint');
    if(hint){hint.style.display='';hint.textContent='Chart.js nicht geladen – CDN prüfen';}
    return;
  }
  var sorted=filtered.slice().sort(function(a,b){return rowTs(a)-rowTs(b);});
  var has3=histStringCount>=3;
  var titleEl=document.getElementById('chart-main-title');
  if(titleEl) titleEl.textContent='Leistung & Erzeugung – '+navLabel(range);

  var mainDs=[
    dsLine(sorted,function(r){return r.acTotalPower;},'#f6c90e','AC Gesamt','y'),
    dsLine(sorted,function(r){return dcPower(r,1)+dcPower(r,2)+dcPower(r,3);},'#3fb950','DC Summe','y')
  ];
  makeChart('chart-main',{
    type:'line',
    data:{datasets:mainDs},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('W','','#f6c90e')}
    }
  });

  makeChart('chart-phases',{
    type:'line',
    data:{datasets:[
      dsLine(sorted,function(r){return r.ac1.power;},'#e3b341','L1','y'),
      dsLine(sorted,function(r){return r.ac2.power;},'#58a6ff','L2','y'),
      dsLine(sorted,function(r){return r.ac3.power;},'#a371f7','L3','y')
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('W','','#e3b341')}
    }
  });

  var dcDs=[
    dsLine(sorted,function(r){return dcPower(r,1);},'#3fb950','String 1','y'),
    dsLine(sorted,function(r){return dcPower(r,2);},'#58a6ff','String 2','y')
  ];
  if(has3) dcDs.push(dsLine(sorted,function(r){return dcPower(r,3);},'#a371f7','String 3','y'));
  makeChart('chart-dc-power',{
    type:'line',data:{datasets:dcDs},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('W','','#3fb950')}}
  });

  var voltDs=[
    dsLine(sorted,function(r){return dcVolt(r,1);},'#3fb950','S1 U','y'),
    dsLine(sorted,function(r){return dcVolt(r,2);},'#58a6ff','S2 U','y')
  ];
  if(has3) voltDs.push(dsLine(sorted,function(r){return dcVolt(r,3);},'#a371f7','S3 U','y'));
  makeChart('chart-dc-voltage',{
    type:'line',data:{datasets:voltDs},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('V','','#3fb950')}}
  });

  var tempBox=document.getElementById('chart-temp-box');
  if(tempBox){
    if(!histStringCfg.enabled||!histStringCfg.strings.length){
      tempBox.style.display='none';
    } else {
      tempBox.style.display='';
      var prod=sorted.filter(function(r){return r.acTotalPower>=50;});
      var tempDs=histStringCfg.strings.map(function(cfg,idx){
        var colors=['#58a6ff','#3fb950','#a371f7'];
        return {
          label:'String '+cfg.id+' Temp.',
          data:prod.map(function(r){
            return {x:rowTs(r),y:calcHistTempPoint(r,cfg,histStringCfg)};
          }),
          borderColor:colors[idx%3],
          backgroundColor:colors[idx%3]+'22',
          fill:false,
          yAxisID:'y',
          spanGaps:true,
          tension:0.15
        };
      });
      tempDs.push({
        label:'AC Leistung',
        data:sorted.map(function(r){return {x:rowTs(r),y:r.acTotalPower||0};}),
        borderColor:'#f6c90e88',
        backgroundColor:'#f6c90e22',
        fill:true,
        yAxisID:'y2',
        spanGaps:true
      });
      makeChart('chart-temp',{
        type:'line',
        data:{datasets:tempDs},
        options:{
          responsive:true,maintainAspectRatio:false,
          interaction:{mode:'index',intersect:false},
          scales:{
            x:tsOpt(navViewMode),
            y:valOpt('\u00b0C','','#58a6ff'),
            y2:{position:'right',grid:{drawOnChartArea:false},ticks:{color:'#f6c90e'},title:{display:true,text:'W',color:'#f6c90e'}}
          }
        }
      });
    }
  }

  makeChart('chart-grid',{
    type:'line',
    data:{datasets:[
      dsLine(sorted,function(r){return r.ac1.voltage;},'#e3b341','L1 U','y'),
      dsLine(sorted,function(r){return r.frequency;},'#a371f7','Hz','y1')
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{
        x:tsOpt(navViewMode),
        y:valOpt('V','','#e3b341'),
        y1:{position:'right',title:{display:true,text:'Hz',color:'#a371f7'},grid:{drawOnChartArea:false},ticks:{color:'#a371f7'}}
      }
    }
  });

  var energyRows=sorted.filter(function(r){return r.totalEnergy>0;});
  makeChart('chart-energy',{
    type:'line',
    data:{datasets:[dsLine(energyRows,function(r){return r.totalEnergy;},'#58a6ff','Gesamt kWh','y')]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      scales:{x:tsOpt(navViewMode),y:valOpt('kWh','','#58a6ff')}}
  });
}

function renderInvSpecsCard(inv){
  var card=document.getElementById('inv-specs-card');
  if(!card) return;
  if(!inv||!inv.enabled){ card.style.display='none'; return; }
  card.style.display='';
  var g=inv.grid||{};
  document.getElementById('inv-specs-body').innerHTML=
    '<div class="grid g4">'+
    '<div class="vc"><div class="vl">Modell</div><div class="vv" style="font-size:16px">'+inv.modelName+'</div><div class="vu">Nenn '+inv.pacNom+' W</div></div>'+
    '<div class="vc"><div class="vl">DC Eingang</div><div class="vv" style="font-size:14px">'+inv.dcMinV+'–'+inv.dcMaxV+' V</div><div class="vu">MPP '+inv.mppMinActive+'–'+inv.mppMax+' V · I<sub>max</sub> '+inv.dcMaxA+' A/String</div></div>'+
    '<div class="vc"><div class="vl">AC Netz (DE)</div><div class="vv" style="font-size:14px">'+g.acMinV+'–'+g.acMaxV+' V</div><div class="vu">'+g.fMin+'–'+g.fMax+' Hz</div></div>'+
    '<div class="vc"><div class="vl">Nenn-DC</div><div class="vv" style="font-size:14px">'+inv.udcNom+' V</div><div class="vu">laut Kostal-Datenblatt</div></div>'+
    '</div>';
}

function renderWeatherCard(w){
  var card=document.getElementById('weather-card');
  if(!card) return;
  if(!w||!w.plz){ card.style.display='none'; return; }
  card.style.display='';
  var loc=document.getElementById('w-loc');
  if(loc) loc.textContent='('+w.plz+' '+w.place+(w.state?', '+w.state:'')+')';
  var sun=document.getElementById('w-sun');
  if(sun) sun.textContent=w.sunshineH!=null?w.sunshineH.toLocaleString('de-DE'):'–';
  var desc=document.getElementById('w-desc');
  if(desc) desc.textContent=w.weather||'–';
  var temp=document.getElementById('w-temp');
  if(temp) temp.textContent=w.tempMax!=null?'max. '+w.tempMax.toLocaleString('de-DE')+' °C':'';
  var cloud=document.getElementById('w-cloud');
  if(cloud) cloud.textContent=w.cloudPct!=null?w.cloudPct:'–';
  var rain=document.getElementById('w-rain');
  if(rain){
    var parts=[];
    if(w.precipMm!=null) parts.push(w.precipMm.toLocaleString('de-DE')+' mm');
    if(w.precipCurrent!=null&&w.precipCurrent>0) parts.push('jetzt '+w.precipCurrent.toLocaleString('de-DE')+' mm/h');
    if(w.precipForecast!=null&&w.precipForecast>0) parts.push('Prognose '+w.precipForecast.toLocaleString('de-DE')+' mm');
    rain.textContent=parts.length?parts.join(' · '):'–';
  }
  var src=document.getElementById('w-src');
  if(src&&w.updatedAt){
    src.textContent='Quelle: '+w.source+' · Aktualisiert '+new Date(w.updatedAt).toLocaleTimeString('de-DE');
  }
}

function renderHistStringAnalysis(filtered){
  var card=document.getElementById('hsa-card');
  var grid=document.getElementById('hsa-grid');
  if(!card||!grid||!histStringCfg.enabled){
    if(card) card.style.display='none';
    return;
  }
  card.style.display='';
  var prod=filtered.filter(function(r){return r.acTotalPower>=50;});
  grid.innerHTML=histStringCfg.strings.map(function(cfg){
    var key='dc'+cfg.id;
    var volts=prod.map(function(r){return r[key]&&r[key].voltage?r[key].voltage:0;}).filter(function(v){return v>0;});
    var currs=prod.map(function(r){return r[key]&&r[key].current?r[key].current:0;}).filter(function(v){return v>0;});
    return renderStringCard(cfg,volts,currs,'String ');
  }).join('');
}

function renderNavView(){
  var range=navGetRange();
  var lbl=document.getElementById('nav-label');
  if(lbl) lbl.textContent=navLabel(range);
  var nxt=document.getElementById('nav-next');
  if(nxt) nxt.disabled=(navOffset>=0);
  var filtered=navFilter(histRows);
  var stats=calcPeriodStats(filtered);
  renderKpis(stats);
  renderCharts(filtered,range);
  renderHistStringAnalysis(filtered);
  renderHistTable(filtered);
  toggleDc3Columns(histStringCount>=3);
  updateStaleHint(filtered);
}

function updateStaleHint(filtered){
  var cacheHint=document.getElementById('cache-hint');
  if(!cacheHint) return;
  if(navOffset!==0 || navViewMode!=='day' || !filtered.length){
    if(!cacheHint.dataset.loading) cacheHint.style.display='none';
    return;
  }
  var sorted=filtered.slice().sort(function(a,b){return rowTs(a)-rowTs(b);});
  var lastTs=rowTs(sorted[sorted.length-1]);
  var ageMin=Math.round((Date.now()-lastTs)/60000);
  if(ageMin>20){
    var lastTime=new Date(lastTs).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    cacheHint.style.display='';
    cacheHint.textContent='\u26a0 Letzter Messpunkt um '+lastTime+' (vor '+ageMin+' Min) – Nachhol-Abruf vom PIKO läuft automatisch.';
  } else if(!cacheHint.dataset.loading){
    cacheHint.style.display='none';
  }
}

function toggleDc3Columns(show){
  ['th-dc3-1','th-dc3-2','th-dc3-3'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.style.display=show?'':'none';
  });
}

var histLoadTimer=null;
var histStaleFetchTimer=null;
window.loadHistory=function(keepNav){
  var li=document.getElementById('h-li');
  if(li&&(!keepNav||li.textContent==='--')) li.textContent='Lade…';
  fetch(window.location.origin+'/api/history').then(function(r){return r.json();}).then(function(j){
    if(j.loading && (!j.rows||j.rows.length===0)){
      if(li) li.textContent='Lade Historiendaten… (bitte warten)';
      if(!histLoadTimer) histLoadTimer=setTimeout(function(){histLoadTimer=null;loadHistory(true);},3000);
      return;
    }
    if(histLoadTimer){clearTimeout(histLoadTimer);histLoadTimer=null;}
    histStringCfg=j.stringAnalysis||{enabled:false,strings:[]};
    histStringCount=j.stringCount||2;
    var newCount=j.recordCount||0;
    var dataChanged=(newCount!==histLastCount);
    histLastCount=newCount;
    histRows=j.rows||[];
    document.getElementById('h-cnt').textContent=newCount||histRows.length;
    document.getElementById('h-ep').textContent=j.pikoEpoch?j.pikoEpoch.substring(0,10):'--';
    document.getElementById('h-li').textContent=j.lastImported?new Date(j.lastImported).toLocaleString('de-DE'):'noch kein Import';
    if(histRows.length){
      var f=histRows[histRows.length-1],l=histRows[0];
      document.getElementById('h-rng').textContent=(f.date||'').substring(0,10)+' – '+(l.date||'').substring(0,10);
    } else {
      document.getElementById('h-rng').textContent='Keine Daten';
    }
    var cacheHint=document.getElementById('cache-hint');
    if(cacheHint){
      if(j.loading&&histRows.length){
        cacheHint.style.display='';
        cacheHint.dataset.loading='1';
        cacheHint.textContent='\u23f3 Aktualisiere vom PIKO\u2026 (Cache-Daten werden angezeigt)';
      } else {
        delete cacheHint.dataset.loading;
        cacheHint.style.display='none';
      }
    }
    if(!keepNav){
      navOffset=0; navViewMode='day';
      ['day','week','month'].forEach(function(k){
        var b=document.getElementById('nb-'+k);
        if(b) b.className='nav-btn'+(k==='day'?' active':'');
      });
    }
    renderNavView();
    if(j.todayStale && !j.loading && navOffset===0 && navViewMode==='day' && !histStaleFetchTimer){
      histStaleFetchTimer=setTimeout(function(){
        histStaleFetchTimer=null;
        var msg=document.getElementById('histSyncMsg');
        if(msg) msg.textContent='\u23f3 Tagesdaten veraltet – hole LogDaten.dat vom PIKO…';
        fetch(window.location.origin+'/api/trigger-history').then(function(){
          setTimeout(function(){loadHistory(true);},6000);
        }).catch(function(){});
      },1500);
    }
    if(dataChanged&&keepNav){
      var msg=document.getElementById('histSyncMsg');
      if(msg) msg.textContent='✓ Neue Daten geladen ('+newCount+' Punkte)';
    }
  }).catch(function(){
    if(li) li.textContent='Fehler beim Laden';
  });
};

function cellStyle(voltage,cfg,active){
  if(!cfg||!active||!voltage) return '';
  return 'color:'+voltColor(voltage,cfg)+';font-weight:600';
}

function renderHistTable(rows){
  var tb=document.getElementById('hTb');
  var r=rows||histRows;
  var has3=histStringCount>=3;
  var cols=has3?22:19;
  if(!r.length){
    tb.innerHTML='<tr><td colspan="'+cols+'" style="color:var(--mut);text-align:center;padding:16px">Keine Daten für diesen Zeitraum</td></tr>'; return;
  }
  var rev=r.slice().sort(function(a,b){return rowTs(b)-rowTs(a);});
  tb.innerHTML=rev.map(function(row){
    var dt=row.date?new Date(row.date).toLocaleString('de-DE'):'--';
    var dim=row.acTotalPower===0?'style="color:var(--mut)"':'';
    var active=row.acTotalPower>=50;
    var c1=getStringCfg(1), c2=getStringCfg(2), c3=getStringCfg(3);
    var u1s=cellStyle(row.dc1.voltage,c1,active);
    var u2s=cellStyle(row.dc2.voltage,c2,active);
    var u3s=has3?cellStyle(row.dc3&&row.dc3.voltage,c3,active):'';
    var i1s=active&&c1&&row.dc1.current?'color:'+voltColor(row.dc1.voltage,c1)+';font-weight:600':'';
    var i2s=active&&c2&&row.dc2.current?'color:'+voltColor(row.dc2.voltage,c2)+';font-weight:600':'';
    var dc3=row.dc3||{voltage:0,current:0,power:0};
    var err=row.errorCode?('<span style="color:var(--red)">'+row.errorCode+'</span>'):'–';
    var rowHtml='<tr '+dim+'><td style="font-size:11px;white-space:nowrap">'+dt+'</td>'+
      '<td style="font-weight:600">'+row.acTotalPower+'</td>'+
      '<td style="'+u1s+'">'+row.dc1.voltage+'</td><td style="'+i1s+'">'+row.dc1.current.toFixed(3)+'</td><td>'+row.dc1.power+'</td>'+
      '<td style="'+u2s+'">'+row.dc2.voltage+'</td><td style="'+i2s+'">'+row.dc2.current.toFixed(3)+'</td><td>'+row.dc2.power+'</td>';
    if(has3){
      rowHtml+='<td style="'+u3s+'">'+dc3.voltage+'</td><td>'+dc3.current.toFixed(3)+'</td><td>'+dc3.power+'</td>';
    }
    rowHtml+='<td>'+row.ac1.voltage+'</td><td>'+row.ac1.power+'</td>'+
      '<td>'+row.ac2.voltage+'</td><td>'+row.ac2.power+'</td>'+
      '<td>'+row.ac3.voltage+'</td><td>'+row.ac3.power+'</td>'+
      '<td>'+row.frequency+'</td>'+
      '<td>'+(row.totalEnergy?row.totalEnergy.toFixed(1):'–')+'</td>'+
      '<td>'+row.acStatus+'</td><td>'+err+'</td></tr>';
    return rowHtml;
  }).join('');
}

function histMsg(text){
  var msg=document.getElementById('histSyncMsg')||document.getElementById('syncMsg');
  if(msg) msg.textContent=text;
}

window.triggerSync=function(){
  histMsg('⏳ Hole LogDaten.dat vom PIKO…');
  fetch(window.location.origin+'/api/trigger-history').then(function(){
    setTimeout(function(){loadHistory(true);},4000);
    setTimeout(function(){loadHistory(true);},10000);
    setTimeout(function(){histMsg('✓ PIKO-Abruf gestartet – Anzeige wird automatisch aktualisiert');},500);
    setTimeout(function(){histMsg('');},15000);
  }).catch(function(e){ histMsg('Fehler: '+e.message); });
};

window.confirmSyncAll=function(){
  if(!confirm('Sync-All: Alle Datenpunkte der letzten ~6 Monate werden an InfluxDB \u00fcbertragen.\n\nDas kann je nach Datenmenge einige Minuten dauern.\n\nFortfahren?')) return;
  histMsg('Vollsync gestartet \u2013 bitte warten, das kann einige Minuten dauern...');
  var btn=document.getElementById('btnSyncAll');
  if(btn){ btn.disabled=true; btn.textContent='\u23F3 L\u00e4uft...'; }
  fetch(window.location.origin+'/api/sync-all').then(function(){
    histMsg('Vollsync l\u00e4uft. Anzeige wird in ca. 30 s aktualisiert.');
    setTimeout(function(){
      loadHistory(true);
      if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
      histMsg('');
    }, 30000);
  }).catch(function(e){
    histMsg('Fehler: '+e.message);
    if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
  });
};

/* ── Nodes ── */
window.renderStringAnalysis=function(){
  var cfg=liveStringCfg.enabled?liveStringCfg:{enabled:false,strings:[]};
  var strings=['1','2','3'];
  var hasAny=false;
  strings.forEach(function(n){
    var scfg=null;
    for(var i=0;i<cfg.strings.length;i++){if(String(cfg.strings[i].id)===n) scfg=cfg.strings[i];}
    var av=allData['pv.string'+n+'.voltage'];
    var ai=allData['pv.string'+n+'.current'];
    var ep=allData['string'+n+'.expectedPower'];
    var box=document.getElementById('sa-'+n);
    if(!box) return;
    if(!scfg||!ep||!av){box.style.display='none';return;}
    hasAny=true;
    box.style.display='';
    var st=voltStatus(av,scfg);
    var vPerMod=scfg.modules?(av/scfg.modules).toFixed(1):'--';
    var pEst=av&&ai?Math.round(av*ai):'--';
    var invW=invLimitWarnings(av,av,ai||0,scfg);
    var invHint='';
    if(scfg.invDcMaxA){
      invHint='<div style="font-size:10px;color:var(--mut)">WR (Sicherheit): U '+scfg.invDcMinV+'–'+scfg.invDcMaxV+'V · I<sub>max</sub> '+scfg.invDcMaxA+'A</div>';
    }
    var warnLine=invW.length?'<div style="font-size:10px;color:var(--red)">⚠ '+invW.join(' · ')+'</div>':'';
    box.innerHTML='<div class="vl">String '+n+' ('+scfg.modules+' Module)</div>'+
      '<div style="font-size:13px;font-weight:700;margin:3px 0">'+
        '<span style="color:'+st.color+'">'+(av||'--')+'</span>'+
        ' / <span style="color:var(--mut)">'+scfg.expectedMpp+'</span> V MPP</div>'+
      '<div style="font-size:10px;color:var(--mut)">'+vPerMod+' V/Mod · ~'+pEst+' W · Nenn '+ep+' Wp</div>'+
      '<div style="font-size:10px;color:var(--mut)">Korridor: '+scfg.mppMin+'–'+scfg.mppMax+' V (Vmpp-basiert)</div>'+
      invHint+warnLine;
  });
  var card=document.getElementById('sa-card');
  if(card) card.style.display=hasAny?'':'none';
};

window.renderTemperatureAnalysis=function(){
  var cfg=liveTempCfg.enabled?liveTempCfg:{enabled:false,strings:[],system:null};
  var card=document.getElementById('temp-card');
  if(!card) return;
  if(!cfg.enabled||!cfg.strings.length){
    card.style.display='none';
    return;
  }
  card.style.display='';
  var hasAny=false;
  cfg.strings.forEach(function(s){
    var box=document.getElementById('temp-'+s.id);
    if(!box) return;
    hasAny=true;
    box.style.display='';
    var q=s.tempQuality||'UNGUELTIG';
    var ql=tempQualityLabel(q);
    var showTemp=(q!=='UNGUELTIG'&&s.tempC!=null);
    var tempTxt=showTemp?s.tempC.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1})+' \u00b0C':'--';
    var tempStyle=showTemp?(q==='EINGESCHRAENKT'?'opacity:0.92;border-bottom:1px dashed var(--orn);display:inline-block':'opacity:1'):'opacity:0.5';
    var unc=s.uncertainty!=null?'\u00b1 '+s.uncertainty.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1})+' K':'';
    var alertTxt=(showTemp&&s.alert&&s.alert!=='UNBEKANNT')?(tempAlertIcon(s.alert)+' '+s.alert):'';
    box.innerHTML='<div class="vl">\ud83c\udf21 String '+s.id+' ('+s.modules+' Module)</div>'+
      '<div style="font-size:10px;color:var(--mut);margin-top:2px">'+(s.vmppPerModule?s.vmppPerModule.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}):'--')+' V/Modul</div>'+
      '<div style="font-size:18px;font-weight:700;margin:6px 0;color:'+(showTemp?tempColor(s.tempC):'var(--mut)')+'"><span style="'+tempStyle+'">'+tempTxt+'</span></div>'+
      '<div style="font-size:10px;color:'+ql.color+'">'+unc+(unc?' \u00b7 ':'')+ql.text+'</div>'+
      '<div style="font-size:10px;color:var(--mut);margin-top:2px">MPP-Nutzung: '+(s.mppUtilization?s.mppUtilization.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}):'--')+'% \u00b7 Verlust: '+(s.tempLossW||0)+' W</div>'+
      (alertTxt?'<div style="font-size:10px;margin-top:2px">'+alertTxt+'</div>':'');
  });
  ['1','2','3'].forEach(function(n){
    var found=false;
    cfg.strings.forEach(function(s){if(String(s.id)===n) found=true;});
    var box=document.getElementById('temp-'+n);
    if(box&&!found) box.style.display='none';
  });
  var sys=document.getElementById('temp-system');
  if(sys&&cfg.system){
    sys.style.display='';
    var dT=cfg.system.deltaStrings;
    var dValid=cfg.system.deltaValid;
    var dTxt=(dValid&&dT!=null)?(((dT>0?'+':'')+dT.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}))+' K'):'--';
    var sysAlert=(cfg.system.systemAlert&&cfg.system.systemAlert!=='UNBEKANNT')?cfg.system.systemAlert:null;
    sys.innerHTML='<div class="vl">System-Temperatur</div>'+
      '<div style="font-size:12px;margin-top:4px">\u0394T String 1\u21942: <strong>'+dTxt+'</strong>'+(dValid&&qLimitedNote(cfg)?' <span style="color:var(--orn);font-size:10px">(eingeschr\u00e4nkt)</span>':'')+
      ' \u00b7 Verlust heute: <strong>'+(cfg.system.totalLossKwhDay||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' kWh</strong> \u00b7 aktuell: <strong>'+(cfg.system.totalLossW||0)+' W</strong></div>'+
      (sysAlert?'<div style="font-size:11px;margin-top:4px">'+tempAlertIcon(sysAlert)+' '+sysAlert+(cfg.system.hottest?' \u00b7 hei\u00dfester: '+cfg.system.hottest:'')+'</div>':'');
  } else if(sys) {
    sys.style.display='none';
  }
  if(!hasAny) card.style.display='none';
};

function qLimitedNote(cfg){
  if(!cfg||!cfg.strings) return false;
  for(var i=0;i<cfg.strings.length;i++){
    if(cfg.strings[i].id<=2&&cfg.strings[i].tempQuality==='EINGESCHRAENKT') return true;
  }
  return false;
}

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

/* ── Logs ── */
window.loadLogs=function(){
  fetch(window.location.origin+'/api/logs').then(function(r){return r.json()}).then(function(j){allLogs=j.logs||[];renderLogs()});
};
window.clearLogs=function(){
  fetch(window.location.origin+'/api/logs/clear',{method:'POST'}).then(function(){
    allLogs=[];
    renderLogs();
  }).catch(function(){
    allLogs=[];
    renderLogs();
  });
};
window.renderLogs=function(){
  var f=document.getElementById('lvlF').value, c=document.getElementById('lWrap');
  var keepScroll=c.scrollTop;
  var rows=f?allLogs.filter(function(l){return l.level===f}):allLogs;
  c.innerHTML=rows.length?rows.map(function(l){
    return '<div class="le"><span class="lts">'+new Date(l.ts).toLocaleString('de-DE')+'</span>'+
      '<span class="llv l'+l.level+'">'+l.level+'</span>'+
      '<span class="lm">'+l.message.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span></div>';
  }).join(''):'<div style="color:var(--mut);padding:6px">Keine Eintr\u00e4ge</div>';
  // Neueste stehen oben (unshift) – Auto-Scroll hält die Sicht oben, sonst Scrollposition behalten
  c.scrollTop=document.getElementById('aScrl').checked?0:keepScroll;
};

/* ── System ── */
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

/* ── Ertrag / Monatsübersicht ── */
function fmtKwh(v){
  if(v==null||v===undefined||isNaN(v)) return '–';
  return v.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1});
}
function fmtWh(v){
  if(v==null||v===undefined||isNaN(v)) return '–';
  return Math.round(v).toLocaleString('de-DE');
}
function fmtEur(v){
  if(v==null||v===undefined||isNaN(v)) return '–';
  return v.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
}
function fmtNum(v,d){
  if(v==null||v===undefined||isNaN(v)) return '–';
  return v.toLocaleString('de-DE',{minimumFractionDigits:d||0,maximumFractionDigits:d||1});
}
function yieldMsg(text){
  var el=document.getElementById('yieldMsg');
  if(el) el.textContent=text||'';
}

window.loadYields=function(){
  fetch(window.location.origin+'/api/yields').then(function(r){return r.json()}).then(function(j){
    yieldsData=j;
    renderYields();
  }).catch(function(e){ yieldMsg('Fehler: '+e.message); });
};

function renderYields(){
  if(!yieldsData) return;
  var s=yieldsData.settings||{};
  document.getElementById('y-total-kwh').textContent=fmtKwh(yieldsData.totalKwh!=null?yieldsData.totalKwh:yieldsData.totalWh/1000)+' kWh';
  document.getElementById('y-total-eur').textContent=fmtEur(yieldsData.totalEuro);
  document.getElementById('y-month-cnt').textContent=yieldsData.monthCount||0;
  document.getElementById('y-epoch').textContent=s.pikoEpoch||'–';
  document.getElementById('y-tariff').value=String(s.feedInTariff||0.3925).replace('.',',');
  document.getElementById('y-kwp').value=s.installedKwp>0?String(s.installedKwp).replace('.',','):'';
  document.getElementById('y-plz').value=s.plz||s.plzRegion||'';
  document.getElementById('y-storage').textContent=yieldsData.storagePath||'iobroker-data/'+(yieldsData.namespace||'')+'/monthly-yields.json';
  var hr=document.getElementById('y-history-range');
  if(hr){
    var bits=[];
    if(yieldsData.historyFrom&&yieldsData.historyTo){
      bits.push('History-Cache: '+yieldsData.historyFrom+' – '+yieldsData.historyTo);
    }
    if(yieldsData.backupPath) bits.push('Backup: '+yieldsData.backupPath);
    if(yieldsData.influxBackup) bits.push('InfluxDB: '+(yieldsData.influxInstance||'aktiv')+' → yield.monthly');
    hr.textContent=bits.join(' · ');
  }

  var years=yieldsData.years||[];
  var grid=yieldsData.grid||[];
  var thead='<tr><th class="ymonth">Monat</th>';
  years.forEach(function(y){ thead+='<th>'+y+'</th>'; });
  thead+='</tr>';
  document.querySelector('#y-grid thead').innerHTML=thead;

  var tbody='';
  grid.forEach(function(row){
    tbody+='<tr><td class="ymonth">'+row.name+'</td>';
    years.forEach(function(y){
      var cell=row.cells[y]||{};
      var wh=cell.wh;
      var cls='editable '+(cell.source==='manual'?'manual':'auto');
      if(wh&&row.stats&&row.stats.avg){
        if(wh>=row.stats.avg) cls+=' above'; else cls+=' below';
        if(wh===row.stats.min) cls+=' is-min';
        if(wh===row.stats.max) cls+=' is-max';
      }
      tbody+='<td class="'+cls+'" data-year="'+y+'" data-month="'+row.month+'" title="'+(cell.source==='manual'?'Manuell':'Automatisch')+'">'+fmtWh(wh)+'</td>';
    });
    tbody+='</tr>';
  });

  tbody+='<tr class="sum-row"><td class="ymonth">Σ Jahr [Wh]</td>';
  years.forEach(function(y){ tbody+='<td>'+fmtWh(yieldsData.yearTotals[y])+'</td>'; });
  tbody+='</tr>';
  tbody+='<tr class="sum-row"><td class="ymonth">€ / Jahr</td>';
  years.forEach(function(y){ tbody+='<td style="color:var(--grn)">'+fmtEur(yieldsData.yearEuro[y])+'</td>'; });
  tbody+='</tr>';
  tbody+='<tr class="sum-row"><td class="ymonth">kWh / kWp</td>';
  years.forEach(function(y){
    var v=yieldsData.yearKwp[y];
    tbody+='<td>'+(v!=null?fmtNum(v,1):'–')+'</td>';
  });
  tbody+='</tr>';

  document.querySelector('#y-grid tbody').innerHTML=tbody;
  bindYieldCells();

  var kpi=document.getElementById('y-kpi');
  if(kpi&&years.length){
    var cy=years[years.length-1];
    kpi.innerHTML=[
      '<div class="kpi"><div class="kl">Jahr '+cy+'</div><div class="kv">'+fmtWh(yieldsData.yearTotals[cy])+'</div><div class="ks">Wh gesamt</div></div>',
      '<div class="kpi"><div class="kl">Jahr '+cy+' €</div><div class="kv" style="color:var(--grn)">'+fmtEur(yieldsData.yearEuro[cy])+'</div><div class="ks">bei '+String(s.feedInTariff||0.3925).replace('.',',')+' €/kWh</div></div>',
      '<div class="kpi"><div class="kl">Jahr '+cy+'</div><div class="kv">'+(yieldsData.yearKwp[cy]!=null?fmtNum(yieldsData.yearKwp[cy],1):'–')+'</div><div class="ks">kWh/kWp</div></div>'
    ].join('');
  }
  renderYieldChartControls();
  renderYieldChart();
}

function renderYieldChartControls(){
  var wrap=document.getElementById('y-chart-years');
  if(!wrap||!yieldsData) return;
  var years=yieldsData.years||[];
  if(!yieldsChartYears) yieldsChartYears={};
  years.forEach(function(y,i){
    if(yieldsChartYears[y]===undefined){
      yieldsChartYears[y]=i>=Math.max(0,years.length-3);
    }
  });
  wrap.innerHTML=years.map(function(y){
    var checked=!!yieldsChartYears[y];
    return '<label class="'+(checked?'on':'')+'"><input type="checkbox" '+(checked?'checked':'')+
      ' onchange="toggleChartYear('+y+',this.checked)"> '+y+'</label>';
  }).join('');
}

window.toggleChartYear=function(y,on){
  yieldsChartYears[y]=!!on;
  renderYieldChartControls();
  renderYieldChart();
};

window.selectAllChartYears=function(on){
  if(!yieldsData) return;
  (yieldsData.years||[]).forEach(function(y){ yieldsChartYears[y]=!!on; });
  renderYieldChartControls();
  renderYieldChart();
};

window.selectRecentChartYears=function(n){
  if(!yieldsData) return;
  var years=yieldsData.years||[];
  years.forEach(function(y,i){ yieldsChartYears[y]=i>=years.length-n; });
  renderYieldChartControls();
  renderYieldChart();
};

window.setYieldChartUnit=function(u){
  yieldsChartUnit=u;
  document.getElementById('ych-mwh').classList.toggle('active',u==='mwh');
  document.getElementById('ych-kwh').classList.toggle('active',u==='kwhkwp');
  renderYieldChart();
};

function renderYieldChart(){
  if(typeof Chart==='undefined'||!yieldsData) return;
  var years=(yieldsData.years||[]).filter(function(y){ return yieldsChartYears&&yieldsChartYears[y]; });
  if(!years.length){
    var el=document.getElementById('chart-yields');
    if(el&&chartInstances['chart-yields']){ chartInstances['chart-yields'].destroy(); chartInstances['chart-yields']=null; }
    return;
  }
  var kwp=yieldsData.settings&&yieldsData.settings.installedKwp||0;
  var labels=yieldsData.grid.map(function(r){ return r.name.substring(0,3); });
  var yLabel=yieldsChartUnit==='kwhkwp'?'kWh/kWp':'MWh';
  var datasets=years.map(function(y,i){
    return {
      label:String(y),
      data:yieldsData.grid.map(function(row){
        var wh=row.cells[y]&&row.cells[y].wh;
        if(!wh) return null;
        if(yieldsChartUnit==='kwhkwp'){
          return kwp>0?Math.round(wh/1000/kwp*10)/10:null;
        }
        return Math.round(wh/10000)/100;
      }),
      backgroundColor:YIELD_COLORS[i%YIELD_COLORS.length],
      borderRadius:3,
      maxBarThickness:28
    };
  });
  makeChart('chart-yields',{
    type:'bar',
    data:{labels:labels,datasets:datasets},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'right',labels:{boxWidth:12,font:{size:10}}},
        tooltip:{
          callbacks:{
            label:function(ctx){
              var v=ctx.parsed.y;
              if(v==null) return ctx.dataset.label+': –';
              return ctx.dataset.label+': '+v.toLocaleString('de-DE')+' '+yLabel;
            }
          }
        }
      },
      scales:{
        x:{grid:{color:'rgba(48,54,61,.4)'},ticks:{color:'#8b949e'}},
        y:{
          beginAtZero:true,
          title:{display:true,text:yLabel,color:'#8b949e',font:{size:10}},
          grid:{color:'rgba(48,54,61,.35)'},
          ticks:{color:'#8b949e'}
        }
      }
    }
  });
}

function bindYieldCells(){
  document.querySelectorAll('#y-grid td.editable').forEach(function(td){
    td.onclick=function(){
      if(td.querySelector('input')) return;
      var year=td.getAttribute('data-year');
      var month=td.getAttribute('data-month');
      var cur=td.textContent==='–'?'':td.textContent.replace(/\./g,'');
      var inp=document.createElement('input');
      inp.type='text'; inp.className='yield-edit'; inp.value=cur;
      td.textContent=''; td.appendChild(inp); inp.focus(); inp.select();
      function save(){
        var val=inp.value.trim();
        postYield({action:'setCell',year:parseInt(year),month:parseInt(month),wh:val===''?null:val});
      }
      inp.onblur=save;
      inp.onkeydown=function(e){
        if(e.key==='Enter'){inp.blur();}
        if(e.key==='Escape'){td.textContent=cur?fmtWh(parseInt(cur)): '–'; bindYieldCells();}
      };
    };
  });
}

function postYield(body){
  yieldMsg('Speichere…');
  fetch(window.location.origin+'/api/yields',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  }).then(function(r){return r.json()}).then(function(j){
    if(j.error) throw new Error(j.error);
    yieldsData=j.data||j;
    renderYields();
    yieldMsg(j.message||'Gespeichert');
    setTimeout(function(){yieldMsg('');},3000);
  }).catch(function(e){ yieldMsg('Fehler: '+e.message); });
}

window.saveYieldSettings=function(){
  postYield({
    action:'setSettings',
    feedInTariff:document.getElementById('y-tariff').value,
    installedKwp:document.getElementById('y-kwp').value,
    plz:document.getElementById('y-plz').value
  });
};

window.refreshYieldsAuto=function(){
  yieldMsg('Berechne Monate aus Historie…');
  postYield({action:'refreshAuto',force:true});
};

window.restoreYieldsBackup=function(){
  if(!confirm('Backup wiederherstellen (Datei .bak oder ioBroker-Snapshot)?\n\nAktuelle Tabelle wird überschrieben.')) return;
  yieldMsg('Stelle Backup wieder her…');
  postYield({action:'restoreBackup'});
};
window.restoreYieldsInflux=function(){
  if(!confirm('Monatserträge aus InfluxDB laden und mit der Tabelle zusammenführen?\n\nManuelle (blaue) Werte bleiben erhalten. Grafana-Serie: yield.monthly')) return;
  yieldMsg('Lade aus InfluxDB…');
  postYield({action:'restoreFromInflux',mode:'merge'});
};

window.clearYieldsAuto=function(){
  if(!confirm('Alle automatisch berechneten Monatswerte löschen?\n\nManuelle (blaue) Werte bleiben erhalten.')) return;
  yieldMsg('Lösche Auto-Werte…');
  postYield({action:'clearAuto'});
};

window.addYieldYear=function(){
  var y=prompt('Jahr hinzufügen (z. B. 2010):','');
  if(!y) return;
  postYield({action:'addYear',year:parseInt(y)});
};

window.fillYieldYears=function(){
  var from=yieldsData&&yieldsData.settings&&yieldsData.settings.pikoEpoch;
  var hint=from?from.substring(0,4):'2010';
  if(!confirm('Alle Jahre von Inbetriebnahme ('+hint+') bis heute als Spalten hinzufügen?')) return;
  postYield({action:'fillYears'});
};

window.exportYields=function(fmt){
  var url=window.location.origin+'/api/yields/export?format='+(fmt||'json');
  var a=document.createElement('a');
  a.href=url;
  a.download='';
  document.body.appendChild(a);
  a.click();
  a.remove();
  yieldMsg('Download gestartet ('+(fmt==='csv'?'CSV':'JSON')+')');
  setTimeout(function(){yieldMsg('');},3000);
};

window.importYieldsFile=function(input){
  var file=input.files&&input.files[0];
  if(!file) return;
  var reader=new FileReader();
  reader.onload=function(){
    var text=reader.result;
    var mode=confirm('OK = Zusammenführen (bestehende manuelle Werte bleiben)\nAbbrechen = Ersetzen (Vorsicht!)')?'merge':'replace';
    var body={action:'import',mode:mode};
    if(file.name.toLowerCase().endsWith('.csv')||text.indexOf(';')>=0||text.indexOf('Monat')===0){
      body.csv=text;
    } else {
      try{ body.data=JSON.parse(text); }catch(e){ yieldMsg('Ungültige Datei: '+e.message); return; }
    }
    yieldMsg('Importiere…');
    postYield(body);
    input.value='';
  };
  reader.readAsText(file,'UTF-8');
};

/* ── Auto-Refresh ── */
function tick(){
  var a=document.querySelector('.tc.act');
  if(!a) return;
  if(a.id==='tab-daten')   loadData();
  if(a.id==='tab-logs')    loadLogs();
  if(a.id==='tab-yields')  loadYields();
}
initChartTheme();
loadData(); loadLogs();
setInterval(tick,15000);
var histPollMs=60000;
setInterval(function(){
  var a=document.querySelector('.tc.act');
  if(a&&a.id==='tab-history') loadHistory(true);
},histPollMs);
window.addEventListener('resize',function(){
  if(document.getElementById('tab-history')&&document.getElementById('tab-history').classList.contains('act')){
    renderNavView();
  }
  if(document.getElementById('tab-yields')&&document.getElementById('tab-yields').classList.contains('act')){
    renderYieldChart();
  }
});
})();
