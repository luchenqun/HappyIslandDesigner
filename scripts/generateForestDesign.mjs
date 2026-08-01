import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const MAP_WIDTH = 112;

function area(points) {
  let result = 0;
  for (let i = 0; i < points.length; i += 2) {
    const next = (i + 2) % points.length;
    result += points[i] * points[next + 1] - points[next] * points[i + 1];
  }
  return result / 2;
}

function orient(points, positive) {
  const isPositive = area(points) > 0;
  if (isPositive === positive) return points;
  const pairs = [];
  for (let i = 0; i < points.length; i += 2)
    pairs.push([points[i], points[i + 1]]);
  return pairs.reverse().flat();
}

function polygon(pairs, positive = true) {
  return orient(pairs.flat(), positive);
}

function rect(left, top, right, bottom) {
  return polygon([
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]);
}

function octagon(left, top, right, bottom, corner, positive = true) {
  return polygon(
    [
      [left + corner, top],
      [right - corner, top],
      [right, top + corner],
      [right, bottom - corner],
      [right - corner, bottom],
      [left + corner, bottom],
      [left, bottom - corner],
      [left, top + corner],
    ],
    positive,
  );
}

function mirror(points, positive = area(points) > 0) {
  const mirrored = [];
  for (let i = 0; i < points.length; i += 2)
    mirrored.push(MAP_WIDTH - points[i], points[i + 1]);
  return orient(mirrored, positive);
}

function ribbon(centerline, width) {
  const half = width / 2;
  const left = [];
  const right = [];
  for (let i = 0; i < centerline.length; i += 1) {
    const previous = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(centerline.length - 1, i + 1)];
    const dx = next[0] - previous[0];
    const dy = next[1] - previous[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    left.push([centerline[i][0] + nx, centerline[i][1] + ny]);
    right.push([centerline[i][0] - nx, centerline[i][1] - ny]);
  }
  return polygon([...left, ...right.reverse()], false);
}

function flattenPoints(points) {
  return points.flatMap(([x, y]) => [x, y]);
}

function mirroredPairs(points) {
  const result = [];
  for (const [x, y] of points) result.push(x, y, MAP_WIDTH - x, y);
  return result;
}

