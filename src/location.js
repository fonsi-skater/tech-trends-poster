// src/location.js
// Location intelligence for the /location + /sethome commands.
// All free, keyless services: Nominatim (reverse geocode), OSRM public
// router (driving distance/duration/route geometry), plus deep links.

const UA = "tech-trends-poster/2.0 (personal telegram bot)";

// Straight-line great-circle distance in km.
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Human-readable place name for coordinates.
export async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.display_name) return data.display_name;
    const addr = data.address || {};
    const parts = [addr.suburb, addr.city || addr.town || addr.village, addr.country]
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  } catch (err) {
    console.warn(`Reverse geocode failed: ${err.message}`);
    return null;
  }
}

// Driving route between two points. Returns null if OSRM is unavailable —
// callers fall back to haversine + deep links.
export async function osrmRoute(from, to) {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route || !route.geometry?.coordinates?.length) return null;
    return {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      // GeoJSON: [[lon, lat], ...]
      geometry: route.geometry.coordinates,
    };
  } catch (err) {
    console.warn(`OSRM routing failed: ${err.message}`);
    return null;
  }
}

export function gmapsDirectionsLink(from, to) {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}`
  );
}

export function osmDirectionsLink(from, to) {
  return (
    `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car` +
    `&route=${from.lat},${from.lon};${to.lat},${to.lon}`
  );
}
