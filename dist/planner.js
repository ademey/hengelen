import {atTime,tideAt,directionName} from './domain.js';
const valid=Number.isFinite;
// Transparent planning preferences, not a trained catch-probability model.
export function fishingWindows({weather,detail,spot,limit=10,now=Date.now()/1000,weatherStatus='ok'}){
 if(weatherStatus!=='ok'||!weather?.hours?.length)return [];
 const out=[],rows=weather.hours;
 for(let i=0;i<rows.length-1;i++){
  const pair=rows.slice(i,i+2),start=pair[0].time,end=start+7200;
  if(start<now||pair[1].time!==start+3600||pair.some(r=>!r.day||!valid(r.wind)||!valid(r.gust)||r.wind>limit||r.gust>limit+3))continue;
  const sun=weather.days?.find(d=>d.sunrise<=start&&d.sunset>=end);
  if(!sun)continue; // Require the whole session to fit between sunrise and sunset.
  const reasons=[],cautions=[],missing=[];let score=0;
  const lowLight=start-sun.sunrise<=5400||sun.sunset-end<=5400;
  if(lowLight){score+=3;reasons.push(start-sun.sunrise<=5400?'Early daylight, near sunrise':'Late daylight, near sunset')}
  const wind=Math.max(...pair.map(r=>r.wind)),gust=Math.max(...pair.map(r=>r.gust));
  reasons.push(`Wind ${wind.toFixed(0)} kn · gusts ${gust.toFixed(0)} kn`);
  score+=(limit-wind)/limit;
  const angle=valid(spot.bearing)&&valid(pair[0].direction)?(pair[0].direction-spot.bearing+360)%360:null;
  if(angle===null)missing.push('Casting direction not assessed');
  else if(angle>30&&angle<150){score-=.5;cautions.push('Wind from your casting-arm side; check your stance')}
  else if(angle>210&&angle<330)reasons.push('Wind from your left for the listed shore orientation');
  else cautions.push(`${angle<=30||angle>=330?'Headwind':'Following wind'} for the listed shore orientation`);
  const a=detail?.tides?.status==='ok'?tideAt(detail.tides.value,start):null,b=detail?.tides?.status==='ok'?tideAt(detail.tides.value,end):null;
  if(a&&b){
   const change=b.value-a.value;
   reasons.push(`Tide ${a.value.toFixed(1)} → ${b.value.toFixed(1)} ft · ${Math.abs(change)<.2?'little net change':change>0?'rising overall':'falling overall'}`);
   if(Math.abs(change)>=.2)score+=1; // Same modest preference for rising and falling water.
   const turn=(detail.highLow?.status==='ok'?detail.highLow.value:[])?.find(e=>e.time>=start&&e.time<end);
   if(turn)cautions.push(`${turn.type==='H'?'High':'Low'} tide occurs within this session`);
  }else missing.push(detail?.tides?.status==='events-only'?'Tide curve is estimated from high/low events; not used in ranking':'Fresh tide curve unavailable');
  const current=detail?.currents?.status==='ok'?detail.currents.value:[];
  const events=current?.filter(e=>e.time>=start&&e.time<end)??[];
  if(current?.some(e=>e.time<=start)&&current.some(e=>e.time>=end)){
   reasons.push(events.length?`Reference current: ${events.map(e=>e.type).join(' / ')} event during session`:'Between reference current events');
  }else missing.push('Current timing not covered by a fresh reference');
  let swell=null;
  if(spot.exposure!=='Bay shoreline'){
   const marine=detail?.marine?.status==='ok'?pair.map(r=>atTime(detail.marine.value?.hours,r.time)):[];
   if(marine.length===2&&marine.every(r=>valid(r?.swell)&&valid(r?.period))){
    swell=Math.max(...marine.map(r=>r.swell));const period=Math.max(...marine.map(r=>r.period));
    cautions.push(`Offshore swell ${swell.toFixed(1)} ft / ${period.toFixed(0)} sec · local breakers unknown`);
    // A modest preference for smaller offshore swell; never a surf safety threshold.
    score-=Math.min(2,swell/4);
   }else missing.push('Fresh offshore swell unavailable');
  }
  if(detail?.alerts?.status!=='ok')missing.push('Latest alert check unavailable');
  else if(detail.alerts.value?.some(a=>!a.expires||Date.parse(a.expires)/1000>start)){cautions.push('Weather alert overlaps this session; review before choosing');score-=4}
  if(pair.some(r=>valid(r.rain)&&r.rain>=40))cautions.push('Rain possible during this session');
  if(start-now>72*3600)cautions.push('More than three days out; recheck closer to the trip');
  const provisional=missing.length>0;
  out.push({start,end,wind,gust,swell,reasons,cautions,missing,provisional,score:score-missing.length*.5,lowLight});
 }
 return out.sort((a,b)=>a.provisional-b.provisional||b.score-a.score||a.start-b.start);
}
export function distinctWindows(windows,count=3){const picked=[];for(const w of windows){if(picked.every(p=>w.end<=p.start||w.start>=p.end))picked.push(w);if(picked.length===count)break}return picked}