function assertFixedData(origin, design) {
  const originOuter = JSON.stringify(origin.drawing.level1[0]);
  const designOuter = JSON.stringify(design.drawing.level1[0]);
  if (originOuter !== designOuter)
    throw new Error('The original coastline boundary changed.');
  if (JSON.stringify(design.objects.amenities_townhallSprite) !== '[53,66]') {
    throw new Error('Resident Services must remain at [53, 66].');
  }
  if (JSON.stringify(design.objects.amenities_dock) !== '[104,84]') {
    throw new Error('The dock must remain at [104, 84].');
  }
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function createForestDesign(origin) {
  const design = structuredClone(origin);

  const mirrorLake = octagon(43, 31, 69, 48, 5, false);
  const lakeIsland = octagon(52, 36, 60, 43, 2, true);
  const leftRiver = ribbon(
    [
      [48, 49.4],
      [44, 51],
      [40, 56],
      [37, 62],
      [32, 67],
      [28, 73],
      [24, 78],
      [24, 83],
    ],
    4,
  );
  const rightRiver = mirror(leftRiver, false);
  const leftUpperStream = ribbon(
    [
      [47.5, 29.4],
      [43, 26],
      [38.8, 24.5],
    ],
    3.5,
  );
  const rightUpperStream = mirror(leftUpperStream, false);
  const leftPond = octagon(26, 20, 37, 29, 2.5, false);
  const rightPond = mirror(leftPond, false);

  design.drawing.level1 = [
    structuredClone(origin.drawing.level1[0]),
    mirrorLake,
    lakeIsland,
    leftRiver,
    rightRiver,
    leftUpperStream,
    rightUpperStream,
    leftPond,
    rightPond,
  ];

  const leftLevel2 = polygon([
    [14, 14],
    [43, 14],
    [47, 18],
    [47, 27],
    [43, 31],
    [42, 42],
    [37, 48],
    [21, 48],
    [14, 41],
  ]);
  const centralLevel2 = octagon(48, 12, 64, 29, 3);
  design.drawing.level2 = [
    leftLevel2,
    mirror(leftLevel2),
    centralLevel2,
    leftUpperStream,
    rightUpperStream,
    leftPond,
    rightPond,
  ];

  const leftLevel3 = polygon([
    [18, 15],
    [38, 15],
    [42, 19],
    [42, 29],
    [38, 34],
    [22, 34],
    [18, 30],
  ]);
  const centralLevel3 = octagon(51, 15, 61, 25, 2);
  design.drawing.level3 = [
    leftLevel3,
    mirror(leftLevel3),
    centralLevel3,
    leftUpperStream,
    rightUpperStream,
    leftPond,
    rightPond,
  ];

  design.drawing.pathDirt = [
    rect(54, 48, 58, 62),
    rect(54, 76, 58, 88),
    rect(17, 55, 47, 58),
    rect(65, 55, 95, 58),
    rect(16, 64, 37, 67),
    rect(75, 64, 96, 67),
    rect(18, 75, 47, 78),
    rect(65, 75, 94, 78),
    rect(38, 82, 49, 85),
    rect(63, 82, 74, 85),
  ];
  design.drawing.pathStone = [
    octagon(49, 48, 63, 53, 1.5),
    rect(47, 61, 65, 64),
  ];
  design.drawing.pathSand = [];

  const objects = {
    amenities_dock: [104, 84],
    amenities_townhallSprite: [53, 66],
    amenities_museumSprite: [20, 52],
    amenities_nookSprite: [92, 52],
    amenities_ableSprite: [34, 52],
    amenities_campsiteSprite: [78, 52],
    structures_playerhouseSprite: [56, 20],
    structures_houseSprite: flattenPoints([
      [17, 61],
      [95, 61],
      [29, 62],
      [83, 62],
      [17, 71],
      [95, 71],
      [35, 72],
      [77, 72],
      [43, 81],
      [69, 81],
    ]),
    construction_bridgeWoodHorizontal: mirroredPairs([
      [39, 57],
      [28, 76],
    ]),
    construction_stairsWoodUp: mirroredPairs([
      [43, 47],
      [29, 34],
    ]),
    construction_stairsWoodDown: [56, 29],
  };

  const pinePairs = [
    [16, 17],
    [22, 18],
    [28, 17],
    [35, 18],
    [41, 21],
    [16, 25],
    [23, 27],
    [39, 28],
    [18, 36],
    [26, 39],
    [35, 37],
    [17, 44],
    [30, 45],
    [40, 43],
    [47, 16],
    [47, 24],
  ];
  const treePairs = [
    [12, 52],
    [27, 51],
    [38, 51],
    [12, 59],
    [24, 58],
    [43, 60],
    [11, 67],
    [26, 68],
    [44, 68],
    [12, 75],
    [18, 80],
    [34, 82],
    [16, 86],
    [30, 88],
    [47, 89],
  ];
  const bambooPairs = [
    [47, 54],
    [45, 58],
    [42, 62],
    [40, 66],
  ];

  objects.tree_pine = mirroredPairs(pinePairs);
  objects.tree_tree = mirroredPairs(treePairs);
  objects.tree_bamboo = mirroredPairs(bambooPairs);
  objects.tree_treeApple = mirroredPairs([
    [12, 82],
    [20, 88],
  ]);
  objects.tree_treePear = mirroredPairs([
    [25, 86],
    [36, 88],
  ]);

  const whiteFlowers = [
    [14, 20],
    [20, 22],
    [23, 22],
    [40, 22],
    [16, 30],
    [14, 40],
    [22, 43],
    [36, 42],
    [13, 55],
    [31, 55],
    [14, 64],
    [25, 66],
    [15, 78],
    [33, 78],
    [45, 86],
  ];
  const yellowFlowers = [
    [18, 30],
    [28, 31],
    [38, 32],
    [20, 57],
    [39, 64],
    [22, 73],
    [38, 75],
  ];
  const undergrowth = [
    [11, 49],
    [24, 49],
    [40, 49],
    [10, 62],
    [23, 65],
    [41, 70],
    [13, 84],
    [31, 85],
  ];

  objects.flower_chrysanthemumWhite = mirroredPairs(whiteFlowers);
  objects.flower_chrysanthemumYellow = mirroredPairs(yellowFlowers);
  objects.flower_chrysanthemumGreen = mirroredPairs([
    [20, 34],
    [33, 35],
    [18, 74],
    [37, 84],
  ]);
  objects.flower_weedClover = mirroredPairs(undergrowth);
  objects.flower_weedDandelion = mirroredPairs([
    [17, 48],
    [35, 49],
    [12, 72],
    [30, 79],
  ]);
  objects.flower_weedCattail = mirroredPairs([
    [45, 45],
    [41, 58],
    [31, 70],
  ]);

  design.objects = objects;
  assertFixedData(origin, design);
  return design;
}

const force = process.argv.includes('--force');
const outputArg =
  process.argv.find((argument) => argument.endsWith('.json')) ??
  'design/01.json';
const originPath = resolve('origin-island.json');
const outputPath = resolve(outputArg);

try {
  if (!force && (await fileExists(outputPath))) {
    throw new Error(
      `${outputArg} already exists; pass --force only while iterating on this design.`,
    );
  }
  const origin = JSON.parse(await readFile(originPath, 'utf8'));
  const design = createForestDesign(origin);
  await mkdir(resolve('design'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(design, null, 2)}\n`);
  console.log(`Generated ${outputArg}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
