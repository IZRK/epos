import L from 'leaflet';

const ns='http://www.w3.org/2000/svg';
const svg=(name,attributes={})=>{
  const node=document.createElementNS(ns,name);
  for(const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
  return node;
};
const color=c=>c?`rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255)/255})`:'none';
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const length=line=>line.slice(1).reduce((sum,p,i)=>sum+distance(line[i],p),0);
function labelText(rule,properties) {
  const template=rule.labelExpressionInfo?.value;
  if(template) return template.replace(/\{([^}]+)\}/g,(_,field)=>properties[field] ?? '');
  const field=rule.labelExpressionInfo?.expression?.match(/\$feature(?:\["([^"\]]+)"\]|\.([\w]+))/);
  return field?String(properties[field[1] || field[2]] ?? ''):'';
}
// Clip to the viewport, not individual MVT tiles: labels can cross tile seams.
function visibleLines(line,width,height) {
  const lines=[];let current=[];
  for(let i=1;i<line.length;i++) {
    const a=line[i-1],b=line[i],dx=b.x-a.x,dy=b.y-a.y;
    let start=0,end=1,visible=true;
    for(const [p,q] of [[-dx,a.x-4],[dx,width-4-a.x],[-dy,a.y-4],[dy,height-4-a.y]]) {
      if(p===0) {if(q<0) visible=false;continue;}
      const t=q/p;
      if(p<0) start=Math.max(start,t);else end=Math.min(end,t);
    }
    if(!visible || start>end) {if(current.length>1) lines.push(current);current=[];continue;}
    const first={x:a.x+start*dx,y:a.y+start*dy},last={x:a.x+end*dx,y:a.y+end*dy};
    if(current.length && distance(current.at(-1),first)>1) {lines.push(current);current=[];}
    if(!current.length) current.push(first);
    current.push(last);
  }
  if(current.length>1) lines.push(current);
  return lines;
}
function section(line,start,end) {
  let offset=0;const points=[];
  for(let i=1;i<line.length;i++) {
    const a=line[i-1],b=line[i],span=distance(a,b);
    if(span && offset+span>=start && offset<=end) {
      for(const d of [Math.max(0,start-offset),Math.min(span,end-offset)]) {
        const p={x:a.x+(b.x-a.x)*d/span,y:a.y+(b.y-a.y)*d/span};
        if(!points.length || distance(points.at(-1),p)>.1) points.push(p);
      }
    }
    offset+=span;
  }
  return points;
}

