import {fishingWindows,distinctWindows} from './planner.js';
import {conditionsTimeline} from './timeline.js';
import {presets} from './spots.js';
import {atTime,tideAt,displayTideAt,windWindows,directionName,distanceMiles,forecastTimeFor} from './domain.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
let local={revision:0,spots:[],entries:[],prefs:{windLimit:10}},custom=[],entries=[],spots=[...presets],selected='crissy',hour=0,limit=10,zoom=1,panX=0,panY=0,dragged=false,mapDetail=null,adding=false,pending=null,coasts=[],stateReady=false,savePending=false,editingPin=null,editingTrip=null;
let showSources=true,focusedSource=null;
let comparisonOpen=false,comparisonLoading=false;
let currentPage='atlas',atlasCamera=null;
let tripSnapshotPrefix=null,tripDraftVersion=0;
const mapAnnotationSize=1.3; // Readable markers and labels, independent of map zoom.
let forecastTimes=[],weatherById={},weatherMeta={},detailsById={},detailLoading=new Set(),detailErrors={},overallError=null;
const pacificDate=(t=Date.now()/1000)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t*1000));
const shortDate=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'}).format(new Date(t*1000));
const clock=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(new Date(t*1000));
const inputClock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t*1000));
const weekday=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',weekday:'short'}).format(new Date(t*1000));
const timestamp=()=>forecastTimes[hour]??Math.floor(Date.now()/3600000)*3600;
const fmt=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
const getSpot=()=>spots.find(s=>s.id===selected)??spots[0];
function dayTitle(t){const today=pacificDate();return pacificDate(t)===today?'Today':`${weekday(t)} ${shortDate(t)}`}
function conditions(s,h=hour){return atTime(weatherById[s.id]?.hours,forecastTimes[h]??timestamp())??{wind:null,gust:null,direction:null,rain:null,day:false,temp:null}}
function notice(text){$('#footer-status').textContent=text}
async function api(path,options){const res=await fetch(path,options);const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data}
function applyLocal(data){local=data;custom=data.spots;entries=data.entries;spots=[...presets,...custom];limit=data.prefs.windLimit;$('#wind-limit').value=limit;$('#limit-label').value=limit}
async function persist(next){if(!stateReady){notice('Local files are unavailable. Retry loading before saving.');return false}if(savePending){notice('A save is still finishing. Try again in a moment.');return false}savePending=true;try{const data=await api('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...next,revision:local.revision})});applyLocal(data);notice('Saved to your local files');return true}catch(e){notice(e.message);alert(e.message);return false}finally{savePending=false}}
function days(){const seen=new Set();return forecastTimes.map((t,i)=>({t,i,key:pacificDate(t)})).filter(d=>{if(seen.has(d.key))return false;seen.add(d.key);return true})}
function nearestHour(time){if(!forecastTimes.length)return 0;let best=0;forecastTimes.forEach((t,i)=>{if(Math.abs(t-time)<Math.abs(forecastTimes[best]-time))best=i});return best}
function setHour(value){hour=Number(value);render()}
function jumpTo(time){hour=nearestHour(time);render()}
function renderBanner(){const m=weatherMeta[selected];const d=detailsById[selected];let text='Loading weather and tide sources…';if(weatherById[selected])text=`${m?.status==='stale'?'Cached forecast · refresh unavailable':'Forecasts connected'} · weather retrieved ${m?.fetchedAt?clock(m.fetchedAt/1000):'—'} PT`;else if(overallError||detailErrors[selected])text='Weather unavailable · no sample values substituted';$('#data-status').textContent=text;$('#refresh').disabled=detailLoading.has(selected);$('#refresh').textContent=detailLoading.has(selected)?'Loading…':'↻ Refresh';}
function renderList(){let region='';$('#spot-list').innerHTML=spots.map((s,i)=>{const header=s.region!==region?`<div class="region-title"><span>${esc(s.region)}</span><span>↗</span></div>`:'';region=s.region;const c=conditions(s);return header+`<button class="spot-row ${s.id===selected?'active':''}" data-spot="${s.id}" aria-pressed="${s.id===selected}" title="${esc(s.name)} · forecast wind"><span class="code">${String(i+1).padStart(2,'0')}</span><span>${esc(s.name)}</span><span class="reading">${fmt(c.wind,0)} kn</span></button>`}).join('');$('#spot-list').querySelectorAll('[data-spot]').forEach(b=>b.onclick=()=>selectSpot(b.dataset.spot));$('.index-title span:last-child').textContent=`01—${String(spots.length).padStart(2,'0')}`;}
const project=(lon,lat)=>{let x=(lon+122.85)/.77*780;let y=(38.04-lat)/.64*640;return [45+x*.91-y*.10,18+y*.93+x*.065]};
const unproject=(x,y)=>{let a=x-45,b=y-18;let yy=(b-a*.065/.91)/(.93+.10*.065/.91),xx=(a+.10*yy)/.91;return [-122.85+xx/780*.77,38.04-yy/640*.64]};
const path=poly=>poly.map(([lon,lat],i)=>`${i?'L':'M'}${project(lon,lat).map(v=>v.toFixed(1)).join(',')}`).join(' ')+'Z';
function selectedSources(){
 const spot=getSpot(),detail=detailsById[spot.id];
 const reference=detail?.spot??(spot.tideStation?spot:presets.find(p=>p.id===spot.referenceId));
 const sources=[];
 if(reference?.tideStation){const t=reference.tideStation;sources.push({...t,key:'noaa-'+t.id,code:'T',kind:'station',label:'Tide prediction reference',description:t.continuous?'NOAA tide curve + high/low events':'NOAA high/low events only'})}
 if(reference?.currentStation){const c=reference.currentStation;sources.push({...c,key:'current-'+c.id,code:'C',kind:'station',label:'Current prediction reference',description:'NOAA flood / ebb / slack events; not a live current sensor'})}
 const same=sources.find(p=>p.key==='noaa-9414290');
 if(same){same.code='T/O';same.label='Tides + observed wind';same.description+=' · regional wind observations'}
 else sources.push({key:'noaa-9414290',id:'9414290',code:'O',name:'San Francisco / Torpedo Wharf',lat:37.8063,lon:-122.4659,kind:'station',label:'Observed wind reference',description:'NOAA regional observations, not wind measured at your fishing spot'});
 const weather=weatherById[spot.id]?.grid;
 if(weather)sources.push({...weather,key:'weather-grid',code:'W',name:'Wind forecast grid',kind:'grid',label:'Modeled wind, gusts & rain',description:'Open-Meteo model grid center; not a physical NOAA station'});
 const marine=detail?.marine.value?.grid;
 if(marine)sources.push({...marine,key:'marine-grid',code:'S',name:'Offshore swell forecast grid',kind:'grid',label:'Modeled offshore waves',description:'Open-Meteo marine model grid center; not a buoy or beach measurement'});
 return sources.map(p=>({...p,distance:distanceMiles(spot,p)}));
}
function focusSource(key){focusedSource=key;const source=selectedSources().find(s=>s.key===key);if(!source)return;const spot=getSpot(),a=project(spot.lon,spot.lat),b=project(source.lon,source.lat);zoom=Math.min(3,Math.max(1,360/Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),1)));panX=(400-(a[0]+b[0])/2)*zoom;panY=(340-(a[1]+b[1])/2)*zoom;renderMap()}
function sourceMapLayer(){
 const host=$('#source-strip');host.hidden=!showSources;
 $('#source-toggle').setAttribute('aria-pressed',String(showSources));
 if(!showSources)return '';
 const spot=getSpot(),sources=selectedSources(),[sx,sy]=project(spot.lon,spot.lat);
 host.innerHTML=`<div class="source-strip-heading"><span class="eyebrow">READINGS FOR ${esc(spot.name.toUpperCase())}</span><span>Straight-line distance · click to locate</span></div><div class="source-cards">${sources.map(p=>`<button class="source-card ${focusedSource===p.key?'active':''}" data-source-key="${p.key}" title="${esc(p.description)}"><span class="source-code ${p.kind}">${p.code}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.label)}${p.id?' · '+p.id:''}</small></span><b>${fmt(p.distance)} mi</b></button>`).join('')}</div><p class="source-explanation">Squares = NOAA references / observations. Diamonds = forecast grids, not stations. Nearby readings still may differ from conditions along the beach.</p>`;
 host.querySelectorAll('[data-source-key]').forEach(b=>b.onclick=()=>focusSource(b.dataset.sourceKey));
 const lines=sources.map(p=>{const[x,y]=project(p.lon,p.lat);return `<path d="M${sx} ${sy}L${x} ${y}" class="source-connection ${p.kind} ${focusedSource===p.key?'focused':''}"/>`}).join('');
 const pins=sources.map(p=>{const[x,y]=project(p.lon,p.lat),active=focusedSource===p.key;return `<g role="button" tabindex="0" class="source-marker ${p.kind} ${active?'focused':''}" data-source-marker="${p.key}" transform="translate(${x} ${y}) scale(${(currentPage==='location'?2:mapAnnotationSize)/zoom})" aria-label="${esc(p.name)}, ${esc(p.label)}"><title>${esc(p.name)} — ${esc(p.label)}</title><circle r="10" fill="transparent"/>${p.kind==='grid'?'<path d="M0 -6l6 6 -6 6 -6 -6Z" class="source-symbol"/>':'<rect x="-5" y="-5" width="10" height="10" class="source-symbol"/>'}</g>`}).join('');
 return `<g class="source-layer">${lines}${pins}</g>`;
}
function mapTransform(){return `translate(${400-400*zoom+panX} ${340-340*zoom+panY}) scale(${zoom})`}
function renderMap(){
 const sourceLayer=currentPage==='location'?sourceMapLayer():'';
 const land=coasts.map(p=>`<path d="${path(p)}"/>`).join('');
 const textAt=(lon,lat,text,cls='map-label',dx=0,dy=0)=>{const[x,y]=project(lon,lat);return `<g transform="translate(${x} ${y}) scale(${(currentPage==='location'?2:mapAnnotationSize)/zoom})"><text x="${dx}" y="${dy}" text-anchor="middle" class="${cls}">${esc(text)}</text></g>`};
 const labels=[[-122.68,37.995,'MARIN'],[-122.43,37.72,'SAN FRANCISCO'],[-122.18,37.945,'EAST BAY'],[-122.735,37.67,'PACIFIC'],[-122.735,37.645,'OCEAN'],[-122.335,37.705,'SAN FRANCISCO'],[-122.335,37.68,'BAY']].map(p=>textAt(...p)).join('');
 const terrain=(mapDetail?.contours??[]).filter(c=>zoom>=1.5||c.meters%100===0).map(c=>`<path d="${c.d}" class="terrain-contour ${c.meters%200===0?'index-contour':''}"/>`).join('');
 const roads=(mapDetail?.roads??[]).map(r=>`<path d="${r.d}" class="${r.bridge?'bridge-line':'road-line'}"/>`).join('');
 const bridgeLabels=[[-122.481,37.823,'GOLDEN GATE',-53,-6],[-122.373,37.803,'BAY BRIDGE',38,16],[-122.441,37.936,'RICHMOND–SAN RAFAEL',0,-7]].map(([a,b,t,x,y])=>textAt(a,b,t,'landmark-label bridge-label',x,y)).join('');
 const islands=[[-122.432,37.827,'ALCATRAZ',32,-10],[-122.432,37.862,'ANGEL ISLAND',38,-10],[-122.371,37.823,'TREASURE IS.',38,-9]].map(([a,b,t,dx,dy])=>{let[x,y]=project(a,b);return `<g class="island-label" transform="translate(${x} ${y}) scale(${(currentPage==='location'?2:mapAnnotationSize)/zoom})"><path d="M0 0l${dx*.5} ${dy}" fill="none" stroke="#78745c" stroke-width=".6"/><circle r="1.7" fill="#555640"/><text x="${dx}" y="${dy-3}" text-anchor="middle" class="landmark-label">${t}</text></g>`}).join('');
 const peaks=[[-122.596,37.923,'MT. TAMALPAIS'],[-122.451,37.69,'SAN BRUNO MTN.'],[-122.477,37.578,'MONTARA MTN.']].map(([a,b,name])=>{let[x,y]=project(a,b);return `<g transform="translate(${x} ${y}) scale(${(currentPage==='location'?2:mapAnnotationSize)/zoom})"><path d="M-3 2l3 -5 3 5Z" fill="#777257"/><text y="-9" text-anchor="middle" class="landmark-label peak-label">${name}</text></g>`}).join('');
 const localLabels=[[-122.505,37.85,'SAUSALITO'],[-122.456,37.887,'TIBURON'],[-122.253,37.813,'OAKLAND'],[-122.503,37.771,'GOLDEN GATE PARK'],[-122.465,37.79,'PRESIDIO'],[-122.49,37.51,'PILLAR POINT']].map(p=>textAt(...p,'landmark-label local-label')).join('');
 const winds=presets.filter(s=>['stinson','crissy','hmb'].includes(s.id)).map(s=>{const c=conditions(s);if(c.direction===null||c.wind===null)return '';let[x,y]=project(s.lon,s.lat);return `<g class="map-wind" transform="translate(${x} ${y}) scale(${(currentPage==='location'?2:mapAnnotationSize)/zoom})"><g transform="translate(-66 24)"><g transform="rotate(${c.direction+180})"><path d="M0 13V-13m-4 5 4 -5 4 5" fill="none" stroke="#565a40" stroke-width="1.2"/></g><text x="13" y="3" font-size="8" fill="#686650">${fmt(c.wind,0)} kn</text></g></g>`}).join('');
 const markers=spots.map((s,i)=>{let[x,y]=project(s.lon,s.lat),active=s.id===selected;let right=['crissy','richmond','berkeley','alameda','candlestick','coyote'].includes(s.id);let labelVisible=active||(currentPage!=='location'&&zoom>=1.7);return `<g class="marker ${currentPage==='atlas'&&!active?'muted-marker':''}" role="button" tabindex="0" aria-label="${currentPage==='atlas'?'Preview':'Select'} ${esc(s.name)}" aria-pressed="${active}" data-map-spot="${s.id}" transform="translate(${x} ${y}) scale(${(currentPage==='location'?2:mapAnnotationSize)/zoom})">${active?'<circle r="17" fill="none" stroke="#25271b" stroke-width=".7"/><circle r="23" fill="none" stroke="#25271b" stroke-width=".4" stroke-dasharray="2 4"/>':''}<circle class="marker-dot" r="${active?7:5}" fill="${active?'#25271b':'#eee8cf'}" stroke="#25271b" stroke-width="1.4"/><path d="M${right?9:-9} 0h${right?17:-17}" stroke="#555640" stroke-width=".7"/><rect x="${right?26:-51}" y="-10" width="25" height="20" fill="${active?'#25271b':'#e6dfbe'}" stroke="#87836c" stroke-width=".7"/><text x="${right?38:-38}" y="4" text-anchor="middle" fill="${active?'#e6dfbe':'#25271b'}">${String(i+1).padStart(2,'0')}</text>${labelVisible?`<text class="spot-map-name" x="${right?58:-58}" y="4" text-anchor="${right?'start':'end'}" fill="#25271b">${esc(s.name)}</text>`:''}</g>`}).join('');
 $('#map-content').innerHTML=`<defs><clipPath id="land-clip">${land}</clipPath><mask id="water-mask"><rect x="-1000" y="-1000" width="3000" height="3000" fill="white"/><g fill="black">${land}</g></mask></defs><g id="geography" transform="${mapTransform()}"><g fill="none" stroke="#77795e" opacity=".14" mask="url(#water-mask)" stroke-width="14">${land}</g><g fill="none" stroke="#77795e" opacity=".2" mask="url(#water-mask)" stroke-width="6">${land}</g><g transform="translate(0 7)" fill="url(#hatch)" stroke="#868168" stroke-width=".6">${land}</g><g fill="#e6dfbe" stroke="#8b866c" stroke-width=".8">${land}</g><g clip-path="url(#land-clip)">${terrain}</g><g class="road-layer">${roads}</g></g><g id="map-annotations" transform="${mapTransform()}">${labels}<g class="geographic-annotations ${zoom>=1.5?'close-detail':''}">${bridgeLabels}${islands}${peaks}${zoom>=1.5?localLabels:''}</g>${winds}${markers}${sourceLayer}</g>`;
 $('#map').querySelectorAll('[data-source-marker]').forEach(el=>{el.onclick=e=>{if(adding||dragged)return;e.stopPropagation();focusSource(el.dataset.sourceMarker)};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusSource(el.dataset.sourceMarker)}}});
 $('#map').querySelectorAll('[data-map-spot]').forEach(el=>{const choose=()=>currentPage==='atlas'?previewSpot(el.dataset.mapSpot):selectSpot(el.dataset.mapSpot);el.onclick=e=>{if(adding||dragged)return;e.stopPropagation();choose()};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
 declutterMapLabels();
 $('.map-scale').innerHTML=`N ↑<br><span>0 ├────┤ ≈ ${(5/zoom).toFixed(1)} mi</span>`;
 renderMapPreview();
}
function renderMapPreview(){
 const host=$('#map-preview');if(!host)return;host.hidden=currentPage!=='atlas';if(host.hidden)return;
 const s=getSpot(),c=conditions(s),detail=detailsById[s.id],tide=displayTideAt(detail,timestamp()),weatherState=weatherMeta[s.id]?.status;
 const wind=Number.isFinite(c.wind)?`${fmt(c.wind,0)} kn · gusts ${fmt(c.gust,0)} kn`:'Forecast unavailable';
 const tideText=tide?`${tide.estimated?'Estimated ':'Predicted '}${fmt(tide.value)} ft · ${tide.rising?'rising':'falling'}`:detail?'Tide unavailable':'Loading tide reference…';
 host.innerHTML=`<span class="eyebrow">${esc(s.exposure.toUpperCase())}</span><h3>${esc(s.name)}</h3><p>${esc(s.access??'Personal pin')}</p><dl><div><dt>${esc(dayTitle(timestamp()))} · ${esc(clock(timestamp()))} PT</dt><dd>${esc(wind)}${weatherState==='stale'?' · cached':''}</dd></div><div><dt>TIDE · MLLW</dt><dd>${esc(tideText)}</dd></div></dl><button id="open-map-selection" class="primary">Open location details →</button>`;
 $('#open-map-selection').onclick=()=>selectSpot(s.id);
}
// Annotation anchors follow the geography; their inverse scale keeps text and
// symbols at the same size throughout zooming. Reserve symbols before labels.
function declutterMapLabels(){
 const map=$('#map'),bounds=map.getBoundingClientRect(),occupied=[];
 const intersects=(a,b)=>a.left<b.right+4&&a.right>b.left-4&&a.top<b.bottom+4&&a.bottom>b.top-4;
 const visible=r=>r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;
 map.querySelectorAll('.marker-dot,.marker rect,.source-symbol').forEach(el=>{const r=el.getBoundingClientRect();if(visible(r))occupied.push(r)});
 const selectedName=map.querySelector(`[data-map-spot="${selected}"] .spot-map-name`);
 const names=[selectedName,...map.querySelectorAll('.spot-map-name')].filter((el,i,all)=>el&&all.indexOf(el)===i);
 const labels=[...names,...map.querySelectorAll('.map-label,.landmark-label,.map-wind')];
 labels.forEach(el=>{
  el.style.visibility='';
  const r=el.getBoundingClientRect();
  if(!visible(r)||occupied.some(other=>intersects(r,other)))el.style.visibility='hidden';
  else occupied.push(r);
 });
}

function lineChart(rows,key,options={}){
 if(!rows?.length||!rows.some(r=>Number.isFinite(r[key])))return '<p class="empty-chart">No readings for this day.</p>';
 const vals=rows.flatMap(r=>[r[key],options.secondary?r[options.secondary]:null]).filter(Number.isFinite);
 let lo=options.zero?0:Math.floor(Math.min(...vals))-1,hi=Math.ceil(Math.max(...vals))+1;
 if(options.threshold)hi=Math.max(hi,options.threshold+2);
 const wide=Boolean(options.width),width=options.width??292,height=options.height??105;
 const left=wide?34:16,right=width-(wide?10:12),top=wide?18:17,bottom=height-(wide?30:23);
 const x=t=>left+(t-rows[0].time)/Math.max(3600,rows.at(-1).time-rows[0].time)*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
 const draw=k=>{let connected=false;return rows.map(r=>{if(!Number.isFinite(r[k])){connected=false;return ''}const segment=`${connected?'L':'M'}${x(r.time).toFixed(1)},${y(r[k]).toFixed(1)}`;connected=true;return segment}).join(' ')};
 const tick=timestamp(),ticks=wide?[lo,(lo+hi)/2,hi]:[lo,hi];
 const labels=wide&&width>=440?[rows[0],...rows.filter(r=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}).format(new Date(r.time*1000)).match(/^(06|12|18)$/)),rows.at(-1)]:[rows[0],rows.at(-1)];
 return `<svg viewBox="0 0 ${width} ${height}" class="live-chart ${wide?'wind-chart-svg':''}" role="img" aria-label="${esc(options.label??'Forecast chart')}">${ticks.map(v=>`<path d="M${left} ${y(v)}H${right}" stroke="#b9b293" stroke-width=".6"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${Number.isInteger(v)?v:v.toFixed(1)}</text>`).join('')}${options.threshold?`<path d="M${left} ${y(options.threshold)}H${right}" stroke="#9b7849" stroke-dasharray="4 4"/>`:''}${options.secondary?`<path d="${draw(options.secondary)}" fill="none" stroke="#868269" stroke-width="1.2" stroke-dasharray="3 3"/>`:''}<path d="${draw(key)}" fill="none" stroke="#363b28" stroke-width="${wide?2:1.8}"/>${tick>=rows[0].time&&tick<=rows.at(-1).time?`<path d="M${x(tick)} ${top-7}V${bottom+1}" stroke="#363b28" stroke-dasharray="2 3"/>`:''}${labels.map((r,i)=>`<text x="${x(r.time)}" y="${height-6}" text-anchor="${i===0?'start':i===labels.length-1?'end':'middle'}">${clock(r.time)}</text>`).join('')}</svg>`;
}
const dayRows=rows=>(rows??[]).filter(r=>pacificDate(r.time)===pacificDate(timestamp()));
function sourceLine(label,resource,url){const state=resource?.status;return `<div class="source-row"><a href="${url}" target="_blank" rel="noreferrer">${label} ↗</a><span>${state==='stale'?'CACHED · refresh failed':state==='unavailable'?'UNAVAILABLE':state==='events-only'?'EVENTS ONLY':state==='not-applicable'?'NOT USED':resource?.fetchedAt?'Retrieved '+clock(resource.fetchedAt/1000)+' PT':'Loading…'}</span></div>`}
function renderInspector(){const s=getSpot(),data=detailsById[s.id],c=conditions(s),t=timestamp(),tide=displayTideAt(data,t),marine=atTime(data?.marine.value?.hours,t),known=Number.isFinite(c.wind),fresh=weatherMeta[s.id]?.status!=='stale',idx=spots.indexOf(s)+1;const gustOkay=Number.isFinite(c.gust)&&c.gust<=limit+3;let title=!known?'Waiting on the weather':c.wind>limit?'A challenging cast':!gustOkay?'Watch the gusts':'Within your wind preference';let explanation=!known?(detailErrors[s.id]||'The forecast will appear here when the weather source responds.'):c.wind>limit?`Forecast wind exceeds your ${limit}-knot comfort setting. Compare earlier hours or other shorelines.`:!gustOkay?`Average wind is within your setting, but ${c.gust===null?'gust data is missing':'gusts reach '+fmt(c.gust,0)+' knots'}. Treat the average alone with care.`:`Forecast wind and gusts fit your starting preferences. ${c.day?'This hour is in daylight.':'This hour is after dark.'}`;if(!fresh)explanation+=' This is cached data; the latest refresh failed.';
const nextCurrent=data?.currents.value?.find(e=>e.time>=t),tideEvents=(data?.highLow.value??[]).filter(e=>e.time>=t).slice(0,4),currentEvents=(data?.currents.value??[]).filter(e=>e.time>=t).slice(0,4),windows=planningWindows(s);
const obs=data?.observedWind.value,obsOld=obs&&(Date.now()/1000-obs.time>3600||data.observedWind.status==='stale'),temp=data?.observedTemperature.value;const station=data?.spot.tideStation,curStation=data?.spot.currentStation;
const alerts=data?.alerts.value??[];const activeAlerts=alerts.filter(a=>!a.expires||Date.parse(a.expires)>Date.now());
$('#inspector').innerHTML=`<div class="spot-title"><span class="eyebrow">${esc(s.exposure.toUpperCase())}</span><span class="spot-number">${String(idx).padStart(2,'0')}</span></div><h2>${esc(s.name)}</h2><div class="location-sub">${s.lat.toFixed(3)}° N / ${Math.abs(s.lon).toFixed(3)}° W · ${esc(s.access??'Personal pin')}</div>${data?.alerts.status==='unavailable'||data?.alerts.status==='stale'?'<p class="data-caution">Latest alert check unavailable. Check NWS before heading out.</p>':''}${activeAlerts.map(a=>`<details class="weather-alert"><summary>${esc(a.event)}</summary><p>${esc(a.headline)}</p><p>${esc(a.instruction||a.description)}</p><small>Expires ${a.expires?shortDate(Date.parse(a.expires)/1000)+' '+clock(Date.parse(a.expires)/1000):'when cancelled'} · NWS</small></details>`).join('')}<div class="assessment"><strong><span class="status-symbol">${known&&c.wind<=limit?'◒':'↗'}</span>${title}</strong><p>${esc(explanation)}</p></div><div class="metrics"><div class="metric"><span class="eyebrow">FORECAST WIND · ${directionName(c.direction)}</span><div class="value">${fmt(c.wind,0)}<span> kn</span></div><small>Gusting ${fmt(c.gust,0)} kn</small></div><div class="metric"><span class="eyebrow">${tide?.estimated?'ESTIMATED TIDE':'PREDICTED TIDE'}</span><div class="value">${tide?.estimated?'≈ ':''}${fmt(tide?.value)}<span> ft ${tide?(tide.rising?'↗':'↘'):''}</span></div><small>${tide?(tide.rising?'Rising':'Falling')+' · MLLW'+(tide.estimated?' · interpolated':''):data?.tides.status==='events-only'?'High/low events below':'Unavailable'}</small></div><div class="metric"><span class="eyebrow">${s.exposure==='Bay shoreline'?'NEXT CURRENT EVENT':'OFFSHORE SWELL'}</span><div class="value ${s.exposure==='Bay shoreline'?'event-value':''}">${s.exposure==='Bay shoreline'?esc(nextCurrent?.type??'—'):fmt(marine?.swell)}<span>${s.exposure==='Bay shoreline'?'':' ft'}</span></div><small>${s.exposure==='Bay shoreline'?(nextCurrent?clock(nextCurrent.time)+' · regional reference':'No local reference available'):`${fmt(marine?.period,0)} sec · ${directionName(marine?.direction)}`}</small></div><div class="metric"><span class="eyebrow">RAIN CHANCE</span><div class="value">${fmt(c.rain,0)}<span> %</span></div><small>Air ${fmt(c.temp,0)} °F · forecast</small></div></div><div class="chart-section"><div class="chart-head"><span>NEXT HIGH / LOW TIDES</span><span>NOAA · FEET / MLLW</span></div><div class="station-caption">${data?.highLow.status==='stale'||data?.tides.status==='stale'?'Cached predictions · refresh unavailable. ':''}${station?`${esc(station.name)} · ${distanceMiles(s,station).toFixed(1)} mi from pin`:'Loading tide reference…'}</div><div class="event-list">${tideEvents.map(e=>`<div><span>${pacificDate(e.time)!==pacificDate(t)?shortDate(e.time)+' ':''}${clock(e.time)}</span><b>${e.type==='H'?'High':'Low'}</b><span>${fmt(e.value)} ft</span></div>`).join('')}</div></div><div class="window"><span class="eyebrow">SESSIONS TO CONSIDER · ${esc(dayTitle(timestamp()))}</span>${windowCards(windows)}<details class="planning-method"><summary>How these are chosen</summary><p>Two-hour sessions within daylight and your wind/gust limits. Starting preferences favor early or late daylight, changing tide height (either direction), and smaller offshore swell. Current events provide context; stronger current is not rewarded. Missing data makes a session provisional. These are planning suggestions, not catch probabilities or a wading-safety assessment.</p></details></div><details><summary>Currents: flood, ebb & slack</summary><p>${curStation?`${esc(curStation.name)} · ${distanceMiles(s,curStation).toFixed(1)} mi from pin. Prediction depth ${fmt(currentEvents[0]?.depth??curStation.depth,0)} ft. These are events at the reference station, not current speed at your feet.`:'No suitable current reference is assigned to this spot.'}</p><div class="event-list">${currentEvents.map(e=>`<div><span>${shortDate(e.time)} ${clock(e.time)}</span><b>${esc(e.type)}</b><span>${e.type==='slack'?'—':fmt(Math.abs(e.speed))+' kn'}</span></div>`).join('')}</div><p>High/low tide and slack current have different timing. Flood moves into the bay; ebb moves out. No current curve is inferred from these events.</p></details><details><summary>Observed now · Golden Gate reference</summary><p>${obs?`${obsOld?'Older reading — ':''}${fmt(obs.wind)} kn from ${directionName(obs.direction)}, gusting ${fmt(obs.gust)} kn. Observed ${shortDate(obs.time)}, ${clock(obs.time)} PT.`:'Wind observations are unavailable.'}</p><p>Torpedo Wharf is ${distanceMiles(s,{lat:37.8063,lon:-122.4659}).toFixed(1)} mi from this pin. This observation is regional context; it does not replace the spot forecast.</p><p>Water temperature: ${temp&&Number.isFinite(temp.value)?fmt(temp.value)+' °F · '+shortDate(temp.time)+' '+clock(temp.time)+' PT':'unavailable at this station'}. ${data?.observedWaterLevel.value?`Observed water level: ${fmt(data.observedWaterLevel.value.value)} ft MLLW · ${clock(data.observedWaterLevel.value.time)} PT.`:''}</p></details><details><summary>Shore notes</summary><p>${esc(s.notes||'Your personal spot. Add shore-access and casting notes as you learn it.')}</p>${s.source?`<a href="${s.source}" target="_blank" rel="noreferrer">${esc(s.sourceLabel)} ↗</a><p class="review-date">Access notes reviewed ${s.reviewed}. Check the source for closures and current restrictions.</p>`:''}<a href="https://www.nps.gov/goga/planyourvisit/fishing.htm" target="_blank" rel="noreferrer">Fishing rules & license information ↗</a></details><details><summary>Data sources & freshness</summary>${sourceLine('Wind, gusts, rain · Open-Meteo',data?.weather??weatherMeta[s.id],'https://open-meteo.com/')}${sourceLine('Tides · NOAA',data?.highLow,station?`https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${station.id}`:'https://tidesandcurrents.noaa.gov/')}${curStation?sourceLine('Current events · NOAA',data?.currents,`https://tidesandcurrents.noaa.gov/noaacurrents/predictions.html?id=${curStation.id}_${curStation.bin}`):''}${s.exposure!=='Bay shoreline'?sourceLine('Offshore waves · Open-Meteo / DWD',data?.marine,'https://open-meteo.com/en/docs/marine-weather-api'):''}${sourceLine('Active alerts · NWS',data?.alerts,`https://forecast.weather.gov/MapClick.php?lat=${s.lat}&lon=${s.lon}`)}<p>${data?.alerts.status==='unavailable'?'Alerts could not be checked.':activeAlerts.length?'See active alerts above.':data?.alerts.value?'No active alerts returned for this point.':'Checking alerts…'} Alerts apply now; they do not certify future conditions.</p><p>Weather grid ${weatherById[s.id]?`${weatherById[s.id].grid.lat.toFixed(3)}, ${weatherById[s.id].grid.lon.toFixed(3)}`:'unavailable'}. ${data?.spot.referenceName?'Tide/current reference area: '+esc(data.spot.referenceName)+'. ':''}Offshore wave heights are not breaking-wave heights at the beach. Forecast skill generally declines farther ahead.</p><p>Open-Meteo weather and marine data: CC BY 4.0; marine attribution to DWD. Coastline: Natural Earth. Terrain: USGS / Mapzen. Roads: © OpenStreetMap contributors. Shoreline shading is decorative, not depth data.</p></details><button class="log-trip" id="log-selected">＋ Log a trip here</button>${custom.some(x=>x.id===selected)?'<button class="log-trip" id="edit-pin">Edit this pin</button>':''}`;
$('#log-selected').onclick=()=>openTrip();$('#inspector').querySelectorAll('[data-window]').forEach(b=>b.onclick=()=>jumpTo(Number(b.dataset.window)));if($('#edit-pin'))$('#edit-pin').onclick=()=>openPin(getSpot());}
function renderTime(){const list=days(),date=pacificDate(timestamp()),selectedDay=list.find(d=>d.key===date);$('#time-label').textContent=`${dayTitle(timestamp())} · ${clock(timestamp())}`;$('#days').innerHTML=list.map(d=>`<button data-time="${d.t}" class="${date===d.key?'selected':''}">${d.key===pacificDate()?'Today':weekday(d.t)}<small>${shortDate(d.t)}</small></button>`).join('');$('#days').querySelectorAll('button').forEach(b=>b.onclick=()=>{const oldDate=days().find(d=>d.key===pacificDate(timestamp()));jumpTo(Number(b.dataset.time)+(oldDate?timestamp()-oldDate.t:0))});const indices=forecastTimes.map((t,i)=>({t,i})).filter(o=>pacificDate(o.t)===date);$('#hour').disabled=!indices.length;$('#hour').min=indices[0]?.i??0;$('#hour').max=indices.at(-1)?.i??23;$('#hour').value=hour;$('#timeline-note').textContent=weatherMeta[selected]?.status==='stale'?'Cached forecast · refresh unavailable':'Shared time axis · Pacific · click the chart or move the slider';renderConditionsChart();}
function render(){renderList();renderMap();renderInspector();layoutLocation();renderTime();renderBanner()}
async function loadDetails(id,force=false){if(detailLoading.has(id)||(!force&&detailsById[id]&&Date.now()-detailsById[id].servedAt<5*60000))return;detailLoading.add(id);if(selected===id)renderBanner();try{const d=await api('/api/spot?id='+encodeURIComponent(id));detailsById[id]=d;if(d.weather.value){weatherById[id]=d.weather.value;weatherMeta[id]=d.weather;setTimes(d.weather.value.hours.map(r=>r.time))}delete detailErrors[id]}catch(e){detailErrors[id]=e.message}finally{detailLoading.delete(id);if(selected===id)render()}}
function setTimes(times){if(!forecastTimes.length){forecastTimes=times;hour=nearestHour(Date.now()/1000)}else if(forecastTimes[0]!==times[0]){const previous=timestamp();forecastTimes=times;hour=nearestHour(previous)}}
async function loadOverview(){try{const d=await api('/api/overview');if(!d.value)throw Error(d.error||'Forecast unavailable');for(const[id,value]of Object.entries(d.value)){weatherById[id]=value;weatherMeta[id]={status:d.status,fetchedAt:d.fetchedAt}}setTimes(Object.values(d.value)[0].hours.map(r=>r.time));overallError=null}catch(e){overallError=e.message}render()}
function selectSpot(id){if(!spots.some(s=>s.id===id))return;navigate('spot/'+encodeURIComponent(id))}
function previewSpot(id){if(!spots.some(s=>s.id===id))return;selected=id;focusedSource=null;render();loadDetails(id)}
$('#hour').oninput=e=>setHour(e.target.value);$('#now').onclick=()=>jumpTo(Date.now()/1000);$('#refresh').onclick=async()=>{await Promise.all([loadOverview(),loadDetails(selected,true)])};
$('#wind-limit').oninput=e=>{limit=Number(e.target.value);$('#limit-label').value=limit;renderInspector();layoutLocation();renderTime()};$('#wind-limit').onchange=async()=>{const old=local.prefs.windLimit;if(!await persist({...local,prefs:{windLimit:limit}})){limit=old;$('#wind-limit').value=old;$('#limit-label').value=old}render()};
function changeZoom(next){const old=zoom;zoom=Math.min(3.5,Math.max(.8,next));panX*=zoom/old;panY*=zoom/old;renderMap()}
$('#source-toggle').onclick=()=>{showSources=!showSources;renderMap()};
$('#zoom-in').onclick=()=>changeZoom(zoom+.35);$('#zoom-out').onclick=()=>changeZoom(zoom-.35);$('#reset-map').onclick=()=>{if(currentPage==='location'){const[x,y]=project(getSpot().lon,getSpot().lat);zoom=2.6;panX=(400-x)*zoom;panY=(340-y)*zoom}else{zoom=1;panX=panY=0}renderMap()};
let dragStart=null;const mapPoint=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform($('#map').getScreenCTM().inverse());
$('#map').addEventListener('pointerdown',e=>{dragged=false;if(adding||e.button!==0)return;const p=mapPoint(e);dragStart={x:p.x,y:p.y,panX,panY}});
$('#map').addEventListener('pointermove',e=>{if(!dragStart)return;const p=mapPoint(e),dx=p.x-dragStart.x,dy=p.y-dragStart.y;if(Math.hypot(dx,dy)>4){dragged=true;$('#map').setPointerCapture(e.pointerId)}if(dragged){panX=dragStart.panX+dx;panY=dragStart.panY+dy;$('#geography').setAttribute('transform',mapTransform());$('#map-annotations').setAttribute('transform',mapTransform());$('#map').classList.add('dragging')}});
function endDrag(){dragStart=null;$('#map').classList.remove('dragging');declutterMapLabels()}
$('#map').addEventListener('pointerup',endDrag);$('#map').addEventListener('pointercancel',endDrag);$('#map').addEventListener('keydown',e=>{if(e.target!==$('#map'))return;const moves={ArrowLeft:[30,0],ArrowRight:[-30,0],ArrowUp:[0,30],ArrowDown:[0,-30]};if(moves[e.key]){e.preventDefault();panX+=moves[e.key][0];panY+=moves[e.key][1];renderMap()}});
function pinMode(on){adding=on;$('#pin-instruction').hidden=!on;$('#map').style.cursor=on?'crosshair':'';$('#add-pin').classList.toggle('selected',on)}
$('#add-pin').onclick=()=>{if(!stateReady){notice('Local data is unavailable. Reload before creating a pin.');return}pinMode(!adding)};$('#cancel-pin').onclick=()=>pinMode(false);
function openPin(spot=null){editingPin=spot?.id??null;$('#pin-form').reset();if(spot){pending=[spot.lon,spot.lat];$('#pin-name').value=spot.name;$('#pin-notes').value=spot.notes;$('#pin-exposure').value=spot.exposure}let nearest=presets.reduce((a,b)=>distanceMiles({lat:pending[1],lon:pending[0]},a)<distanceMiles({lat:pending[1],lon:pending[0]},b)?a:b);const ref=spot?.referenceId??nearest.id;$('#pin-reference').innerHTML=presets.map(s=>`<option value="${s.id}" ${ref===s.id?'selected':''}>${esc(s.name)}</option>`).join('');if(!spot)$('#pin-exposure').value=nearest.exposure==='Bay shoreline'?'Bay shoreline':'Open coast';$('#pin-coordinates').textContent=`${pending[1].toFixed(4)}° N / ${Math.abs(pending[0]).toFixed(4)}° W`;$('#delete-pin').hidden=!spot;$('#pin-dialog').showModal()}
$('#map').onclick=e=>{if(!adding||dragged)return;const p=mapPoint(e);pending=unproject((p.x-400+400*zoom-panX)/zoom,(p.y-340+340*zoom-panY)/zoom);if(pending[1]<37.4||pending[1]>38.04||pending[0]<-122.85||pending[0]>-122.08){notice('Choose a point inside the atlas region.');return}openPin()};
$('#pin-form').onsubmit=async e=>{e.preventDefault();const name=$('#pin-name').value.trim();if(!name)return;const spot={id:editingPin??crypto.randomUUID(),name,notes:$('#pin-notes').value.trim(),lon:pending[0],lat:pending[1],region:'YOUR SPOTS',exposure:$('#pin-exposure').value,referenceId:$('#pin-reference').value};const updated=editingPin?custom.map(s=>s.id===spot.id?spot:s):[...custom,spot];if(!await persist({...local,spots:updated}))return;$('#pin-dialog').close();pinMode(false);delete detailsById[spot.id];selectSpot(spot.id)};
$('#delete-pin').onclick=async()=>{if(!confirm('Remove this pin? Its journal entries will remain.'))return;const id=editingPin;if(await persist({...local,spots:custom.filter(s=>s.id!==id)})){$('#pin-dialog').close();selectSpot('crissy')}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
function layoutLocation(){
 const spot=getSpot();$('#detail-title').textContent=spot.name;$('#detail-region').textContent=spot.region+' / '+spot.exposure;$('#detail-subtitle').textContent=`${spot.lat.toFixed(3)}° N / ${Math.abs(spot.lon).toFixed(3)}° W · ${spot.access??'Personal pin'}`;
 $('#detail-location').innerHTML=spots.map(s=>`<option value="${s.id}" ${s.id===selected?'selected':''}>${esc(s.name)}</option>`).join('');
 const inspector=$('#inspector');
 $('#detail-metrics').replaceChildren(...inspector.querySelectorAll(':scope > .metrics,:scope > .assessment'));
 $('#detail-sessions').replaceChildren(...inspector.querySelectorAll(':scope > .window'));
 inspector.querySelectorAll(':scope > .spot-title,:scope > h2,:scope > .location-sub').forEach(el=>el.remove());
 const notes=[...inspector.querySelectorAll(':scope > details')].find(el=>el.querySelector('summary')?.textContent==='Shore notes');if(notes)notes.open=true;
}
function navigate(route){const hash='#'+route;if(location.hash!==hash)history.pushState(null,'',hash);applyRoute()}
function applyRoute(){
 const route=location.hash.slice(1);let id=null;try{id=route.startsWith('spot/')?decodeURIComponent(route.slice(5)):null}catch{}
 const next=route==='journal'?'journal':route==='settings'?'settings':id&&spots.some(s=>s.id===id)?'location':'atlas';
 const changed=next!==currentPage||(next==='location'&&id!==selected);
 if(next==='location'){
  if(!atlasCamera)atlasCamera={zoom,panX,panY};
  selected=id;focusedSource=null;
  if(changed){const[x,y]=project(getSpot().lon,getSpot().lat);zoom=2.6;panX=(400-x)*zoom;panY=(340-y)*zoom}
  $('#detail-map-slot').append($('#map-panel'));
 }else if(next==='atlas'){
  $('#atlas-map-slot').append($('#map-panel'));
  if(currentPage!=='atlas'&&atlasCamera){({zoom,panX,panY}=atlasCamera);atlasCamera=null}
 }
 currentPage=next;document.body.dataset.page=next;
 $('#atlas-view').hidden=next!=='atlas';$('#location-view').hidden=next!=='location';$('#journal-view').hidden=next!=='journal';$('#settings-view').hidden=next!=='settings';
 $('#atlas-tab').classList.toggle('selected',next==='atlas'||next==='location');$('#journal-tab').classList.toggle('selected',next==='journal');$('#settings-tab').classList.toggle('selected',next==='settings');
 if(next==='journal')renderJournal();else if(next!=='settings'){render();if(next==='location')loadDetails(selected)}
 if(changed){window.scrollTo(0,0);if(next==='location')$('#detail-title').focus({preventScroll:true})}
 document.title=next==='location'?getSpot().name+' — Hengelen':next==='journal'?'Journal — Hengelen':next==='settings'?'Settings — Hengelen':'Hengelen — Field atlas';
}
function switchView(journal){navigate(journal?'journal':'atlas')}
$('#atlas-tab').onclick=()=>switchView(false);$('#journal-tab').onclick=()=>switchView(true);$('#settings-tab').onclick=()=>navigate('settings');
$('#back-atlas').onclick=()=>navigate('atlas');$('#detail-location').onchange=e=>selectSpot(e.target.value);
window.addEventListener('hashchange',applyRoute);

function renderJournal(){$('#journal-count').textContent=String(entries.length).padStart(2,'0');$('#entries').innerHTML=entries.length?entries.slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(e=>`<article class="entry"><div class="entry-actions"><button data-edit="${e.id}">Edit</button><button data-delete="${e.id}">Delete</button></div><small>${esc(e.date)}${e.time?' · '+esc(e.time):''} / ${esc(e.spot)}</small><h3>${esc(e.catch||'Time on the water')}</h3><p>${esc(e.notes||'No notes added.')}</p></article>`).join(''):'<p class="empty-journal">No trips yet. A blank page is a good place to start.<br>Log a session, even if all you caught was a little practice.</p>';$('#entries').querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this journal entry? A previous copy is kept in your local backup file.'))return;if(await persist({...local,entries:entries.filter(e=>e.id!==b.dataset.delete)}))renderJournal()});$('#entries').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openTrip(entries.find(e=>e.id===b.dataset.edit)))}
function tripForecastNote(spot=getSpot(),date=$('#trip-date').value,time=$('#trip-time').value){
 const requested=`${date} · ${time} Pacific`,forecastTime=forecastTimeFor(weatherById[spot.id]?.hours,date,time),detail=detailsById[spot.id];
 if(forecastTime===null)return `FORECAST CONTEXT — ${spot.name}
Session: ${requested}
Forecast unavailable for this date and time. No unrelated conditions were attached.
Saved forecast context, not an observation.

ON THE WATER
Actual wind / casting comfort:
Water clarity:
Bait seen / fish activity:
Fly / retrieve / lessons: `;
 const c=atTime(weatherById[spot.id]?.hours,forecastTime),tide=displayTideAt(detail,forecastTime);
 return `FORECAST CONTEXT — ${spot.name}
Session: ${requested}
Forecast hour: ${pacificDate(forecastTime)} · ${clock(forecastTime)} Pacific
Wind ${fmt(c?.wind,0)} kn, gusts ${fmt(c?.gust,0)} kn, from ${directionName(c?.direction)} (${weatherMeta[spot.id]?.status??'unavailable'}).
Tide ${tide?.estimated?'approximately ':''}${fmt(tide?.value)} ft MLLW (${detail?.tides.status??'unavailable'}); reference: ${detail?.spot.tideStation?.name??'unavailable'}.
Saved forecast context, not an observation.

ON THE WATER
Actual wind / casting comfort:
Water clarity:
Bait seen / fish activity:
Fly / retrieve / lessons: `;
}
function openTrip(entry=null){if(!stateReady){notice('Local data is unavailable. Reload before saving a trip.');return}editingTrip=entry?.id??null;tripDraftVersion++;tripSnapshotPrefix=null;$('#trip-form').reset();const names=[...new Set([...spots.map(s=>s.name),...(entry?[entry.spot]:[])])];$('#trip-spot').innerHTML=names.map(name=>`<option ${name===(entry?.spot??getSpot().name)?'selected':''}>${esc(name)}</option>`).join('');$('#trip-date').value=entry?.date??pacificDate(timestamp());$('#trip-time').value=entry?entry.time||'':inputClock(timestamp());$('#trip-catch').value=entry?.catch??'';$('#trip-notes').value=entry?.notes??tripForecastNote();if(!entry)tripSnapshotPrefix=forecastPrefix($('#trip-notes').value);$('#trip-dialog').showModal()}
function forecastPrefix(note){const end=note.indexOf('\n\nON THE WATER');return end<0?'':note.slice(0,end+2)}
function refreshTripSnapshot(spot){
 const notes=$('#trip-notes');
 if(tripSnapshotPrefix&&notes.value.startsWith(tripSnapshotPrefix)){
  const next=forecastPrefix(tripForecastNote(spot,$('#trip-date').value,$('#trip-time').value));
  notes.value=next+notes.value.slice(tripSnapshotPrefix.length);
  tripSnapshotPrefix=next;
 }
}
async function refreshTripContext(){
 if(editingTrip)return; // Existing journal entries retain their recorded observations.
 const version=++tripDraftVersion,spot=spots.find(s=>s.name===$('#trip-spot').value);
 if(!spot)return;
 refreshTripSnapshot(spot);
 await loadDetails(spot.id);
 if(version===tripDraftVersion&&$('#trip-dialog').open&&$('#trip-spot').value===spot.name)refreshTripSnapshot(spot);
}
$('#trip-spot').onchange=refreshTripContext;$('#trip-date').onchange=refreshTripContext;$('#trip-time').onchange=refreshTripContext;
$('#new-entry').onclick=()=>openTrip();$('#trip-form').onsubmit=async e=>{e.preventDefault();const entry={id:editingTrip??crypto.randomUUID(),spot:$('#trip-spot').value,date:$('#trip-date').value,time:$('#trip-time').value,catch:$('#trip-catch').value.trim(),notes:$('#trip-notes').value.trim()};const next=editingTrip?entries.map(e=>e.id===editingTrip?entry:e):[...entries,entry];if(!await persist({...local,entries:next}))return;$('#trip-dialog').close();renderJournal();switchView(true)};
async function boot(){try{applyLocal(await api('/api/state'));stateReady=true;if(local.revision===0){const oldSpots=read('hengelen-spots',[]),oldEntries=read('hengelen-journal',[]),oldLimit=read('hengelen-limit',10);if(oldSpots.length||oldEntries.length||oldLimit!==10){const imported=oldSpots.map(s=>({...s,referenceId:presets.reduce((a,b)=>distanceMiles(s,a)<distanceMiles(s,b)?a:b).id,exposure:s.exposure==='Open coast'?'Open coast':'Bay shoreline'}));await persist({...local,spots:imported,entries:oldEntries,prefs:{windLimit:oldLimit}})}}}catch(e){notice(e.message)}renderJournal();applyRoute();await Promise.all([loadOverview(),loadDetails(selected)]);}
render();boot();
fetch('coast.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{coasts=d;renderMap()}).catch(()=>notice('Coastline unavailable. Refresh to try again.'));
fetch('detail.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{mapDetail=d;renderMap()}).catch(()=>notice('Terrain detail unavailable; base coastline still shown.'));
setInterval(()=>{if(document.hidden)return;loadOverview();loadDetails(selected,true)},10*60000);

function planningWindows(spot=getSpot(),from=Date.now()/1000){
 return distinctWindows(fishingWindows({weather:weatherById[spot.id],weatherStatus:weatherMeta[spot.id]?.status,detail:detailsById[spot.id],spot,limit,now:from}).filter(w=>pacificDate(w.start)===pacificDate(timestamp())),3);
}
function windowCards(windows){
 if(!windows.length)return '<p class="empty-chart">No matching two-hour sessions on this day. Try another day or spot. Fresh wind/gust data and a full daylight interval are required.</p>';
 return windows.map(w=>`<article class="session-card"><button data-window="${w.start}"><span>${clock(w.start)}–${clock(w.end)}<small>${w.provisional?'PROVISIONAL · DATA GAPS':'WORTH CONSIDERING'}</small></span><span>↗</span></button><ul>${w.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>${w.cautions.length?`<p class="session-tradeoff">${w.cautions.map(esc).join(' · ')}</p>`:''}${w.missing.length?`<p class="session-missing">Missing context: ${w.missing.map(esc).join(' · ')}</p>`:''}</article>`).join('');
}
function renderConditionsChart(){
 const host=$('#conditions-chart'),width=Math.max(1,host.clientWidth);
 if(width<2)return;
 const detail=detailsById[selected],weather=weatherById[selected];
 host.innerHTML=conditionsTimeline({hours:dayRows(weather?.hours),tides:detail?.tides.value??[],highLow:detail?.highLow.value??[],currents:detail?.currents.value??[],sun:weather?.days??[],windows:planningWindows(),selected:timestamp(),limit,width,tideStatus:detail?.tides.status,highLowStatus:detail?.highLow.status,currentStatus:detail?.currents.status,currentStation:detail?.spot.currentStation?.name,weatherStatus:weatherMeta[selected]?.status});
 host.onclick=e=>{const svg=host.querySelector('svg');if(!svg)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()),rows=dayRows(weather?.hours);if(point.x<44||point.x>width-12||!rows.length)return;jumpTo(rows[0].time+(point.x-44)/(width-56)*rows.length*3600)};
 $('#timeline-source').textContent=`Tides: ${detail?.spot.tideStation?.name??'loading reference'} · Currents: ${detail?.spot.currentStation?.name??'no assigned reference'}. Tide height does not indicate current speed.`;
 renderComparison();
}
function renderComparison(){
 const host=$('#spot-comparison');if(!host||!comparisonOpen)return;
 host.innerHTML=`<p class="comparison-heading">${dayTitle(timestamp())} · ${clock(timestamp())}–${clock(timestamp()+7200)}${comparisonLoading?' · loading references…':''}</p><div class="comparison-grid">${spots.map(spot=>{
 const w=weatherById[spot.id],detail=detailsById[spot.id],c=atTime(w?.hours,timestamp());
 const candidate=fishingWindows({weather:w,detail,spot,limit,weatherStatus:weatherMeta[spot.id]?.status,now:timestamp()}).find(r=>r.start===timestamp());
 let summary=candidate?candidate.reasons.join(' · '):!c?'Forecast unavailable':weatherMeta[spot.id]?.status!=='ok'?'Fresh forecast unavailable':`No matching two-hour daylight session within your wind limits · wind ${fmt(c.wind,0)} / gusts ${fmt(c.gust,0)} kn`;
 return `<article class="comparison-card"><button data-compare-spot="${spot.id}" class="${spot.id===selected?'selected':''}">${esc(spot.name)} ↗</button><p>${esc(summary)}</p>${candidate?`<small>${esc([...candidate.cautions,...candidate.missing].join(' · ')||'Reference data available; local shore conditions still need checking.')}</small>`:''}${!detail?'<small>Detailed references not loaded yet.</small>':''}</article>`;
 }).join('')}</div>`;
 host.querySelectorAll('[data-compare-spot]').forEach(b=>b.onclick=()=>selectSpot(b.dataset.compareSpot));
}
$('#compare-spots').onclick=async()=>{
 comparisonOpen=!comparisonOpen;$('#spot-comparison').hidden=!comparisonOpen;$('#compare-spots').setAttribute('aria-expanded',String(comparisonOpen));
 if(!comparisonOpen)return;comparisonLoading=true;renderComparison();
 const pending=spots.map(s=>s.id);await Promise.all(Array.from({length:3},async()=>{while(pending.length){await loadDetails(pending.shift());renderComparison()}}));
 comparisonLoading=false;renderComparison();
};

let chartResizeFrame=0;
new ResizeObserver(()=>{cancelAnimationFrame(chartResizeFrame);chartResizeFrame=requestAnimationFrame(renderConditionsChart)}).observe($('#conditions-chart'));
