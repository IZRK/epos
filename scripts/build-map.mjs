import { build } from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('public/assets/vendor/leaflet',{recursive:true});
await fs.copyFile('node_modules/leaflet/dist/leaflet.css','public/assets/vendor/leaflet/leaflet.css');
await fs.cp('node_modules/leaflet/dist/images','public/assets/vendor/leaflet/images',{recursive:true});
await fs.copyFile('node_modules/leaflet/LICENSE','public/assets/vendor/leaflet/LICENSE');
await build({entryPoints:['src/map/map.js'],outfile:'public/assets/js/map.js',bundle:true,minify:true,format:'esm',target:'es2022',legalComments:'eof'});
