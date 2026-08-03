import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const MAP_WIDTH = 112;

function signedArea(points) {
  let result = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    result +=
      points[index] * points[next + 1] - points[next] * points[index + 1];
  }
  return result / 2;
}

function orient(points, positive) {
  if (signedArea(points) > 0 === positive) return points;
  const pairs = [];
  for (let index = 0; index < points.length; index += 2) {
    pairs.push([points[index], points[index + 1]]);
  }
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

function octagon(left, top, right, bottom, corner) {
  return polygon([
    [left + corner, top],
    [right - corner, top],
    [right, top + corner],
    [right, bottom - corner],
    [right - corner, bottom],
    [left + corner, bottom],
    [left, bottom - corner],
    [left, top + corner],
  ]);
}

function assertFixedData(origin, design) {
  if (
    JSON.stringify(origin.drawing.level1[0]) !==
    JSON.stringify(design.drawing.level1[0])
  ) {
    throw new Error('The original coastline boundary changed.');
  }
  if (JSON.stringify(origin.edgeTiles) !== JSON.stringify(design.edgeTiles)) {
    throw new Error('The original edge tiles changed.');
  }
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

export function createNaturalTownDesign(origin) {
  const design = structuredClone(origin);

  // Preserve the complete original river system and reshape only the cliffs.
  design.drawing.level1 = structuredClone(origin.drawing.level1);
  design.drawing.level2 = [
    octagon(12, 12, 42, 35, 4),
    structuredClone(origin.drawing.level1[3]),
    octagon(66, 12, 86, 38, 4),
  ];
  design.drawing.level3 = [];

  design.drawing.pathStone = [
    rect(58, 48, 62, 66),
    rect(62, 76, 66, 84),
    rect(24, 28, 37, 31),
  ];
  design.drawing.pathBrick = [rect(62, 65, 82, 68), rect(62, 68, 65, 76)];
  design.drawing.pathDirt = [
    rect(58, 28, 62, 42),
    rect(58, 16, 62, 22),
    rect(46, 17, 58, 20),
    rect(36, 18, 42, 21),
    rect(36, 21, 39, 31),
    rect(34, 28, 39, 31),
    rect(66, 18, 75, 21),
    rect(74, 18, 77, 29),
    rect(74, 26, 84, 29),
    rect(33, 65, 50, 68),
    rect(33, 74, 50, 77),
    rect(38, 65, 42, 79),
    rect(25, 74, 33, 77),
    rect(12, 74, 19, 77),
    rect(65, 74, 84, 77),
    rect(65, 81, 84, 84),
    rect(70, 68, 74, 81),
  ];
  design.drawing.pathSand = [];

  design.objects = {
    amenities_dock: [104, 84],
    amenities_townhallSprite: [53, 66],
    amenities_museumSprite: [27, 24],
    amenities_nookSprite: [64, 61],
    amenities_ableSprite: [75, 61],
    amenities_campsiteSprite: [71, 14],
    structures_playerhouseSprite: [78, 22],
    structures_houseSprite: [
      34,
      61,
      43,
      61,
      34,
      70,
      43,
      70,
      38,
      79,
      66,
      70,
      75,
      70,
      66,
      77,
      74,
      77,
      80,
      77,
    ],
    construction_bridgeStoneVertical: [58, 22, 58, 42],
    construction_bridgeWoodHorizontal: [19, 72],
    construction_stairsWoodLeft: [42, 18],
    construction_stairsWoodRight: [62, 18],
    tree_pine: [
      15,
      27,
      20,
      31,
      24,
      14,
      36,
      14,
      38,
      24,
      69,
      30,
      83,
      32,
      69,
      15,
      82,
      15,
      79,
      34,
    ],
    tree_tree: [
      13,
      49,
      18,
      54,
      13,
      62,
      14,
      82,
      28,
      56,
      48,
      57,
      29,
      68,
      29,
      80,
      49,
      83,
      90,
      46,
      97,
      52,
      96,
      61,
      94,
      70,
      94,
      81,
      29,
      86,
      52,
      86,
      72,
      87,
      88,
      86,
    ],
    tree_treeApple: [14, 57, 18, 61, 14, 67, 18, 81],
    tree_treePear: [14, 71, 18, 67, 14, 79, 18, 57],
    tree_bamboo: [88, 34, 92, 38, 96, 42, 99, 47],
    flower_cosmosWhite: [
      23,
      29,
      25,
      31,
      35,
      29,
      69,
      20,
      72,
      22,
      80,
      28,
      31,
      64,
      48,
      64,
      31,
      73,
      48,
      73,
      64,
      69,
      81,
      69,
    ],
    flower_cosmosYellow: [
      14,
      25,
      22,
      33,
      40,
      23,
      68,
      28,
      84,
      29,
      31,
      78,
      48,
      76,
      64,
      72,
      82,
      72,
    ],
    flower_hyacinthBlue: [
      30,
      29,
      33,
      29,
      71,
      28,
      84,
      25,
      32,
      68,
      48,
      66,
      64,
      74,
      91,
      80,
    ],
    flower_weedClover: [
      13,
      52,
      15,
      49,
      32,
      63,
      49,
      61,
      63,
      58,
      88,
      48,
      96,
      56,
      91,
      75,
    ],
    flower_weedDandelion: [15, 55, 31, 76, 48, 74, 63, 70, 82, 69],
    flower_weedCattail: [17, 72, 26, 62, 54, 43, 85, 54, 89, 69],
  };

  assertFixedData(origin, design);
  return design;
}

const force = process.argv.includes('--force');
const outputArg =
  process.argv.find((argument) => argument.endsWith('.json')) ??
  'design/02.json';
const originPath = resolve('origin-island.json');
const outputPath = resolve(outputArg);

try {
  if (!force && (await fileExists(outputPath))) {
    throw new Error(
      `${outputArg} already exists; pass --force only while iterating on this design.`,
    );
  }
  const origin = JSON.parse(await readFile(originPath, 'utf8'));
  const design = createNaturalTownDesign(origin);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(design, null, 2)}\n`);
  console.log(`Generated ${outputArg}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
