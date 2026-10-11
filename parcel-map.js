const TILE_SIZE = 256;
const MAX_MERCATOR_LATITUDE = 85.05112878;

export function lonLatToWorldPixel(longitude, latitude, zoom = 18) {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const safeLatitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, Number(latitude)));
  const latitudeRadians = safeLatitude * Math.PI / 180;
  return {
    x: (Number(longitude) + 180) / 360 * worldSize,
    y: (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2 * worldSize
  };
}

export function lonLatToMapPixel(coordinate, center, width, height, zoom = 18) {
  const point = lonLatToWorldPixel(coordinate[0], coordinate[1], zoom);
  const origin = lonLatToWorldPixel(center[0], center[1], zoom);
  return [point.x - origin.x + width / 2, point.y - origin.y + height / 2];
}

export function geometryPolygons(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function traceGeometry(context, geometry, center, width, height, zoom) {
  const polygons = geometryPolygons(geometry);
  for (const polygon of polygons) {
    context.beginPath();
    for (const ring of polygon) {
      ring.forEach((coordinate, index) => {
        const [x, y] = lonLatToMapPixel(coordinate, center, width, height, zoom);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
    }
    context.fill("evenodd");
    context.stroke();
  }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => resolve(image), {once: true});
    image.addEventListener("error", () => reject(new Error("필지 부근 지도를 읽지 못했습니다.")), {once: true});
    image.src = source;
  });
}

function drawParcelOverlay(context, {geometry, longitude, latitude, address, zoom, width, height}) {
  if (geometryPolygons(geometry).length) {
    context.save();
    context.fillStyle = "rgba(245, 29, 118, 0.22)";
    context.strokeStyle = "rgba(255, 255, 255, 0.96)";
    context.lineWidth = 9;
    context.lineJoin = "round";
    traceGeometry(context, geometry, [longitude, latitude], width, height, zoom);
    context.strokeStyle = "#f51d76";
    context.lineWidth = 5;
    traceGeometry(context, geometry, [longitude, latitude], width, height, zoom);
    context.restore();
  }

  const labelHeight = 46;
  context.save();
  context.globalAlpha = 0.9;
  context.fillStyle = "#163d32";
  context.fillRect(0, height - labelHeight, width, labelHeight);
  context.globalAlpha = 1;
  context.fillStyle = "#ffffff";
  context.font = "700 17px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.textAlign = "left";
  context.fillText(String(address || "선택한 필지").slice(0, 52), 20, height - 16);
  context.font = "500 12px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.textAlign = "right";
  context.fillText(geometry ? "VWorld · 선택 필지 경계 강조" : "VWorld · 선택 필지 검색 위치", width - 20, height - 17);
  context.restore();
}

export async function composeVworldTileMap({geometry, longitude, latitude, address, zoom = 18, width = 1024, height = 620}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#dbe3df";
  context.fillRect(0, 0, width, height);

  const center = lonLatToWorldPixel(longitude, latitude, zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const minX = Math.floor(left / TILE_SIZE);
  const maxX = Math.floor((left + width - 1) / TILE_SIZE);
  const minY = Math.floor(top / TILE_SIZE);
  const maxY = Math.floor((top + height - 1) / TILE_SIZE);
  const tiles = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({x, y, drawX: x * TILE_SIZE - left, drawY: y * TILE_SIZE - top});
    }
  }

  const satellite = await Promise.all(tiles.map(async (tile) => ({
    ...tile,
    image: await loadImage(`https://xdworld.vworld.kr/2d/Satellite/service/${zoom}/${tile.x}/${tile.y}.jpeg`).catch(() => null)
  })));
  satellite.forEach((tile) => {
    if (tile.image) context.drawImage(tile.image, tile.drawX, tile.drawY, TILE_SIZE, TILE_SIZE);
  });
  const hybrid = await Promise.all(tiles.map(async (tile) => ({
    ...tile,
    image: await loadImage(`https://xdworld.vworld.kr/2d/Hybrid/service/${zoom}/${tile.x}/${tile.y}.png`).catch(() => null)
  })));
  hybrid.forEach((tile) => {
    if (tile.image) context.drawImage(tile.image, tile.drawX, tile.drawY, TILE_SIZE, TILE_SIZE);
  });

  drawParcelOverlay(context, {geometry, longitude, latitude, address, zoom, width, height});
  return canvas.toDataURL("image/jpeg", 0.92);
}

export async function composeParcelMap({imageDataUrl, geometry, longitude, latitude, address, zoom = 18}) {
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  drawParcelOverlay(context, {
    geometry,
    longitude,
    latitude,
    address,
    zoom,
    width: canvas.width,
    height: canvas.height
  });
  return canvas.toDataURL("image/jpeg", 0.92);
}
