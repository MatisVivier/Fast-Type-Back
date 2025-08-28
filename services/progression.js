// Courbe simple et modifiable : coût XP par niveau
export function xpForLevel(level) {
  // 100, 150, 200, 250, ...
  return 100 + (level - 1) * 50;
}

// À partir d'un total d'XP, calcule niveau & progression
export function levelFromXp(totalXp = 0) {
  let xp = Math.max(0, totalXp | 0);
  let level = 1;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    if (level > 10000) break;
  }
  const need = xpForLevel(level);
  const inLevel = xp;
  const progress = need ? inLevel / need : 1;
  return { level, inLevel, need, progress, total: totalXp | 0 };
}

// Bonus pièces : 1 pièce à chaque niveau **pair** atteint (2,4,6,...)
export function coinsEarnedBetweenLevels(oldLevel, newLevel) {
  if (newLevel <= oldLevel) return 0;
  let coins = 0;
  for (let L = oldLevel + 1; L <= newLevel; L++) {
    if (L % 2 === 0) coins += 1;
  }
  return coins;
}
