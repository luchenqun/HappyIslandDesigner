import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import LZString from 'lz-string';

const MAP_WIDTH = 112;
const MAP_HEIGHT = 96;
const SCALE = 10;
const VIEW_BOX = { x: -10, y: -5, width: 132, height: 112 };
const OUTPUT_WIDTH = VIEW_BOX.width * SCALE;
const OUTPUT_HEIGHT = VIEW_BOX.height * SCALE;

const COLORS = {
  water: '#83e1c3',
  sand: '#eee9a9',
  level1: '#347941',
  level2: '#35a043',
  level3: '#4ac34e',
  rock: '#737a89',
  pathDirt: '#d5ac71',
  pathSand: '#f9df96',
  pathStone: '#999a8c',
  pathBrick: '#e38f68',
  dock: '#a9926e',
  townsquare: '#e2aa78',
  oceanText: '#57b499',
  oceanDark: '#70cfb6',
};

const EDGE_POSITIONS = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [5, 5],
  [6, 5],
  [6, 4],
  [6, 3],
  [6, 2],
  [6, 1],
  [6, 0],
  [5, 0],
  [4, 0],
  [3, 0],
  [2, 0],
  [1, 0],
  [0, 0],
];

const AMENITY_DEFINITIONS = {
  townhallSprite: {
    asset: 'static/sprite/building-townhall.png',
    scaling: 0.023,
    offset: [-3, -3.6],
    ground: [-3, 0, 12, 10, 1, COLORS.townsquare],
  },
  campsiteSprite: {
    asset: 'static/sprite/building-campsite.png',
    scaling: 0.021,
    offset: [-2, -3.4],
  },
  museumSprite: {
    asset: 'static/sprite/building-museum.png',
    scaling: 0.028,
    offset: [-3.5, -4],
  },
  nookSprite: {
    asset: 'static/sprite/building-nook.png',
    scaling: 0.02,
    offset: [-3.6, -3.6],
  },
  ableSprite: {
    asset: 'static/sprite/building-able.png',
    scaling: 0.021,
    offset: [-2.5, -3.9],
  },
  lighthouseSprite: {
    asset: 'static/sprite/structure-lighthouse.png',
    scaling: 0.015,
    offset: [-1, -1.85],
  },
  airportBlue: {
    asset: 'static/sprite/structure/airport.png',
    scaling: 0.03,
    offset: [-5, -5.5],
  },
  airportRed: {
    asset: 'static/sprite/structure/airport-red.png',
    scaling: 0.03,
    offset: [-5, -5.5],
  },
  airportYellow: {
    asset: 'static/sprite/structure/airport-yellow.png',
    scaling: 0.03,
    offset: [-5, -5.5],
  },
  airportGreen: {
    asset: 'static/sprite/structure/airport-green.png',
    scaling: 0.03,
    offset: [-5, -5.5],
  },
  dock: { shape: 'dock' },
};

const STRUCTURE_DEFINITIONS = {
  tentSprite: {
    asset: 'static/sprite/building-tent.png',
    scaling: 0.022,
    offset: [-2.5, -3.6],
  },
  playerhouseSprite: {
    asset: 'static/sprite/building-playerhouse.png',
    scaling: 0.022,
    offset: [-2.5, -3.6],
  },
  houseSprite: {
    asset: 'static/sprite/building-house.png',
    scaling: 0.02,
    offset: [-2, -3.6],
  },
};

const CONSTRUCTION_SIZES = {
  bridgeStoneHorizontal: [6, 4],
  bridgeStoneVertical: [4, 6],
  bridgeStoneTLBR: [6, 6],
  bridgeStoneTRBL: [6, 6],
  bridgeWoodHorizontal: [6, 4],
  bridgeWoodVertical: [4, 6],
  bridgeWoodTLBR: [6, 6],
  bridgeWoodTRBL: [6, 6],
  stairsStoneUp: [2, 4],
  stairsStoneDown: [2, 4],
  stairsStoneLeft: [4, 2],
  stairsStoneRight: [4, 2],
  stairsWoodUp: [2, 4],
  stairsWoodDown: [2, 4],
  stairsWoodLeft: [4, 2],
  stairsWoodRight: [4, 2],
};

