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
const PATH_LAYERS = ['pathDirt', 'pathSand', 'pathStone', 'pathBrick'];
const PATH_SAMPLE_STEP = 0.25;
const OBJECT_SAMPLE_STEP = 0.25;
const MAX_BRIDGES = 10;
const MAX_INCLINES = 10;

const BUILDING_FOOTPRINTS = {
  townhallSprite: [-3, 0, 12, 10],
  museumSprite: [0, 0, 7, 4],
  nookSprite: [0, 0, 7, 4],
  ableSprite: [0, 0, 5, 4],
  campsiteSprite: [0, 0, 4, 4],
  playerhouseSprite: [0, 0, 5, 4],
  houseSprite: [0, 0, 4, 4],
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

function bottomEdgePoints(points) {
  const maxY = Math.max(...points.filter((_, index) => index % 2 === 1));
  return pairs(points)
    .filter(([, y]) => y === maxY)
    .map(([x, y]) => keyForPoint(x, y))
    .sort();
}

function riverMouthEndpoints(polygons) {
  return polygons
    .filter(
      (points) =>
        signedArea(points) < 0 && pairs(points).some(([, y]) => y === 83),
    )
    .flatMap((points) => bottomEdgePoints(points))
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

function expandRectangle(rectangle, amount) {
  return {
    left: rectangle.left - amount,
    right: rectangle.right + amount,
    top: rectangle.top - amount,
    bottom: rectangle.bottom + amount,
  };
}

function visitRectangle(rectangle, callback, step = OBJECT_SAMPLE_STEP) {
  for (let y = rectangle.top + step / 2; y < rectangle.bottom; y += step) {
    for (let x = rectangle.left + step / 2; x < rectangle.right; x += step) {
      callback(x, y);
    }
  }
}

function terrainLevelAt(design, x, y) {
  if (compoundContains(design.drawing.level3, x, y)) return 3;
  if (compoundContains(design.drawing.level2, x, y)) return 2;
  if (compoundContains(design.drawing.level1, x, y)) return 1;
  return 0;
}

function assertRectangleOnSingleLevel(design, rectangle, name) {
  let expectedLevel;
  visitRectangle(rectangle, (x, y) => {
    const level = terrainLevelAt(design, x, y);
    if (level === 0)
      fail(`${name} occupies water near [${x.toFixed(2)}, ${y.toFixed(2)}].`);
    if (expectedLevel === undefined) expectedLevel = level;
    if (level !== expectedLevel) {
      fail(
        `${name} crosses terrain levels near [${x.toFixed(2)}, ${y.toFixed(
          2,
        )}].`,
      );
    }
  });
  return expectedLevel;
}

function assertRectangleInWater(design, rectangle, name) {
  visitRectangle(rectangle, (x, y) => {
    if (terrainLevelAt(design, x, y) !== 0) {
      fail(
        `${name} does not span water near [${x.toFixed(2)}, ${y.toFixed(2)}].`,
      );
    }
  });
}

function assertRectangleHasNoPaths(design, rectangle, name) {
  visitRectangle(rectangle, (x, y) => {
    const layer = PATH_LAYERS.find((pathLayer) =>
      compoundContains(design.drawing[pathLayer] ?? [], x, y),
    );
    if (layer) {
      fail(
        `${name} overlaps ${layer} near [${x.toFixed(2)}, ${y.toFixed(2)}].`,
      );
    }
  });
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

function validatePathsOnLand(design) {
  for (const layer of PATH_LAYERS) {
    const polygons = design.drawing[layer] ?? [];
    for (const points of polygons.filter(
      (polygon) => signedArea(polygon) > 0,
    )) {
      const xCoordinates = points.filter((_, index) => index % 2 === 0);
      const yCoordinates = points.filter((_, index) => index % 2 === 1);
      const bounds = {
        left: Math.min(...xCoordinates),
        right: Math.max(...xCoordinates),
        top: Math.min(...yCoordinates),
        bottom: Math.max(...yCoordinates),
      };
      let expectedLevel;
      visitRectangle(
        bounds,
        (x, y) => {
          if (!contains(points, x, y) || !compoundContains(polygons, x, y))
            return;
          const level = terrainLevelAt(design, x, y);
          if (level === 0) {
            fail(
              `${layer} is placed in water near [${x.toFixed(2)}, ${y.toFixed(
                2,
              )}].`,
            );
          }
          if (expectedLevel === undefined) expectedLevel = level;
          if (level !== expectedLevel) {
            fail(
              `${layer} crosses terrain levels near [${x.toFixed(
                2,
              )}, ${y.toFixed(2)}].`,
            );
          }
        },
        PATH_SAMPLE_STEP,
      );
    }
  }
}

function validateCliffInset(design) {
  const lowerPolygons = design.drawing.level2.filter(
    (points) => signedArea(points) > 0,
  );
  const upperPolygons = design.drawing.level3.filter(
    (points) => signedArea(points) > 0,
  );
  const offsets = [
    [-0.99, 0],
    [0.99, 0],
    [0, -0.99],
    [0, 0.99],
  ];

  for (const points of upperPolygons) {
    const xCoordinates = points.filter((_, index) => index % 2 === 0);
    const yCoordinates = points.filter((_, index) => index % 2 === 1);
    const bounds = {
      left: Math.min(...xCoordinates),
      right: Math.max(...xCoordinates),
      top: Math.min(...yCoordinates),
      bottom: Math.max(...yCoordinates),
    };
    visitRectangle(bounds, (x, y) => {
      if (!contains(points, x, y)) return;
      for (const [offsetX, offsetY] of offsets) {
        if (
          !lowerPolygons.some((lower) =>
            contains(lower, x + offsetX, y + offsetY),
          )
        ) {
          fail(
            `level3 is not inset from level2 near [${x.toFixed(2)}, ${y.toFixed(
              2,
            )}].`,
          );
        }
      }
    });
  }
}

async function validateObjects(design) {
  const knownTypes = await loadObjectTypes();
  const buildings = [];
  const trees = [];
  const decorations = [];
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
      const footprint = BUILDING_FOOTPRINTS[type];
      if (footprint) {
        const [offsetX, offsetY, width, height] = footprint;
        const building = {
          key,
          x,
          y,
          left: x + offsetX,
          right: x + offsetX + width,
          top: y + offsetY,
          bottom: y + offsetY + height,
        };
        assertRectangleOnSingleLevel(
          design,
          building,
          `${key} at [${x}, ${y}]`,
        );
        assertRectangleHasNoPaths(design, building, `${key} at [${x}, ${y}]`);
        buildings.push(building);
      } else if (category === 'tree') {
        const tree = {
          key,
          x,
          y,
          left: x,
          right: x + 1,
          top: y,
          bottom: y + 1,
        };
        assertRectangleOnSingleLevel(design, tree, `${key} at [${x}, ${y}]`);
        tree.clearance = {
          left: x - 1,
          right: x + 2,
          top: y - 1,
          bottom: y + 2,
        };
        assertRectangleOnSingleLevel(
          design,
          tree.clearance,
          `${key} at [${x}, ${y}] growth area`,
        );
        trees.push(tree);
      } else if (
        category !== 'construction' &&
        type !== 'dock' &&
        type !== 'weedCattail'
      ) {
        const decoration = {
          key,
          x,
          y,
          left: x,
          right: x + 1,
          top: y,
          bottom: y + 1,
        };
        assertRectangleOnSingleLevel(
          design,
          decoration,
          `${key} at [${x}, ${y}]`,
        );
        decorations.push(decoration);
      } else if (type === 'weedCattail') {
        decorations.push({
          key,
          x,
          y,
          left: x,
          right: x + 1,
          top: y,
          bottom: y + 1,
        });
      }
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
  for (const tree of trees) {
    for (const building of buildings) {
      if (overlaps(tree.clearance, building)) {
        fail(
          `${tree.key} at [${tree.x}, ${tree.y}] does not have one tile of clearance from ${building.key}.`,
        );
      }
    }
  }
  for (const decoration of decorations) {
    for (const building of buildings) {
      if (overlaps(decoration, building)) {
        fail(
          `${decoration.key} at [${decoration.x}, ${decoration.y}] overlaps ${building.key}.`,
        );
      }
    }
  }
  for (let i = 0; i < trees.length; i += 1) {
    for (let j = i + 1; j < trees.length; j += 1) {
      if (
        Math.abs(trees[i].x - trees[j].x) < 2 &&
        Math.abs(trees[i].y - trees[j].y) < 2
      ) {
        fail(
          `${trees[i].key} at [${trees[i].x}, ${trees[i].y}] is too close to ${trees[j].key} at [${trees[j].x}, ${trees[j].y}].`,
        );
      }
    }
  }
  return { buildings, trees, decorations };
}

function validateHorizontalBridge(design, key, x, y) {
  const leftApproach = { left: x, right: x + 1, top: y, bottom: y + 4 };
  const water = { left: x + 1, right: x + 5, top: y, bottom: y + 4 };
  const rightApproach = {
    left: x + 5,
    right: x + 6,
    top: y,
    bottom: y + 4,
  };
  const name = `${key} at [${x}, ${y}]`;
  const leftLevel = assertRectangleOnSingleLevel(
    design,
    leftApproach,
    `${name} left approach`,
  );
  assertRectangleInWater(design, water, name);
  const rightLevel = assertRectangleOnSingleLevel(
    design,
    rightApproach,
    `${name} right approach`,
  );
  if (leftLevel !== rightLevel)
    fail(`${name} connects different terrain levels.`);
}

function validateVerticalBridge(design, key, x, y) {
  const topApproach = { left: x, right: x + 4, top: y, bottom: y + 1 };
  const water = { left: x, right: x + 4, top: y + 1, bottom: y + 5 };
  const bottomApproach = {
    left: x,
    right: x + 4,
    top: y + 5,
    bottom: y + 6,
  };
  const name = `${key} at [${x}, ${y}]`;
  const topLevel = assertRectangleOnSingleLevel(
    design,
    topApproach,
    `${name} top approach`,
  );
  assertRectangleInWater(design, water, name);
  const bottomLevel = assertRectangleOnSingleLevel(
    design,
    bottomApproach,
    `${name} bottom approach`,
  );
  if (topLevel !== bottomLevel)
    fail(`${name} connects different terrain levels.`);
}

function stairLandings(type, x, y, width, height) {
  if (type.endsWith('Up')) {
    return [
      { left: x, right: x + width, top: y - 1, bottom: y },
      { left: x, right: x + width, top: y + height, bottom: y + height + 1 },
    ];
  }
  if (type.endsWith('Down')) {
    return [
      { left: x, right: x + width, top: y + height, bottom: y + height + 1 },
      { left: x, right: x + width, top: y - 1, bottom: y },
    ];
  }
  if (type.endsWith('Left')) {
    return [
      { left: x - 1, right: x, top: y, bottom: y + height },
      { left: x + width, right: x + width + 1, top: y, bottom: y + height },
    ];
  }
  return [
    { left: x + width, right: x + width + 1, top: y, bottom: y + height },
    { left: x - 1, right: x, top: y, bottom: y + height },
  ];
}

function validateStair(design, key, type, x, y, size) {
  const name = `${key} at [${x}, ${y}]`;
  const body = {
    left: x,
    right: x + size[0],
    top: y,
    bottom: y + size[1],
  };
  const [highLanding, lowLanding] = stairLandings(type, x, y, size[0], size[1]);
  const highLevel = assertRectangleOnSingleLevel(
    design,
    highLanding,
    `${name} upper landing`,
  );
  const lowLevel = assertRectangleOnSingleLevel(
    design,
    lowLanding,
    `${name} lower landing`,
  );
  if (highLevel !== lowLevel + 1) {
    fail(`${name} does not connect adjacent terrain levels.`);
  }
  const bodyLevel = assertRectangleOnSingleLevel(design, body, `${name} body`);
  if (bodyLevel !== lowLevel)
    fail(`${name} body is not on the lower terrain level.`);

  const sideClearances =
    size[0] < size[1]
      ? [
          { left: x - 1, right: x, top: y, bottom: y + size[1] },
          {
            left: x + size[0],
            right: x + size[0] + 1,
            top: y,
            bottom: y + size[1],
          },
        ]
      : [
          { left: x, right: x + size[0], top: y - 1, bottom: y },
          {
            left: x,
            right: x + size[0],
            top: y + size[1],
            bottom: y + size[1] + 1,
          },
        ];
  for (const clearance of sideClearances) {
    const clearanceLevel = assertRectangleOnSingleLevel(
      design,
      clearance,
      `${name} side clearance`,
    );
    if (clearanceLevel !== lowLevel)
      fail(`${name} side clearance is not on the lower terrain level.`);
  }
}

function validateConstructions(design, buildings, trees, decorations) {
  const constructions = [];
  let bridgeCount = 0;
  let inclineCount = 0;
  for (const [key, values] of Object.entries(design.objects)) {
    const [category, type] = parseObjectKey(key);
    if (category !== 'construction') continue;
    const size = CONSTRUCTION_SIZES[type];
    if (!size) fail(`Unsupported construction type: ${key}`);
    const isBridge = type.startsWith('bridge');
    const isStair = type.startsWith('stairs');
    if (isBridge) bridgeCount += values.length / 2;
    if (isStair) inclineCount += values.length / 2;
    for (const [x, y] of pairs(values)) {
      const rectangle = {
        key,
        type,
        x,
        y,
        left: x,
        right: x + size[0],
        top: y,
        bottom: y + size[1],
      };
      if (
        rectangle.left < 0 ||
        rectangle.right > MAP_WIDTH ||
        rectangle.top < 0 ||
        rectangle.bottom > MAP_HEIGHT
      ) {
        fail(`${key} at [${x}, ${y}] is out of bounds.`);
      }
      assertRectangleHasNoPaths(design, rectangle, `${key} at [${x}, ${y}]`);
      for (const building of buildings) {
        if (overlaps(expandRectangle(rectangle, 1), building)) {
          fail(`${key} at [${x}, ${y}] is too close to ${building.key}.`);
        }
      }
      for (const tree of trees) {
        if (overlaps(rectangle, tree.clearance)) {
          fail(
            `${tree.key} at [${tree.x}, ${tree.y}] does not have one tile of clearance from ${key}.`,
          );
        }
      }
      for (const decoration of decorations) {
        if (overlaps(rectangle, decoration)) {
          fail(
            `${decoration.key} at [${decoration.x}, ${decoration.y}] overlaps ${key}.`,
          );
        }
      }
      if (type.endsWith('Horizontal') && isBridge)
        validateHorizontalBridge(design, key, x, y);
      else if (type.endsWith('Vertical') && isBridge)
        validateVerticalBridge(design, key, x, y);
      else if (isBridge)
        fail(`${key} validation is not implemented for this bridge direction.`);
      else if (isStair) validateStair(design, key, type, x, y, size);
      constructions.push(rectangle);
    }
  }
  if (bridgeCount > MAX_BRIDGES)
    fail(
      `The design has ${bridgeCount} bridges; the maximum is ${MAX_BRIDGES}.`,
    );
  if (inclineCount > MAX_INCLINES)
    fail(
      `The design has ${inclineCount} inclines; the maximum is ${MAX_INCLINES}.`,
    );
  for (let i = 0; i < constructions.length; i += 1) {
    for (let j = i + 1; j < constructions.length; j += 1) {
      if (overlaps(expandRectangle(constructions[i], 1), constructions[j])) {
        fail(
          `${constructions[i].key} at [${constructions[i].x}, ${constructions[i].y}] is too close to ${constructions[j].key} at [${constructions[j].x}, ${constructions[j].y}].`,
        );
      }
    }
  }
  return constructions;
}

function gridKey(x, y) {
  return `${x},${y}`;
}

function rectangleContainsCell(rectangle, x, y) {
  const centerX = x + 0.5;
  const centerY = y + 0.5;
  return (
    centerX >= rectangle.left &&
    centerX < rectangle.right &&
    centerY >= rectangle.top &&
    centerY < rectangle.bottom
  );
}

function addBidirectionalEdge(edges, from, to) {
  if (!edges.has(from)) edges.set(from, []);
  if (!edges.has(to)) edges.set(to, []);
  edges.get(from).push(to);
  edges.get(to).push(from);
}

function addConstructionEdges(edges, construction) {
  const { type, x, y } = construction;
  if (type.endsWith('Horizontal') && type.startsWith('bridge')) {
    for (let offset = 0; offset < 4; offset += 1) {
      addBidirectionalEdge(
        edges,
        gridKey(x, y + offset),
        gridKey(x + 5, y + offset),
      );
    }
    return;
  }
  if (type.endsWith('Vertical') && type.startsWith('bridge')) {
    for (let offset = 0; offset < 4; offset += 1) {
      addBidirectionalEdge(
        edges,
        gridKey(x + offset, y),
        gridKey(x + offset, y + 5),
      );
    }
    return;
  }
  if (!type.startsWith('stairs')) return;

  if (type.endsWith('Up')) {
    for (let offset = 0; offset < 2; offset += 1) {
      addBidirectionalEdge(
        edges,
        gridKey(x + offset, y - 1),
        gridKey(x + offset, y + 4),
      );
    }
  } else if (type.endsWith('Down')) {
    for (let offset = 0; offset < 2; offset += 1) {
      addBidirectionalEdge(
        edges,
        gridKey(x + offset, y + 4),
        gridKey(x + offset, y - 1),
      );
    }
  } else if (type.endsWith('Left')) {
    for (let offset = 0; offset < 2; offset += 1) {
      addBidirectionalEdge(
        edges,
        gridKey(x - 1, y + offset),
        gridKey(x + 4, y + offset),
      );
    }
  } else if (type.endsWith('Right')) {
    for (let offset = 0; offset < 2; offset += 1) {
      addBidirectionalEdge(
        edges,
        gridKey(x + 4, y + offset),
        gridKey(x - 1, y + offset),
      );
    }
  }
}

function buildingApproachCells(building) {
  const cells = [];
  for (
    let x = Math.floor(building.left);
    x < Math.ceil(building.right);
    x += 1
  ) {
    cells.push([x, Math.floor(building.top) - 1]);
    cells.push([x, Math.ceil(building.bottom)]);
  }
  for (
    let y = Math.floor(building.top);
    y < Math.ceil(building.bottom);
    y += 1
  ) {
    cells.push([Math.floor(building.left) - 1, y]);
    cells.push([Math.ceil(building.right), y]);
  }
  return cells;
}

function airportEntranceCell(design) {
  for (let blockX = 0; blockX < 6; blockX += 1) {
    const leftIndex = blockX + 4;
    if (
      design.edgeTiles[leftIndex] === 34 &&
      design.edgeTiles[leftIndex + 1] === 35
    ) {
      return [(blockX + 1) * 16, 83];
    }
  }
  fail('The fixed airport edge tiles are missing.');
}

function validateBuildingReachability(design, buildings, constructions) {
  const blocked = (x, y) =>
    buildings.some((building) => rectangleContainsCell(building, x, y));
  const passable = (x, y) =>
    x >= 0 &&
    x < MAP_WIDTH &&
    y >= 0 &&
    y < MAP_HEIGHT &&
    terrainLevelAt(design, x + 0.5, y + 0.5) > 0 &&
    !blocked(x, y);
  const edges = new Map();
  constructions.forEach((construction) =>
    addConstructionEdges(edges, construction),
  );

  const start = airportEntranceCell(design);
  if (!passable(...start)) fail('The airport entrance is not walkable.');
  const queue = [start];
  const visited = new Set([gridKey(...start)]);
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y] = queue[index];
    const level = terrainLevelAt(design, x + 0.5, y + 0.5);
    const candidates = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nextX, nextY] of candidates) {
      const key = gridKey(nextX, nextY);
      if (
        visited.has(key) ||
        !passable(nextX, nextY) ||
        terrainLevelAt(design, nextX + 0.5, nextY + 0.5) !== level
      ) {
        continue;
      }
      visited.add(key);
      queue.push([nextX, nextY]);
    }
    for (const extra of edges.get(gridKey(x, y)) ?? []) {
      if (visited.has(extra)) continue;
      const [nextX, nextY] = extra.split(',').map(Number);
      if (!passable(nextX, nextY)) continue;
      visited.add(extra);
      queue.push([nextX, nextY]);
    }
  }

  for (const building of buildings) {
    const reachable = buildingApproachCells(building).some(
      ([x, y]) => passable(x, y) && visited.has(gridKey(x, y)),
    );
    if (!reachable) {
      fail(
        `${building.key} at [${building.x}, ${building.y}] is not reachable from the airport.`,
      );
    }
  }
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
  if (JSON.stringify(design.edgeTiles) !== JSON.stringify(origin.edgeTiles))
    fail('Original edge tiles changed.');
  if (JSON.stringify(design.objects.amenities_townhallSprite) !== '[53,66]')
    fail('Resident Services moved.');
  if (JSON.stringify(design.objects.amenities_dock) !== '[104,84]')
    fail('Dock moved.');
  if (design.objects.structures_houseSprite.length !== 20)
    fail('The design must contain ten villager houses.');

  const originRiverMouths = riverMouthEndpoints(origin.drawing.level1);
  const designRiverMouths = riverMouthEndpoints(design.drawing.level1);
  if (JSON.stringify(designRiverMouths) !== JSON.stringify(originRiverMouths))
    fail('Original river mouth endpoints changed.');

  validateDrawing(design.drawing);
  validatePathsOnLand(design);
  validateCliffInset(design);
  const { buildings, trees, decorations } = await validateObjects(design);
  const constructions = validateConstructions(
    design,
    buildings,
    trees,
    decorations,
  );
  validateBuildingReachability(design, buildings, constructions);

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
