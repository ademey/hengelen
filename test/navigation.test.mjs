import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function setup(){
 const nodes=new Map(),events={};const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,classList:{toggle(){}},append(child){this.child=child},focus(){},dispatchEvent(){}});return nodes.get(id)};
 const context=vm.createContext({$,currentPage:'atlas',atlasCamera:null,selected:null,focusedSource:null,zoom:1.7,panX:42,panY:-18,spots:[{id:'crissy',name:'Crissy'},{id:'kirby',name:'Kirby'}],renders:0,loaded:[],location:{hash:''},document:{body:{dataset:{}},title:'',addEventListener(name,fn){events['document:'+name]=fn}},window:{scrollTo(){},addEventListener(name,fn){events[name]=fn}},render(){context.renders++},renderJournal(){},loadDetails(id){context.loaded.push(id)},project:()=>[300,250],getSpot:()=>({lon:0,lat:0,name:'Selected shoreline'}),history:{pushState(_a,_b,hash){context.location.hash=hash}}});
 const selectStart=app.indexOf('function selectSpot(');vm.runInContext(app.slice(selectStart,app.indexOf("$('#hour')",selectStart)),context);vm.runInContext(app.slice(app.indexOf('function navigate('),app.indexOf('\nfunction renderJournal(')),context);return {context,$,events};
}
test('atlas marker preview changes selection without changing the camera or route',()=>{
 const {context:c}=setup();vm.runInContext("previewSpot('kirby')",c);assert.equal(c.selected,'kirby');assert.equal(c.location.hash,'');assert.equal(c.zoom,1.7);assert.equal(c.panX,42);assert.equal(c.panY,-18);assert.equal(c.renders,1);assert.deepEqual([...c.loaded],['kirby']);
});
test('atlas starts without a selection and an outside pointer dismisses a marker preview',()=>{
 const {context:c,events}=setup();assert.equal(c.selected,null);vm.runInContext("previewSpot('kirby')",c);events['document:pointerdown']({target:{closest(){return null}}});assert.equal(c.selected,null);assert.equal(c.renders,2);
});
test('spot navigation opens details and returning restores the atlas camera',()=>{
 const {context:c,$}=setup();vm.runInContext("navigate('spot/kirby')",c);assert.equal(c.currentPage,'location');assert.equal(c.selected,'kirby');assert.equal($('#atlas-view').hidden,true);assert.equal($('#location-view').hidden,false);assert.equal($('#detail-map-slot').child,$('#map-panel'));
 vm.runInContext("navigate('atlas')",c);assert.equal(c.selected,null);assert.equal(c.zoom,1.7);assert.equal(c.panX,42);assert.equal(c.panY,-18);assert.equal($('#atlas-map-slot').child,$('#map-panel'));
});
test('journal, settings, direct links, and hash navigation show the right page',()=>{
 const {context:c,$,events}=setup();vm.runInContext("navigate('journal')",c);assert.equal($('#journal-view').hidden,false);assert.equal($('#location-view').hidden,true);
 vm.runInContext("navigate('settings')",c);assert.equal(c.currentPage,'settings');assert.equal($('#settings-view').hidden,false);assert.equal($('#journal-view').hidden,true);
 c.location.hash='#spot/crissy';events.hashchange();assert.equal(c.currentPage,'location');assert.equal($('#journal-view').hidden,true);
 c.location.hash='#atlas';events.hashchange();assert.equal(c.currentPage,'atlas');
});
test('invalid location links fall back to the atlas without crashing',()=>{
 const {context:c}=setup();for(const hash of ['#spot/missing','#spot/%invalid']){c.location.hash=hash;vm.runInContext('applyRoute()',c);assert.equal(c.currentPage,'atlas')}
});