const FLOWER_ASSET_NAMES = {
  cosmos: 'cosmos',
  lily: 'lilies',
  rose: 'roses',
  pansy: 'pansies',
  tulip: 'tulips',
  hyacinth: 'hyacinths',
  chrysanthemum: 'mums',
  poppy: 'windflowers',
};

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function pathData(points, offsetX = 0, offsetY = 0) {
  if (!Array.isArray(points) || points.length < 6 || points.length % 2 !== 0) {
    throw new Error('地图中存在无效的多边形。');
  }
  const commands = [`M ${points[0] + offsetX} ${points[1] + offsetY}`];
  for (let index = 2; index < points.length; index += 2) {
    commands.push(
      `L ${points[index] + offsetX} ${points[index + 1] + offsetY}`,
    );
  }
  commands.push('Z');
  return commands.join(' ');
}

function compoundPath(polygons, color) {
  if (!Array.isArray(polygons) || polygons.length === 0) return '';
  const normalized = typeof polygons[0] === 'number' ? [polygons] : polygons;
  const data = normalized.map((polygon) => pathData(polygon)).join(' ');
  return `<path d="${data}" fill="${color}" fill-rule="nonzero"/>`;
}

function parseGeneratedTileCache(source) {
  const cacheStart = source.indexOf('export const tilesPathsCache');
  const valueStart = source.indexOf('=', cacheStart) + 1;
  const cacheEnd = source.indexOf('\n};', valueStart) + 2;
  if (cacheStart < 0 || valueStart === 0 || cacheEnd < 2) {
    throw new Error('无法读取 app/generatedTilesPathsCache.ts。');
  }
  const tiles = JSON.parse(source.slice(valueStart, cacheEnd));
  const airportMatch = source.match(
    /export const airportOverlaySvg:[^=]+=(\s*"(?:[^"\\]|\\.)*");/,
  );
  return {
    tiles,
    airportSvg: airportMatch ? JSON.parse(airportMatch[1]) : null,
  };
}

function renderEdges(edgeTiles, tiles) {
  if (!Array.isArray(edgeTiles)) return '';
  const grouped = { water: [], sand: [], dock: [], rock: [] };
  EDGE_POSITIONS.forEach(([blockX, blockY], index) => {
    const tile = tiles[edgeTiles[index]];
    if (!tile) throw new Error(`未知的边缘地块编号：${edgeTiles[index]}`);
    for (const type of Object.keys(grouped)) {
      for (const polygon of tile.pathData[type] ?? []) {
        grouped[type].push(pathData(polygon, blockX * 16, blockY * 16));
      }
    }
  });
  return Object.entries(grouped)
    .map(([type, paths]) =>
      paths.length
        ? `<path d="${paths.join(' ')}" fill="${
            COLORS[type]
          }" fill-rule="nonzero"/>`
        : '',
    )
    .join('');
}

function renderAirport(edgeTiles, airportSvg) {
  if (!Array.isArray(edgeTiles) || !airportSvg) return '';
  for (let x = 0; x < 6; x += 1) {
    const left = EDGE_POSITIONS.findIndex(([px, py]) => px === x && py === 5);
    const right = EDGE_POSITIONS.findIndex(
      ([px, py]) => px === x + 1 && py === 5,
    );
    if (edgeTiles[left] === 34 && edgeTiles[right] === 35) {
      const href = `data:image/svg+xml;base64,${Buffer.from(
        airportSvg,
      ).toString('base64')}`;
      return `<image href="${href}" x="${
        (x + 1) * 16 - 4
      }" y="84" width="8" height="8"/>`;
    }
  }
  return '';
}

