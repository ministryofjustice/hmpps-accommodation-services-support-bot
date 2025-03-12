import fs from 'fs';
import path from 'path';

/**
 * Load rotation data from a JSON file
 * @param {string} filePath - Path to the rotation data file
 * @returns {Object} Rotation data
 */
export function loadRotationData(filePath) {
  try {
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      // Create directory if it doesn't exist
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create default rotation data
      const defaultData = {
        rotationOrder: [],
        currentEngineers: [],
        skipList: [],
        history: [],
        lastRotationDate: null
      };

      // Save default data
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }

    // Read and parse the file
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading rotation data:', error);

    // Return default data in case of error
    return {
      rotationOrder: [],
      currentEngineers: [],
      skipList: [],
      history: [],
      lastRotationDate: null
    };
  }
}

/**
 * Save rotation data to a JSON file
 * @param {string} filePath - Path to the rotation data file
 * @param {Object} data - Rotation data to save
 */
export function saveRotationData(filePath, data) {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write data to file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Rotation data saved to ${filePath}`);
  } catch (error) {
    console.error('Error saving rotation data:', error);
    throw error;
  }
}