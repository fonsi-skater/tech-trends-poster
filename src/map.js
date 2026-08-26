// src/map.js
// Draws a route onto a static map image: stitches OpenStreetMap tiles for
// the route's bounding box, plots the OSRM geometry as a polyline, and marks
// start/end points. Returns a PNG buffer ready for Telegram sendPhoto.
//
// Tile usage: personal-scale, cached by OSM CDN, proper User-Agent — within
// the OSM tile usage policy (https://operations.osmfoundation.org/policies/tiles/).

import { createCanvas, loadImage } from "@napi-rs/canvas";

const TILE = 256;
const GRID = 4; // 4x4 tiles => 1024x1024 canvas
const MAX_ZOOM = 15;
const UA = "tech-trends-poster/2.0 (personal telegram bot)";

// Web Mercator projection -> fractional tile coordinates at zoom z.
function lonToX(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

function latToY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  return y * Math.pow(2, z);
}

function pickZoom(geometry) {
  const lons = geometry.map((c) => c[0]);
  const lats = geometry.map((c) => c[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  // Largest zoom where the whole route fits inside the tile grid with margin.
  for (let z = MAX_ZOOM; z >= 3; z--) {
    const w = lonToX(maxLon, z) - lonToX(minLon, z);
    const top = latToY(maxLat, z);
    const bottom = latToY(minLat, z);
    if (w <= GRID - 0.5 && bottom - top <= GRID - 0.5 && w > 0.05 && bottom - top > 0.05) {
      return { z, minLon, maxLon, minLat, maxLat };
    }
  }
  return { z: 3, minLon, maxLon, minLat, maxLat };
}

async function fetchTile(z, x, y, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
      return loadImage(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function renderRouteMap(geometry, markers = []) {
  // geometry: [[lon, lat], ...] from OSRM GeoJSON
  const { z, minLon, maxLon, minLat, maxLat } = pickZoom(geometry);

  const centerTileX = (lonToX(minLon, z) + lonToX(maxLon, z)) / 2;
  const centerTileY = (latToY(minLat, z) + latToY(maxLat, z)) / 2;
  const x0 = Math.round(centerTileX - GRID / 2);
  const y0 = Math.round(centerTileY - GRID / 2);
  const size = TILE * GRID;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#aad3df"; // OSM water blue as fallback background
  ctx.fillRect(0, 0, size, size);

  // Fetch + stitch tiles. Any tile that still fails after retries aborts the
  // render — a map with a hole looks broken, so the caller falls back to
  // links-only instead.
  const jobs = [];
  for (let dy = 0; dy < GRID; dy++) {
    for (let dx = 0; dx < GRID; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      jobs.push(
        fetchTile(z, ((tx % Math.pow(2, z)) + Math.pow(2, z)) % Math.pow(2, z), ty)
          .then((img) => ({ dx, dy, img }))
      );
    }
  }
  const placed = await Promise.all(jobs);
  for (const p of placed) {
    ctx.drawImage(p.img, p.dx * TILE, p.dy * TILE);
  }

  // Route polyline (simplified for very long geometries).
  const step = Math.max(1, Math.ceil(geometry.length / 600));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const [width, color] of [
    [7, "rgba(255,255,255,0.9)"],
    [4, "#e63946"],
  ]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < geometry.length; i += step) {
      const px = (lonToX(geometry[i][0], z) - x0) * TILE;
      const py = (latToY(geometry[i][1], z) - y0) * TILE;
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  // Markers.
  for (const m of markers) {
    const px = (lonToX(m.lon, z) - x0) * TILE;
    const py = (latToY(m.lat, z) - y0) * TILE;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.fillStyle = m.color || "#1d3557";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    if (m.label) {
      ctx.font = "bold 16px sans-serif";
      const tw = ctx.measureText(m.label).width;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(px + 12, py - 11, tw + 10, 22);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(m.label, px + 17, py + 5);
    }
  }

  // Attribution (required by OSM).
  ctx.font = "12px sans-serif";
  const attr = "(c) OpenStreetMap contributors";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(size - ctx.measureText(attr).width - 10, size - 20, ctx.measureText(attr).width + 8, 16);
  ctx.fillStyle = "#333333";
  ctx.fillText(attr, size - ctx.measureText(attr).width - 6, size - 8);

  return canvas.encode("png");
}