function parsePngSize(buffer, assetPath) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error(`对象素材不是 PNG：${assetPath}`);
  }
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function constructionDefinition(type) {
  const size = CONSTRUCTION_SIZES[type];
  if (!size) return null;
  const match = type.match(/^(bridge|stairs)(Stone|Wood)(.+)$/);
  if (!match) return null;
  const [, kind, material, direction] = match;
  return {
    asset: `static/sprite/construction/${kind}-${material.toLowerCase()}-${direction.toLowerCase()}.png`,
    scaling: 0.029,
    offset: [-size[0] / 2, -size[1]],
  };
}

function treeDefinition(type) {
  if (type === 'bamboo') {
    return {
      asset: 'static/sprite/tree-bamboo.png',
      scaling: 0.02,
      offset: [-0.6, -0.75],
    };
  }
  const names = {
    tree: 'tree.png',
    treeApple: 'tree-apple.png',
    treeCherry: 'tree-cherry.png',
    treeOrange: 'tree-orange.png',
    treePear: 'tree-pear.png',
    treePeach: 'tree-peach.png',
    treeAutumn: 'tree-autumn.png',
    treeSakura: 'tree-sakura.png',
    pine: 'pine.png',
    palm: 'palm.png',
  };
  return names[type]
    ? {
        asset: `static/sprite/tree/${names[type]}`,
        scaling: 0.014,
        offset: [-0.5, -0.8],
      }
    : null;
}

function flowerDefinition(type) {
  if (type === 'lilyOfTheValley') {
    return { asset: 'static/sprite/flower/lilyofthevalley.png' };
  }
  if (type.startsWith('weed')) {
    const weedName = type.slice(4).toLowerCase();
    return { asset: `static/sprite/flower/weed-${weedName}.png` };
  }
  const match = type.match(
    /^(cosmos|lily|rose|pansy|tulip|hyacinth|chrysanthemum|poppy)(.+)$/,
  );
  if (!match) return null;
  const [, family, color] = match;
  return {
    asset: `static/sprite/flower/${color.toLowerCase()}${
      FLOWER_ASSET_NAMES[family]
    }.png`,
  };
}

function getObjectDefinition(category, type) {
  if (category === 'amenities') return AMENITY_DEFINITIONS[type] ?? null;
  if (category === 'structures') return STRUCTURE_DEFINITIONS[type] ?? null;
  if (category === 'construction') return constructionDefinition(type);
  if (category === 'tree') return treeDefinition(type);
  if (category === 'flower') {
    const definition = flowerDefinition(type);
    return definition
      ? { scaling: 0.016, offset: [-0.5, -0.8], ...definition }
      : null;
  }
  return null;
}

function flattenObjects(objectGroups) {
  const objects = [];
  for (const [key, positions] of Object.entries(objectGroups ?? {})) {
    const separator = key.indexOf('_');
    if (separator < 1) throw new Error(`无效的对象键：${key}`);
    const category = key.slice(0, separator);
    const type = key.slice(separator + 1);
    const definition = getObjectDefinition(category, type);
    if (!definition) throw new Error(`渲染器不支持对象：${key}`);
    for (let index = 0; index < positions.length; index += 2) {
      objects.push({
        category,
        type,
        x: positions[index],
        y: positions[index + 1],
        definition,
      });
    }
  }
  return objects.sort((a, b) => a.y - b.y || a.x - b.x);
}

async function renderObjects(objectGroups, repositoryRoot) {
  const objects = flattenObjects(objectGroups);
  const assets = new Map();
  for (const { definition } of objects) {
    if (!definition.asset || assets.has(definition.asset)) continue;
    const file = await readFile(resolve(repositoryRoot, definition.asset));
    const [width, height] = parsePngSize(file, definition.asset);
    assets.set(definition.asset, {
      href: `data:image/png;base64,${file.toString('base64')}`,
      width,
      height,
    });
  }

  const grounds = [];
  const constructions = [];
  const regular = [];
  for (const object of objects) {
    const { definition, x, y } = object;
    if (definition.ground) {
      const [dx, dy, width, height, radius, fill] = definition.ground;
      grounds.push(
        `<rect x="${x + dx}" y="${
          y + dy
        }" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`,
      );
    }
    let element;
    if (definition.shape === 'dock') {
      element = `<rect x="${x + 0.03}" y="${
        y + 0.18
      }" width="6.94" height="1.67" rx="0.12" fill="${COLORS.dock}"/>`;
    } else {
      const asset = assets.get(definition.asset);
      const scaleX = Array.isArray(definition.scaling)
        ? definition.scaling[0]
        : definition.scaling;
      const scaleY = Array.isArray(definition.scaling)
        ? definition.scaling[1]
        : definition.scaling;
      const width = asset.width * scaleX;
      const height = asset.height * scaleY;
      const [offsetX, offsetY] = definition.offset;
      const left = x - width / 2 - offsetX;
      const top = y - height - offsetY;
      element = `<image href="${asset.href}" x="${left}" y="${top}" width="${width}" height="${height}"/>`;
    }
    (object.category === 'construction' ? constructions : regular).push(
      element,
    );
  }
  return `${grounds.join('')}${constructions.join('')}${regular.join('')}`;
}

