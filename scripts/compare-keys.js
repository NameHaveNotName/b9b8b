// 比较 DB assets storageKey 与 R2 实际文件

const dbKeys = [
  'projects/cmrt57exj000004l4scoqh4y1/references/1784547062481_357034ad0afa5966024b58a112512249.jpg',
  'projects/cmrt57exj000004l4scoqh4y1/references/1784547061960_0fe995977151481f2604a92780ca4fd1.jpg',
  'projects/cmrt57exj000004l4scoqh4y1/texts/ideation-data.json',
  'projects/cmrt57exj000004l4scoqh4y1/texts/framework.json',
  'projects/cmrt57exj000004l4scoqh4y1/styles/style_1_1784547647213.png',
  'projects/cmrt57exj000004l4scoqh4y1/styles/style_3_1784547553939.png',
  'projects/cmrt57exj000004l4scoqh4y1/styles/style_1784547826340_0.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_007.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_008.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_001.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_002.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_003.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_004.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_005.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_006.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_007.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_008.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_009.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_010.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_011.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_012.png',
]

const r2Keys = [
  'projects/cmrt57exj000004l4scoqh4y1/characters/char_001.png',
  'projects/cmrt57exj000004l4scoqh4y1/characters/char_002.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_001.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_002.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_003.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_004.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_005.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_006.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_007.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_008.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_009.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_010.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_011.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_012.png',
]

const r2Set = new Set(r2Keys)
console.log('DB有但R2没有的文件:')
for (const k of dbKeys) {
  if (!r2Set.has(k)) console.log('  MISSING: ' + k)
}

const dbSet = new Set(dbKeys)
console.log('\nR2有但DB没有的文件:')
for (const k of r2Keys) {
  if (!dbSet.has(k)) console.log('  DB-NO-REF: ' + k)
}
