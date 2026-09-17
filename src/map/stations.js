export function symbolFor(layer,properties) {
  const r=layer.renderer;
  if(r.type==='uniqueValue') {
    const value=[r.field1,r.field2,r.field3].filter(Boolean).map(f=>properties[f] ?? '').join(r.fieldDelimiter || ', ');
    return r.uniqueValueInfos.find(i=>String(i.value)===value)?.symbol || r.defaultSymbol;
  }
  if(r.type==='classBreaks') return r.classBreakInfos.find(i=>Number(properties[r.field])<=i.classMaxValue)?.symbol || r.defaultSymbol;
  return r.symbol;
}

export const stationName=properties=>String(properties.StationID || properties.Station || properties.Name1 || properties.Name || properties.IME || '').trim();

// Newer/topmost explicitly styled station records win over older copies.
// Keep the source records intact for the attribute tables; do not invent markers
// for values the source renderer excludes (notably the red override layer).
export function stationRecords(layers) {
  const chosen=[];
  for(const {definition,data} of [...layers].reverse()) {
    for(const feature of data?.features || []) {
      if(!symbolFor(definition,feature.properties)) continue;
      const name=stationName(feature.properties),equipment=feature.properties.Equipment;
      const duplicate=chosen.some(previous=>{
        if(previous.definition.id===definition.id) return false;
        const old=previous.feature;
        // This deduplication applies to the repeated NFO station collections,
        // not independent instruments in the nationwide equipment inventory.
        if(!/EPOS_locations|NFO_stations/.test(definition.sourceId) || !/EPOS_locations|NFO_stations/.test(previous.definition.sourceId)) return false;
        if(name && name===stationName(old.properties)) return true;
        const [lon,lat]=feature.geometry.coordinates,[oldLon,oldLat]=old.geometry.coordinates;
        // PPTJ1 was renamed TTPJ in the 2024 collection, at the same site.
        return equipment===old.properties.Equipment && feature.properties.Station===old.properties.Station && Math.hypot((lon-oldLon)*Math.cos(lat*Math.PI/180),lat-oldLat)*111320<5;
      });
      if(!duplicate) chosen.push({definition,feature});
    }
  }
  return chosen;
}