function renderGrid() {
  const lines = [];
  for (let x = 0; x < MAP_WIDTH; x += 1) {
    const major = x !== 0 && x % 16 === 0;
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${
        major ? 100 : 96
      }" stroke="#fff" stroke-width="${major ? 0.2 : 0.1}" opacity="${
        major ? 0.5 : 0.2
      }" stroke-linecap="round"/>`,
    );
  }
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const major = y !== 0 && y % 16 === 0;
    lines.push(
      `<line x1="${major ? -4 : 0}" y1="${y}" x2="${
        major ? 116 : 112
      }" y2="${y}" stroke="#fff" stroke-width="${major ? 0.2 : 0.1}" opacity="${
        major ? 0.5 : 0.2
      }" stroke-linecap="round"/>`,
    );
  }
  const labels = [];
  for (let index = 0; index < 7; index += 1) {
    labels.push(
      `<text x="${(index + 0.5) * 16}" y="100" text-anchor="middle">${
        index + 1
      }</text>`,
    );
  }
  for (let index = 0; index < 6; index += 1) {
    labels.push(
      `<text x="-4" y="${
        (index + 0.5) * 16 + 1
      }" text-anchor="middle">${String.fromCharCode(65 + index)}</text>`,
    );
  }
  return `<g>${lines.join('')}</g><g fill="${
    COLORS.oceanText
  }" font-family="TTNorms, Arial, sans-serif" font-size="3">${labels.join(
    '',
  )}</g>`;
}

async function createMapSvg(mapJson, repositoryRoot) {
  const cacheSource = await readFile(
    resolve(repositoryRoot, 'app/generatedTilesPathsCache.ts'),
    'utf8',
  );
  const { tiles, airportSvg } = parseGeneratedTileCache(cacheSource);
  const terrain = Object.entries(mapJson.drawing ?? {})
    .map(([key, polygons]) => {
      const color = COLORS[key];
      if (!color) throw new Error(`渲染器不支持地形图层：${key}`);
      return compoundPath(polygons, color);
    })
    .join('');
  const edges = renderEdges(mapJson.edgeTiles, tiles);
  const airport = renderAirport(mapJson.edgeTiles, airportSvg);
  const objects = await renderObjects(mapJson.objects, repositoryRoot);
  const version = mapJson.version === 'v2' ? 'v2' : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" viewBox="${
    VIEW_BOX.x
  } ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}">
  <rect x="${VIEW_BOX.x}" y="${VIEW_BOX.y}" width="${VIEW_BOX.width}" height="${
    VIEW_BOX.height
  }" fill="${COLORS.water}"/>
  <g>${terrain}</g>
  <g>${edges}${airport}</g>
  <g>${objects}</g>
  ${renderGrid()}
  <g fill="${
    COLORS.oceanDark
  }" font-family="TTNorms, Arial, sans-serif" font-size="2">
    <text x="120" y="105" text-anchor="end">made at eugeneration.github.io/HappyIslandDesigner</text>
    <text x="-8" y="105">${escapeXml(version)}</text>
  </g>
