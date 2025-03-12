/**
 * Add non-working days for a specific user
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID
 * @param {string[]} days - Array of dates in YYYY-MM-DD format
 * @returns {Object} Updated rotation data
 */
export function addNonWorkingDays(rotationData, userId, days) {
  // Initialize non-working days object if it doesn't exist
  if (!rotationData.nonWorkingDays) {
    rotationData.nonWorkingDays = {};
  }

  // Initialize user's non-working days array if it doesn't exist
  if (!rotationData.nonWorkingDays[userId]) {
    rotationData.nonWorkingDays[userId] = [];
  }

  // Add new days, ensuring no duplicates
  for (const day of days) {
    if (!rotationData.nonWorkingDays[userId].includes(day)) {
      rotationData.nonWorkingDays[userId].push(day);
    }
  }

  // Sort days for easier reference
  rotationData.nonWorkingDays[userId].sort();

  return rotationData;
}

/**
 * Remove non-working days for a specific user
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID
 * @param {string[]} days - Array of dates in YYYY-MM-DD format to remove
 * @returns {Object} Updated rotation data
 */
export function removeNonWorkingDays(rotationData, userId, days) {
  // Return early if no non-working days exist for this user
  if (!rotationData.nonWorkingDays || !rotationData.nonWorkingDays[userId]) {
    return rotationData;
  }

  // Remove specified days
  rotationData.nonWorkingDays[userId] = rotationData.nonWorkingDays[userId].filter(
    day => !days.includes(day)
  );

  return rotationData;
}

/**
 * Clear all non-working days for a specific user
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID
 * @returns {Object} Updated rotation data
 */
export function clearNonWorkingDays(rotationData, userId) {
  // Return early if no non-working days exist
  if (!rotationData.nonWorkingDays) {
    return rotationData;
  }

  // Delete the user's entry
  delete rotationData.nonWorkingDays[userId];

  return rotationData;
}

/**
 * Check if a date is a non-working day for a user
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID
 * @param {Date} date - Date to check
 * @returns {boolean} True if it's a non-working day
 */
export function isNonWorkingDay(rotationData, userId, date) {
  // Format date as YYYY-MM-DD
  const formattedDate = formatDate(date);

  // Check if the user has this date marked as non-working
  return rotationData.nonWorkingDays &&
    rotationData.nonWorkingDays[userId] &&
    rotationData.nonWorkingDays[userId].includes(formattedDate);
}

/**
 * Get available engineers for a specific date range
 * @param {Object} rotationData - Current rotation data
 * @param {string[]} allEngineers - List of all engineers
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {string[]} List of available engineers
 */
export function getAvailableEngineers(rotationData, allEngineers, startDate, endDate) {
  // Create array of dates to check
  const dates = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Filter engineers who are available for all dates
  return allEngineers.filter(engineerId => {
    // Check if engineer is available for all dates
    return dates.every(date => !isNonWorkingDay(rotationData, engineerId, date));
  });
}

/**
 * Format a date as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}