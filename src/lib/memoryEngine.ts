// Memory Decay and Tiering Logic
// ponytail: retrieveRelevantMemories removed — dead code, unifiedMemory.recall() handles retrieval
export function updateMemoryTiers(memories: any[]): any[] {
  const now = new Date().getTime();
  const updatedMemories = [...memories];
  let changed = false;

  for (let i = 0; i < updatedMemories.length; i++) {
    const memory = updatedMemories[i];
    const lastAccessed = memory.lastAccessedAt ? new Date(memory.lastAccessedAt).getTime() : new Date(memory.createdAt).getTime();
    const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);
    const accessCount = memory.accessCount || 0;

    let newTier = memory.tier;

    // Decay: Hot -> Warm if not accessed in 30 days
    if (memory.tier === 'hot' && daysSinceAccess > 30) {
      newTier = 'warm';
    }
    // Decay: Warm -> Cold if not accessed in 90 days
    else if (memory.tier === 'warm' && daysSinceAccess > 90) {
      newTier = 'cold';
    }
    // Promote: Warm/Cold -> Hot if accessed frequently recently
    else if ((memory.tier === 'warm' || memory.tier === 'cold') && accessCount > 5 && daysSinceAccess < 7) {
      newTier = 'hot';
    }

    if (newTier !== memory.tier) {
      updatedMemories[i] = { ...memory, tier: newTier };
      changed = true;
    }
  }

  return changed ? updatedMemories : memories;
}
