import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import LZString from 'lz-string';
import {
  decodePng,
  decodeSteganographicMessage,
} from './renderIslandDesign.mjs';

const MAP_WIDTH = 112;
const MAP_HEIGHT = 96;

const BUILDING_SIZES = {
  townhallSprite: [6, 4],
  museumSprite: [7, 4],
  nookSprite: [7, 4],
  ableSprite: [5, 4],
  campsiteSprite: [4, 4],
  playerhouseSprite: [5, 4],
  houseSprite: [4, 4],
};

function fail(message) {
  throw new Error(message);
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 2) {
    const next = (i + 2) % points.length;
    area += points[i] * points[next + 1] - points[next] * points[i + 1];
  }
  return area / 2;
}

function contains(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i];
    const yi = points[i + 1];
    const xj = points[j];
    const yj = points[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function compoundContains(polygons, x, y) {
  let winding = 0;
  for (const points of polygons) {
    if (contains(points, x, y)) winding += signedArea(points) >= 0 ? 1 : -1;
  }
  return winding !== 0;
}

function pairs(values) {
  const result = [];
  for (let i = 0; i < values.length; i += 2)
    result.push([values[i], values[i + 1]]);
  return result;
}

function keyForPoint(x, y) {
  return `${x.toFixed(3)},${y.toFixed(3)}`;
}

function assertSymmetricPositions(name, values) {
  const pointSet = new Set(pairs(values).map(([x, y]) => keyForPoint(x, y)));
  for (const [x, y] of pairs(values)) {
    if (!pointSet.has(keyForPoint(MAP_WIDTH - x, y)))
      fail(`${name} is missing the mirror of [${x}, ${y}].`);
  }
}

function assertMirroredPolygons(name, left, right) {
  const rightPoints = new Set(pairs(right).map(([x, y]) => keyForPoint(x, y)));
  for (const [x, y] of pairs(left)) {
    if (!rightPoints.has(keyForPoint(MAP_WIDTH - x, y)))
      fail(`${name} polygons are not mirrored.`);
  }
}

function assertSelfSymmetricPolygon(name, points) {
  const pointSet = new Set(pairs(points).map(([x, y]) => keyForPoint(x, y)));
  for (const [x, y] of pairs(points)) {
    if (!pointSet.has(keyForPoint(MAP_WIDTH - x, y)))
      fail(`${name} is not centered on x = 56.`);
  }
}

function bottomEdgePoints(points) {
  const maxY = Math.max(...points.filter((_, index) => index % 2 === 1));
  return pairs(points)
    .filter(([, y]) => y === maxY)
    .map(([x, y]) => keyForPoint(x, y))
    .sort();
}

function parseObjectKey(key) {
  const separator = key.indexOf('_');
  if (separator === -1) fail(`Invalid object key: ${key}`);
  return [key.slice(0, separator), key.slice(separator + 1)];
}

function overlaps(a, b) {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

async function loadObjectTypes() {
  const files = {
    amenities: 'app/tools/amenities.ts',
    construction: 'app/tools/construction.ts',
    flower: 'app/tools/flower.ts',
    structures: 'app/tools/structure.ts',
    tree: 'app/tools/tree.ts',
  };
  const result = {};
  for (const [category, path] of Object.entries(files)) {
    const source = await readFile(resolve(path), 'utf8');
    result[category] = new Set(
      [...source.matchAll(/^ {2}([A-Za-z0-9]+):/gm)].map((match) => match[1]),
    );
  }
  return result;
}

function validateDrawing(drawing) {
  for (const [layer, polygons] of Object.entries(drawing)) {
    if (!Array.isArray(polygons))
      fail(`${layer} must be an array of polygons.`);
    for (const points of polygons) {
      if (
        !Array.isArray(points) ||
        points.length < 6 ||
        points.length % 2 !== 0
      ) {
        fail(`${layer} contains an invalid polygon.`);
      }
      for (let i = 0; i < points.length; i += 2) {
        const x = points[i];
        const y = points[i + 1];
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > MAP_WIDTH ||
          y < 0 ||
          y > MAP_HEIGHT
        ) {
          fail(`${layer} contains an out-of-bounds point [${x}, ${y}].`);
        }
      }
    }
  }
}

async function validateObjects(design) {
  const knownTypes = await loadObjectTypes();
  const buildings = [];
  for (const [key, values] of Object.entries(design.objects)) {
    const [category, type] = parseObjectKey(key);
    if (!knownTypes[category]?.has(type)) fail(`Unknown object type: ${key}`);
    if (!Array.isArray(values) || values.length % 2 !== 0)
      fail(`${key} has invalid coordinates.`);
    for (const [x, y] of pairs(values)) {
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > MAP_WIDTH ||
        y < 0 ||
        y > MAP_HEIGHT
      ) {
        fail(`${key} contains an out-of-bounds position [${x}, ${y}].`);
      }
      const mayUseWater =
        category === 'construction' ||
        type === 'dock' ||
        type === 'weedCattail';
      if (!mayUseWater && !compoundContains(design.drawing.level1, x, y)) {
        fail(`${key} is placed in water at [${x}, ${y}].`);
      }
      const size = BUILDING_SIZES[type];
      if (size)
        buildings.push({
          key,
          x,
          y,
          left: x - size[0] / 2,
          right: x + size[0] / 2,
          top: y - size[1] / 2,
          bottom: y + size[1] / 2,
        });
    }
  }
  for (let i = 0; i < buildings.length; i += 1) {
    for (let j = i + 1; j < buildings.length; j += 1) {
      if (overlaps(buildings[i], buildings[j])) {
        fail(
          `${buildings[i].key} at [${buildings[i].x}, ${buildings[i].y}] overlaps ${buildings[j].key} at [${buildings[j].x}, ${buildings[j].y}].`,
        );
      }
    }
  }
}

