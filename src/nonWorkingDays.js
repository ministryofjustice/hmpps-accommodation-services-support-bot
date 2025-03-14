/**
 * Functions for managing engineers' non-working days
 */

/**
 * Add non-working days for a specific user
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID
 * @param {string[]} days - Array of dates in YYYY-MM-DD format or day names (e.g., "friday")
 * @returns {Object} Updated rotation data
 */
export function addNonWorkingDays(rotationData, userId, days) {
  // Initialize non-working days object if it doesn't exist
  if (!rotationData.nonWorkingDays) {
    rotationData.nonWorkingDays = {};
  }

  // Initialize user's non-working days configuration if it doesn't exist
  if (!rotationData.nonWorkingDays[userId]) {
    rotationData.nonWorkingDays[userId] = {
      specificDates: [],
      recurringDays: []
    };
  }

  // Ensure the new structure if coming from older version
  if (!rotationData.nonWorkingDays[userId].specificDates) {
    const oldDates = [...rotationData.nonWorkingDays[userId]];
    rotationData.nonWorkingDays[userId] = {
      specificDates: oldDates,
      recurringDays: []
    };
  }

  // Process each day to determine if it's a specific date or a recurring day
  for (const day of days) {
    if (isDateFormat(day)) {
      // It's a specific date (YYYY-MM-DD)
      if (!rotationData.nonWorkingDays[userId].specificDates.includes(day)) {
        rotationData.nonWorkingDays[userId].specificDates.push(day);
      }
    } else {
      // It's a day of the week
      const normalizedDay = normalizeDay(day);
      if (normalizedDay && !rotationData.nonWorkingDays[userId].recurringDays.includes(normalizedDay)) {
        rotationData.nonWorkingDays[userId].recurringDays.push(normalizedDay);
      }
    }
  }

  // Sort for easier reference
  rotationData.nonWorkingDays[userId].specificDates.sort();
  rotationData.nonWorkingDays[userId].recurringDays.sort(sortDaysOfWeek);

  return rotationData;
}

/**
 * Remove non-working days for a specific user
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID
 * @param {string[]} days - Array of dates in YYYY-MM-DD format or day names to remove
 * @returns {Object} Updated rotation data
 */
export function removeNonWorkingDays(rotationData, userId, days) {
  // Return early if no non-working days exist for this user
  if (!rotationData.nonWorkingDays || !rotationData.nonWorkingDays[userId]) {
    return rotationData;
  }

  // Ensure the structure is correct
  if (!rotationData.nonWorkingDays[userId].specificDates) {
    const oldDates = [...rotationData.nonWorkingDays[userId]];
    rotationData.nonWorkingDays[userId] = {
      specificDates: oldDates,
      recurringDays: []
    };
  }

  // Process each day to determine type and remove accordingly
  for (const day of days) {
    if (isDateFormat(day)) {
      // It's a specific date (YYYY-MM-DD)
      rotationData.nonWorkingDays[userId].specificDates =
        rotationData.nonWorkingDays[userId].specificDates.filter(d => d !== day);
    } else {
      // It's a day of the week
      const normalizedDay = normalizeDay(day);
      if (normalizedDay) {
        rotationData.nonWorkingDays[userId].recurringDays =
          rotationData.nonWorkingDays[userId].recurringDays.filter(d => d !== normalizedDay);
      }
    }
  }

  return rotationData;
}

/**
 * Clear all non-working days for a specific user
 * @param {Object} rotationData - Current rotation data
 * @param {string} userId - User ID
 * @param {string} [type] - Type of non-working days to clear ('specific', 'recurring', or null for all)
 * @returns {Object} Updated rotation data
 */
export function clearNonWorkingDays(rotationData, userId, type = null) {
  // Return early if no non-working days exist
  if (!rotationData.nonWorkingDays || !rotationData.nonWorkingDays[userId]) {
    return rotationData;
  }

  if (!type) {
    // Clear all
    delete rotationData.nonWorkingDays[userId];
  } else if (type === 'specific') {
    // Clear specific dates only
    if (rotationData.nonWorkingDays[userId].specificDates) {
      rotationData.nonWorkingDays[userId].specificDates = [];
    }
  } else if (type === 'recurring') {
    // Clear recurring days only
    if (rotationData.nonWorkingDays[userId].recurringDays) {
      rotationData.nonWorkingDays[userId].recurringDays = [];
    }
  }

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
  // Check if it's a weekend (Saturday or Sunday)
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return true; // Weekend is a non-working day for everyone
  }

  if (!rotationData.nonWorkingDays || !rotationData.nonWorkingDays[userId]) {
    return false;
  }

  // Format date as YYYY-MM-DD for specific date check
  const formattedDate = formatDate(date);

  // Check for the updated structure
  if (rotationData.nonWorkingDays[userId].specificDates) {
    // New structure

    // Check if the specific date is marked as non-working
    if (rotationData.nonWorkingDays[userId].specificDates.includes(formattedDate)) {
      return true;
    }

    // Check if the day of the week is marked as non-working
    const dayOfWeek = getDayOfWeek(date).toLowerCase();
    if (rotationData.nonWorkingDays[userId].recurringDays.includes(dayOfWeek)) {
      return true;
    }

    return false;
  } else {
    // Old structure (backward compatibility)
    return rotationData.nonWorkingDays[userId].includes(formattedDate);
  }
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
 * Check if a string is in YYYY-MM-DD format
 * @param {string} str - String to check
 * @returns {boolean} True if it's a date format
 */
function isDateFormat(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

/**
 * Normalize day name to lowercase standard format
 * @param {string} day - Day name (e.g., "Friday", "fri", "FRIDAY")
 * @returns {string|null} Normalized day name or null if invalid
 */
function normalizeDay(day) {
  const dayMap = {
    'sunday': 'sunday',
    'sun': 'sunday',
    'monday': 'monday',
    'mon': 'monday',
    'tuesday': 'tuesday',
    'tue': 'tuesday',
    'tues': 'tuesday',
    'wednesday': 'wednesday',
    'wed': 'wednesday',
    'thursday': 'thursday',
    'thu': 'thursday',
    'thur': 'thursday',
    'thurs': 'thursday',
    'friday': 'friday',
    'fri': 'friday',
    'saturday': 'saturday',
    'sat': 'saturday'
  };

  const lowercaseDay = day.toLowerCase();
  return dayMap[lowercaseDay] || null;
}

/**
 * Sort days of the week in chronological order
 * @param {string} a - First day
 * @param {string} b - Second day
 * @returns {number} Comparison result
 */
function sortDaysOfWeek(a, b) {
  const order = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6
  };

  return order[a] - order[b];
}

/**
 * Format a date as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Get day of week from date
 * @param {Date} date - Date object
 * @returns {string} Day of week (e.g., "sunday")
 */
function getDayOfWeek(date) {
  const days = [
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday'
  ];
  return days[date.getDay()];
}