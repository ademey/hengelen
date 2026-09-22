import {estimatedTideRows} from './domain.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(new Date(t*1000));
export function conditionsTimeline({hours,tides=[],highLow=[],currents=[],sun=[],windows=[],selected,limit,width=700,tideStatus,highLowStatus,currentStatus,weatherStatus}){
 if(!hours.length)return '<p class="empty-chart">Waiting for the hourly forecast to set the day’s timeline.</p>';
 const start=hours[0].time,end=hours.at(-1).time+3600,H=430,L=44,R=width-12,x=t=>L+(t-start)/(end-start)*(R-L);
 const inDay=r=>r.time>=start&&r.time<end;
 const estimated=tideStatus==='events-only';
 const tideRows=estimated?estimatedTideRows(highLow,start,end):tides.filter(inDay),events=highLow.filter(inDay).filter(e=>Number.isFinite(e.value)),current=currents.filter(inDay);
 const finite=tideRows.filter(r=>Number.isFinite(r.value)),range=[...finite,...events],lo=range.length?Math.floor(Math.min(...range.map(r=>r.value)))-1:0,hi=range.length?Math.ceil(Math.max(...range.map(r=>r.value)))+1:6;
 const maxWind=Math.max(limit+3, ...hours.flatMap(r=>[r.wind,r.gust]).filter(Number.isFinite))+2;
 const ty=v=>194-(v-lo)/(hi-lo)*140,wy=v=>330-v/maxWind*82;
 const path=(rows,key,y,gap)=>{let previous=null;return rows.map(r=>{if(!Number.isFinite(r[key])){previous=null;return ''}const cmd=previous&&r.time-previous.time<=gap?'L':'M';previous=r;return `${cmd}${x(r.time).toFixed(1)},${y(r[key]).toFixed(1)}`}).join(' ')};
 const grids=(values,y)=>values.map(v=>`<path d="M${L} ${y(v)}H${R}" class="timeline-grid"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${v.toFixed(Number.isInteger(v)?0:1)}</text>`).join('');
 const daylight=sun.filter(d=>d.sunset>start&&d.sunrise<end).map(d=>[Math.max(start,d.sunrise),Math.min(end,d.sunset)]).sort((a,b)=>a[0]-b[0]);
 let cursor=start,night='';for(const [a,b]of [...daylight,[end,end]]){if(a>cursor)night+=`<rect x="${x(cursor)}" y="35" width="${x(a)-x(cursor)}" height="355" class="night-band"/>`;cursor=b}
 const bands=windows.filter(w=>w.start<end&&w.end>start).map(w=>`<rect x="${x(Math.max(start,w.start))}" y="35" width="${x(Math.min(end,w.end))-x(Math.max(start,w.start))}" height="355" class="window-band ${w.provisional?'provisional':''}"><title>${w.provisional?'Provisional session':'Suggested session'} · ${clock(w.start)}–${clock(w.end)}</title></rect>`).join('');
 const ticks=hours.filter((r,i)=>i%6===0).map(r=>r.time);ticks.push(end);
 return `${estimated?'<p class="estimated-tide-caption">Dashed curve: estimated between NOAA high/low predictions (dots). Heights between dots are approximate.</p>':''}<svg viewBox="0 0 ${width} ${H}" class="conditions-chart-svg" role="img" aria-label="${estimated?'Estimated tide curve between NOAA high and low predictions. ':''}Tide height in feet, wind and gusts in knots, and reference current events on a shared Pacific time axis. Shaded bands mark night and suggested sessions.">${night}${bands}
 <text x="${L}" y="20" class="track-title">TIDE · FT / MLLW${estimated?' · ESTIMATED':''}${tideStatus==='stale'||(estimated&&highLowStatus==='stale')?' · CACHED':''}</text>${grids([lo,(lo+hi)/2,hi],ty)}
 ${finite.length?`<path d="${path(tideRows,'value',ty,900)}" class="tide-line${estimated?' estimated-tide-line':''}"/>`:`<text x="${L+8}" y="125">${tideStatus==='events-only'?'Not enough high/low data to estimate':'Tide curve unavailable'}</text>`}
 ${events.map(e=>`<g><circle cx="${x(e.time)}" cy="${ty(e.value)}" r="3.5" class="tide-event-dot"><title>NOAA ${e.type==='H'?'high':'low'} prediction · ${clock(e.time)} · ${e.value.toFixed(1)} ft</title></circle><path d="M${x(e.time)} 199v6" class="event-tick"/><text x="${x(e.time)}" y="218" text-anchor="${x(e.time)<L+45?'start':x(e.time)>R-45?'end':'middle'}">${e.type==='H'?'H':'L'} ${Number(e.value).toFixed(1)}′<title>${clock(e.time)} · ${e.type==='H'?'High':'Low'} tide</title></text></g>`).join('')}
 <text x="${L}" y="242" class="track-title">WIND · KN${weatherStatus==='stale'?' · CACHED':''}</text>${grids([0,Math.round(maxWind/2),maxWind],wy)}<path d="M${L} ${wy(limit)}H${R}" class="comfort-line"/><path d="${path(hours,'gust',wy,3600)}" class="gust-line"/><path d="${path(hours,'wind',wy,3600)}" class="wind-line"/>
 <text x="${L}" y="356" class="track-title">CURRENT EVENTS · REFERENCE STATION${currentStatus==='stale'?' · CACHED':''}</text>
 ${current.length?current.map((e,i)=>`<g><circle cx="${x(e.time)}" cy="${i%2?390:371}" r="3"/><text x="${x(e.time)+6}" y="${i%2?394:375}" text-anchor="${x(e.time)>R-80?'end':'start'}">${esc(e.type)}<title>${clock(e.time)} · ${esc(e.type)} · regional prediction</title></text></g>`).join(''):`<text x="${L}" y="379">No current events available for this day</text>`}
 ${selected>=start&&selected<end?`<path d="M${x(selected)} 32V400" class="selected-time"/>`:''}
 ${ticks.map((t,i)=>`<text x="${x(t)}" y="421" text-anchor="${i===0?'start':i===ticks.length-1?'end':'middle'}">${i===ticks.length-1?'Midnight':clock(t)}</text>`).join('')}</svg>`;
}