function validateSymmetry(design) {
  const symmetricGroups = Object.entries(design.objects).filter(
    ([key]) =>
      /^(tree|flower)_/.test(key) ||
      key === 'structures_houseSprite' ||
      key === 'construction_bridgeWoodHorizontal' ||
      key === 'construction_stairsWoodUp',
  );
  for (const [key, values] of symmetricGroups)
    assertSymmetricPositions(key, values);

  assertMirroredPolygons(
    'level1 rivers',
    design.drawing.level1[3],
    design.drawing.level1[4],
  );
  assertMirroredPolygons(
    'level1 upper streams',
    design.drawing.level1[5],
    design.drawing.level1[6],
  );
  assertMirroredPolygons(
    'level1 ponds',
    design.drawing.level1[7],
    design.drawing.level1[8],
  );
  assertSelfSymmetricPolygon('mirror lake', design.drawing.level1[1]);
  assertSelfSymmetricPolygon('lake island', design.drawing.level1[2]);
  assertMirroredPolygons(
    'level2 highlands',
    design.drawing.level2[0],
    design.drawing.level2[1],
  );
  assertMirroredPolygons(
    'level3 highlands',
    design.drawing.level3[0],
    design.drawing.level3[1],
  );
}

function parsePng(buffer) {
  const image = decodePng(buffer);
  const compressedMap = decodeSteganographicMessage(image);
  const embeddedJson = LZString.decompressFromUTF16(compressedMap);
  const colors = new Set();
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 8) {
      const pixel = (y * image.width + x) * 4;
      colors.add(image.data.toString('hex', pixel, pixel + 3));
    }
  }
  return {
    width: image.width,
    height: image.height,
    embeddedJson,
    colorCount: colors.size,
  };
}

export async function validateIslandDesign(originPath, designPath, pngPath) {
  const origin = JSON.parse(await readFile(originPath, 'utf8'));
  const designText = await readFile(designPath, 'utf8');
  const design = JSON.parse(designText);

  if (design.version !== 'v2') fail('Design version must be v2.');
  if (
    JSON.stringify(design.drawing.level1[0]) !==
    JSON.stringify(origin.drawing.level1[0])
  )
    fail('Original coastline boundary changed.');
  if (JSON.stringify(design.objects.amenities_townhallSprite) !== '[53,66]')
    fail('Resident Services moved.');
  if (JSON.stringify(design.objects.amenities_dock) !== '[104,84]')
    fail('Dock moved.');
  if (design.objects.structures_houseSprite.length !== 20)
    fail('The design must contain ten villager houses.');

  const originRiverMouths = pairs(origin.drawing.level1[1])
    .filter(([, y]) => y === 83)
    .map(([x, y]) => keyForPoint(x, y))
    .sort();
  const designRiverMouths = [
    ...bottomEdgePoints(design.drawing.level1[3]),
    ...bottomEdgePoints(design.drawing.level1[4]),
  ].sort();
  if (JSON.stringify(designRiverMouths) !== JSON.stringify(originRiverMouths))
    fail('Original river mouth endpoints changed.');

  validateDrawing(design.drawing);
  await validateObjects(design);
  validateSymmetry(design);

  const png = parsePng(await readFile(pngPath));
  if (png.width !== 1320 || png.height !== 1120)
    fail(`Unexpected PNG size: ${png.width}x${png.height}.`);
  if (png.colorCount < 12) fail('PNG does not contain enough visual detail.');
  if (png.embeddedJson !== JSON.stringify(design))
    fail('PNG metadata does not match the design JSON.');

  const treeCount = Object.entries(design.objects)
    .filter(([key]) => key.startsWith('tree_'))
    .reduce((sum, [, values]) => sum + values.length / 2, 0);
  const flowerCount = Object.entries(design.objects)
    .filter(([key]) => key.startsWith('flower_'))
    .reduce((sum, [, values]) => sum + values.length / 2, 0);

  return {
    treeCount,
    flowerCount,
    buildingCount: design.objects.structures_houseSprite.length / 2 + 7,
    ...png,
  };
}

const [
  originArg = 'origin-island.json',
  designArg = 'design/01.json',
  pngArg = designArg.replace(/\.json$/i, '.png'),
] = process.argv.slice(2);

try {
  const result = await validateIslandDesign(
    resolve(originArg),
    resolve(designArg),
    resolve(pngArg),
  );
  console.log(
    `Validated ${designArg}: ${result.treeCount} trees, ${result.flowerCount} plants, ${result.buildingCount} buildings, ${result.width}x${result.height} PNG, ${result.colorCount} sampled colors`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
