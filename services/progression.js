export function levelFromXp(xp) {
  // Exemple simple: niveau = floor(xp / 100) + 1  (N1:0-99, N2:100-199, etc.)
  // Adapte si tu as déjà une autre courbe.
  return Math.floor((xp || 0) / 100) + 1;
}

export function coinsEarnedBetweenLevels(oldLevel, newLevel) {
  // 1 coin à chaque niveau pair atteint (2,4,6...)
  if (newLevel <= oldLevel) return 0;
  let coins = 0;
  for (let L = oldLevel + 1; L <= newLevel; L++) {
    if (L % 2 === 0) coins += 1;
  }
  return coins;
}