</svg>`;
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    join(
      homedir(),
      'Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ),
  ].filter(Boolean);
  const executableNames = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of executableNames) candidates.push(join(directory, name));
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known Chrome location.
    }
  }
  throw new Error(
    '未找到 Chrome/Chromium；可通过 CHROME_PATH 指定可执行文件。',
  );
}

function runChrome(executable, htmlPath, screenshotPath, profilePath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      executable,
      [
        '--headless=new',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-gpu',
        '--disable-sync',
        '--hide-scrollbars',
        '--no-default-browser-check',
        '--no-first-run',
        '--force-device-scale-factor=1',
        `--window-size=${OUTPUT_WIDTH},${OUTPUT_HEIGHT}`,
        `--user-data-dir=${profilePath}`,
        `--screenshot=${screenshotPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { detached: process.platform !== 'win32', stdio: 'ignore' },
    );
    let finished = false;
    const startedAt = Date.now();
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearInterval(pollTimer);
      if (child.exitCode === null && child.signalCode === null) {
        try {
          if (process.platform === 'win32') child.kill('SIGTERM');
          else process.kill(-child.pid, 'SIGTERM');
        } catch {
          // Chrome may have exited between the status check and the signal.
        }
      }
      if (error) reject(error);
      else resolvePromise();
    };
    const pollTimer = setInterval(async () => {
      try {
        if ((await stat(screenshotPath)).size > 0) finish();
      } catch {
        if (Date.now() - startedAt > 30_000) {
          finish(new Error('Chrome 渲染超时，未生成截图。'));
        }
      }
    }, 100);
    child.on('error', finish);
    child.on('exit', (code, signal) => {
      if (!finished && code !== 0) {
        finish(new Error(`Chrome 渲染失败（${code ?? signal}）。`));
      }
    });
  });
}

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
    return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature))
    throw new Error('PNG 签名无效。');
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error('PNG 必须是 8 位、非交错的 RGB/RGBA 图像。');
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[source + x];
      const left = x >= channels ? pixels[target + x - channels] : 0;
      const above = y > 0 ? pixels[target + x - stride] : 0;
      const upperLeft =
        y > 0 && x >= channels ? pixels[target + x - stride - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + above;
      else if (filter === 3) value = raw + Math.floor((left + above) / 2);
      else if (filter === 4)
        value = raw + paethPredictor(left, above, upperLeft);
      else throw new Error(`不支持的 PNG 过滤器：${filter}`);
      pixels[target + x] = value & 255;
    }
  }
  if (channels === 4) return { width, height, data: pixels };
  const rgba = Buffer.alloc(width * height * 4);
  for (
    let source = 0, target = 0;
    source < pixels.length;
    source += 3, target += 4
  ) {
    rgba[target] = pixels[source];
    rgba[target + 1] = pixels[source + 1];
    rgba[target + 2] = pixels[source + 2];
    rgba[target + 3] = 255;
  }
  return { width, height, data: rgba };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([size, typeBuffer, data, checksum]);
}

