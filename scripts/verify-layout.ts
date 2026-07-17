import { ProjectCatalog } from '../server/project-catalog.js';

const cat = ProjectCatalog.load('.');
const rooms = cat.getRooms();
console.log('rooms:', rooms.length);
for (const r of rooms) {
  const xmin = r.x - r.width / 2, xmax = r.x + r.width / 2;
  const zmin = r.z - r.depth / 2, zmax = r.z + r.depth / 2;
  console.log(r.id, 'x:[', xmin.toFixed(2), xmax.toFixed(2), '] z:[', zmin.toFixed(2), zmax.toFixed(2), ']');
}

let overlap = false;
for (let i = 0; i < rooms.length; i++) {
  for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    const ax1 = a.x - a.width / 2, ax2 = a.x + a.width / 2;
    const az1 = a.z - a.depth / 2, az2 = a.z + a.depth / 2;
    const bx1 = b.x - b.width / 2, bx2 = b.x + b.width / 2;
    const bz1 = b.z - b.depth / 2, bz2 = b.z + b.depth / 2;
    const ox = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    const oz = Math.max(0, Math.min(az2, bz2) - Math.max(az1, bz1));
    if (ox > 0.01 && oz > 0.01) {
      console.log('OVERLAP', a.id, b.id, 'ox', ox.toFixed(3), 'oz', oz.toFixed(3));
      overlap = true;
    }
  }
}
if (!overlap) console.log('No overlaps');
