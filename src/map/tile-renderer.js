// Draw buffered MVT geometry inside its own tile viewport. Never turn tile cut
// edges into independent, overlapping map polygons.
export function paintTile(context, vectorLayer, symbolFor, styleFor, pixelRatio = 1, viewport = {}) {
  const hits = [];
  const scale = 256 / vectorLayer.extent * (viewport.scale || 1);
  context.save();
  context.scale(pixelRatio, pixelRatio);
  context.beginPath();
  context.rect(0, 0, 256, 256);
  context.clip();
  for (let i = 0; i < vectorLayer.length; i++) {
    const feature = vectorLayer.feature(i);
    const symbol = symbolFor(feature.properties);
    if (!symbol) continue;
    const style = styleFor(symbol);
    const path = new Path2D();
    for (const ring of feature.loadGeometry()) {
      ring.forEach((point, index) => {
        const method = index === 0 ? 'moveTo' : 'lineTo';
        path[method](point.x * scale - (viewport.offsetX || 0), point.y * scale - (viewport.offsetY || 0));
      });
      if (feature.type === 3) path.closePath();
    }
    if (feature.type === 3 && style.fillOpacity > 0) {
      context.globalAlpha = style.fillOpacity;
      context.fillStyle = style.fillColor;
      context.fill(path, 'evenodd');
    }
    if (style.weight > 0) {
      context.globalAlpha = style.opacity;
      context.strokeStyle = style.color;
      context.lineWidth = style.weight;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.setLineDash(style.dashArray ? style.dashArray.split(/[ ,]+/).map(Number) : []);
      context.stroke(path);
    }
    hits.push({ path, properties: feature.properties, type: feature.type, width: style.weight });
  }
  context.restore();
  return hits;
}