// A single SVG label pass across all visible layers prevents duplicate labels
// and clips neither text nor halos at PMTiles boundaries. No remote label data.
export class ReferenceLabels extends L.Layer {
  constructor(layers) {super();this.layers=layers;this.measure=document.createElement('canvas').getContext('2d');}
  onAdd(map) {
    if(!map.getPane('reference-labels')) {
      const pane=map.createPane('reference-labels');pane.style.zIndex='590';pane.style.pointerEvents='none';
    }
    this.root=svg('svg',{'class':'map-reference-labels','aria-hidden':'true'});
    this.root.style.position='absolute';this.root.style.pointerEvents='none';
    map.getPane('reference-labels').append(this.root);
    map.on('moveend zoomend resize',this.schedule,this);
    map.on('zoomstart',this.hide,this);
    for(const {overlay} of this.layers) overlay.labels=this;
    this.schedule();
  }
  onRemove(map) {
    map.off('moveend zoomend resize',this.schedule,this);map.off('zoomstart',this.hide,this);
    cancelAnimationFrame(this.frame);this.root.remove();
    for(const {overlay} of this.layers) overlay.labels=null;
  }
  hide() {this.root.style.visibility='hidden';}
  schedule() {cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.render());}
  render() {
    if(!this._map || this._map._animatingZoom) return;
    const map=this._map,size=map.getSize(),zoom=map.getZoom(),origin=map.getPixelBounds().min;
    const scale=591657527.591555/2**zoom,candidates=new Map();
    L.DomUtil.setPosition(this.root,map.containerPointToLayerPoint([0,0]));
    this.root.setAttribute('width',size.x);this.root.setAttribute('height',size.y);
    this.root.style.visibility='';this.root.replaceChildren();
    for(const {layer,overlay} of this.layers) {
      if(!map.hasLayer(overlay) || overlay.inScale===false) continue;
      for(const rule of layer.labelingInfo || []) {
        if((rule.minScale && scale>rule.minScale) || (rule.maxScale && scale<rule.maxScale)) continue;
        const symbol=rule.symbol,font=symbol.font,fontSize=font.size*4/3;
        this.measure.font=`${font.style || 'normal'} ${font.weight || 'normal'} ${fontSize}px Arial`;
        const add=(properties,line,point)=>{
          const text=labelText(rule,properties).trim();if(!text) return;
          const width=this.measure.measureText(text).width,key=`${layer.id}/${text}`;
          if(point) {
            candidates.set(key,{key,text,symbol,fontSize,width,point,layer,score:0});return;
          }
          for(let visible of visibleLines(line,size.x,size.y)) {
            const span=length(visible);if(span<width+12) continue;
            if(visible.at(-1).x<visible[0].x) visible=[...visible].reverse();
            const labelLine=section(visible,(span-width)/2-4,(span+width)/2+4);
            // Avoid folding a name around a hairpin bend.
            if(distance(labelLine[0],labelLine.at(-1))<width*.75) continue;
            const score=span;
            if(!candidates.has(key) || candidates.get(key).score<score)
              candidates.set(key,{key,text,symbol,fontSize,width,line:labelLine,layer,score});
          }
        };
        if(overlay.group) overlay.group.eachLayer(marker=>{
          const point=map.latLngToContainerPoint(marker.getLatLng());
          point.x+=(marker.options.icon.options.iconSize[0]/2)+3;
          add(marker.feature.properties,null,point);
        });
        else for(const tile of Object.values(overlay._tiles || {})) {
          if(tile.coords.z!==zoom || !tile.current) continue;
          for(const hit of tile.el.hits || []) if(hit.type===2) {
            for(const line of hit.lines) add(hit.properties,line.map(p=>({x:p.x+tile.coords.x*256-origin.x,y:p.y+tile.coords.y*256-origin.y})));
          }
        }
      }
    }
    const occupied=[];let id=0;
    for(const candidate of [...candidates.values()].sort((a,b)=>b.score-a.score || a.key.localeCompare(b.key))) {
      const {text,symbol,fontSize,width,line,point,layer}=candidate;
      const points=line || [point,{x:point.x+width,y:point.y}];
      const box={left:Math.min(...points.map(p=>p.x))-3,right:Math.max(...points.map(p=>p.x))+3,top:Math.min(...points.map(p=>p.y))-fontSize-5,bottom:Math.max(...points.map(p=>p.y))+3};
      if(box.left<0 || box.top<0 || box.right>size.x || box.bottom>size.y) continue;
      if(occupied.some(b=>box.left<b.right && box.right>b.left && box.top<b.bottom && box.bottom>b.top)) continue;
      occupied.push(box);
      const node=svg('text',{'class':'map-reference-label','data-layer':layer.id,fill:color(symbol.color),stroke:color(symbol.haloColor),'stroke-width':(symbol.haloSize || 0)*8/3,'paint-order':'stroke','stroke-linejoin':'round','font-family':'Arial, sans-serif','font-size':fontSize,'font-weight':symbol.font.weight || 'normal','font-style':symbol.font.style || 'normal',opacity:layer.opacity});
      if(line) {
        const pathId=`fault-label-${L.stamp(this)}-${id++}`;
        const path=svg('path',{id:pathId,d:line.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' '),fill:'none'});
        const along=svg('textPath',{href:`#${pathId}`,startOffset:'50%','text-anchor':'middle'});
        node.setAttribute('dy','-4');along.textContent=text;node.append(along);this.root.append(path);
      } else {node.setAttribute('x',point.x);node.setAttribute('y',point.y+fontSize/3);node.textContent=text;}
      this.root.append(node);
    }
  }
}
