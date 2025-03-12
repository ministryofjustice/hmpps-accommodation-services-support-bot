/**
 * Get the next engineers for support duty
 * @param {Object} rotationData - Current rotation data
 * @param {string[]} availableEngineers - List of available engineers
 * @param {number} count - Number of engineers to assign
 * @returns {string[]} Array of selected engineer IDs
 */
export function getNextEngineers(rotationData, availableEngineers, count) {
  // Initialize rotation order if it doesn't exist
  if (!rotationData.rotationOrder || rotationData.rotationOrder.length === 0) {
    rotationData.rotationOrder = [...availableEngineers];
    shuffleArray(rotationData.rotationOrder);
  }

  // Filter out engineers who should be skipped
  const eligibleEngineers = rotationData.rotationOrder.filter(id =>
    !rotationData.skipList.includes(id) && availableEngineers.includes(id)
  );

  // Handle case where we don't have enough eligible engineers
  if (eligibleEngineers.length < count) {
    // Reset skip list and try again, but preserve the order
    rotationData.skipList = [];
    return getNextEngineers(rotationData, availableEngineers, count);
  }

  // Select the next engineers in the rotation
  const selectedEngineers = [];
  let index = 0;

  // Start from after the last engineer in the current rotation
  if (rotationData.currentEngineers && rotationData.currentEngineers.length > 0) {
    const lastEngineer = rotationData.currentEngineers[rotationData.currentEngineers.length - 1];
    const lastIndex = eligibleEngineers.indexOf(lastEngineer);
    if (lastIndex !== -1) {
      index = (lastIndex + 1) % eligibleEngineers.length;
    }
  }

  // Select the required number of engineers
  for (let i = 0; i < count; i++) {
    selectedEngineers.push(eligibleEngineers[index]);
    index = (index + 1) % eligibleEngineers.length;

    // If we loop back to the start, break to avoid duplicates
    if (index === 0 && i < count - 1) {
      break;
    }
  }

  // If we couldn't get enough engineers, fill from the available pool
  while (selectedEngineers.length < count) {
    const remainingEngineers = availableEngineers.filter(id =>
      !selectedEngineers.includes(id) && !rotationData.currentEngineers.includes(id)
    );

    if (remainingEngineers.length === 0) break;
    selectedEngineers.push(remainingEngineers[0]);
  }

  return selectedEngineers;
}

/**
 * Update the rotation data after assigning new engineers
 * @param {Object} rotationData - Current rotation data
 * @param {string[]} newEngineers - Newly assigned engineers
 * @returns {Object} Updated rotation data
 */
export function updateRotation(rotationData, newEngineers) {
  // Update the last rotation date
  rotationData.lastRotationDate = new Date().toISOString();

  // Update current engineers
  rotationData.currentEngineers = [...newEngineers];

  // Add current engineers to history
  if (!rotationData.history) {
    rotationData.history = [];
  }

  rotationData.history.push({
    date: rotationData.lastRotationDate,
    engineers: newEngineers
  });

  // Limit history size
  if (rotationData.history.length > 30) {
    rotationData.history = rotationData.history.slice(-30);
  }

  // Clear skip list for engineers who've served
  rotationData.skipList = rotationData.skipList.filter(id => !newEngineers.includes(id));

  return rotationData;
}

/**
 * Skip a user's turn in the rotation
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID to skip
 * @returns {Object} Updated rotation data
 */
export function skipUser(rotationData, userId) {
  // Initialize skip list if it doesn't exist
  if (!rotationData.skipList) {
    rotationData.skipList = [];
  }

  // Add user to skip list if not already there
  if (!rotationData.skipList.includes(userId)) {
    rotationData.skipList.push(userId);
  }

  return rotationData;
}

/**
 * Helper function to shuffle an array in-place using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}