export function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function messageBundles(message) {
  const bundles = [];
  const bitsPerBundle = 3;
  const bitsPerCharacter = 16;
  const bundlesPerCharacter = Math.floor(bitsPerCharacter / bitsPerBundle);
  const overlapping = bitsPerCharacter % bitsPerBundle;
  let oldCharacter;
  for (let index = 0; index <= message.length; index += 1) {
    const character = message.charCodeAt(index) || 0;
    const currentOverlap = (overlapping * index) % bitsPerBundle;
    if (currentOverlap > 0 && oldCharacter) {
      let mask = 2 ** (bitsPerBundle - currentOverlap) - 1;
      const oldMask = 2 ** bitsPerCharacter * (1 - 2 ** -currentOverlap);
      bundles.push(
        ((character & mask) << currentOverlap) +
          ((oldCharacter & oldMask) >> (bitsPerCharacter - currentOverlap)),
      );
      if (index < message.length) {
        mask =
          2 ** (2 * bitsPerBundle - currentOverlap) * (1 - 2 ** -bitsPerBundle);
        for (let part = 1; part < bundlesPerCharacter; part += 1) {
          bundles.push(
            (character & mask) >>
              ((part - 1) * bitsPerBundle + (bitsPerBundle - currentOverlap)),
          );
          mask <<= bitsPerBundle;
        }
        if ((overlapping * (index + 1)) % bitsPerBundle === 0) {
          mask = 2 ** bitsPerCharacter * (1 - 2 ** -bitsPerBundle);
          bundles.push(
            (character & mask) >> (bitsPerCharacter - bitsPerBundle),
          );
        } else if (
          ((overlapping * (index + 1)) % bitsPerBundle) +
            (bitsPerBundle - currentOverlap) <=
          bitsPerBundle
        ) {
          bundles.push(
            (character & mask) >>
              ((bundlesPerCharacter - 1) * bitsPerBundle +
                (bitsPerBundle - currentOverlap)),
          );
        }
      }
    } else if (index < message.length) {
      let mask = 2 ** bitsPerBundle - 1;
      for (let part = 0; part < bundlesPerCharacter; part += 1) {
        bundles.push((character & mask) >> (part * bitsPerBundle));
        mask <<= bitsPerBundle;
      }
    }
    oldCharacter = character;
  }
  return bundles;
}

export function encodeSteganographicMessage(image, message) {
  const bundles = messageBundles(message);
  if (bundles.length + 16 > image.width * image.height) {
    throw new Error('地图 JSON 超出 PNG 隐写容量。');
  }
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    image.data[pixel * 4 + 3] =
      pixel < bundles.length ? 245 + (bundles[pixel] % 11) : 255;
  }
}

export function decodeSteganographicMessage(image) {
  const bundles = [];
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    let completed = true;
    for (let lookahead = 0; lookahead < 16; lookahead += 1) {
      if (image.data[(pixel + lookahead) * 4 + 3] !== 255) {
        completed = false;
        break;
      }
    }
    if (completed) break;
    bundles.push(image.data[pixel * 4 + 3] - 245);
  }
  let message = '';
  let character = 0;
  let bitCount = 0;
  for (const bundle of bundles) {
    character += bundle << bitCount;
    bitCount += 3;
    if (bitCount >= 16) {
      message += String.fromCharCode(character & 0xffff);
      bitCount %= 16;
      character = bundle >> (3 - bitCount);
    }
  }
  if (character !== 0) message += String.fromCharCode(character & 0xffff);
  return message;
}

export async function renderIslandDesign(inputPath, outputPath) {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const mapJson = JSON.parse(await readFile(input, 'utf8'));
  const svg = await createMapSvg(mapJson, repositoryRoot);
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'happy-island-render-'),
  );
  try {
    const htmlPath = join(temporaryDirectory, 'map.html');
    const screenshotPath = join(temporaryDirectory, 'map.png');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${OUTPUT_WIDTH}px;height:${OUTPUT_HEIGHT}px;overflow:hidden;background:${COLORS.water}}svg{display:block}</style></head><body>${svg}</body></html>`;
    await writeFile(htmlPath, html);
    await runChrome(
      await findChrome(),
      htmlPath,
      screenshotPath,
      join(temporaryDirectory, 'profile'),
    );
    const image = decodePng(await readFile(screenshotPath));
    if (image.width !== OUTPUT_WIDTH || image.height !== OUTPUT_HEIGHT) {
      throw new Error(
        `Chrome 输出尺寸错误：${image.width}x${image.height}，预期 ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}。`,
      );
    }
    const compressedMap = LZString.compressToUTF16(JSON.stringify(mapJson));
    encodeSteganographicMessage(image, compressedMap);
    await writeFile(output, encodePng(image));
    return { width: image.width, height: image.height };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const isCommandLine =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCommandLine) {
  const [
    inputArg = 'design/01.json',
    outputArg = inputArg.replace(/\.json$/i, '.png'),
  ] = process.argv.slice(2);
  try {
    const result = await renderIslandDesign(inputArg, outputArg);
    console.log(
      `Rendered ${outputArg} (${result.width}x${result.height}) from ${inputArg}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
