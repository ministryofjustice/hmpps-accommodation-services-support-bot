import { getNextEngineers, updateRotation, skipUser } from './rotation.js';
import { postSupportAssignment, getUserStatuses, getUserGroupMembers } from './slack.js';
import { loadRotationData, saveRotationData } from './storage.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
  slackToken: process.env.SLACK_TOKEN,
  channelId: 'cas-dev', // The channel to post to
  userGroupId: 'cas-api-developers', // The user group to pull engineers from
  daysPerRotation: 2, // Number of days each rotation lasts
  engineersPerShift: 2 // Number of engineers on support at once
};

async function main() {
  try {
    // Check if we have the necessary configuration
    if (!CONFIG.slackToken) {
      throw new Error('SLACK_TOKEN is required');
    }

    // Determine what action to take based on environment variables
    const action = process.env.ACTION || 'assign';
    const skipUserId = process.env.SKIP_USER || '';

    // Load current rotation data
    const dataPath = join(dirname(__dirname), 'data', 'rotation.json');
    const rotationData = loadRotationData(dataPath);

    // Get all members of the engineering group
    const engineers = await getUserGroupMembers(CONFIG.slackToken, CONFIG.userGroupId);

    // Get user statuses to check for out-of-office or illness
    const userStatuses = await getUserStatuses(CONFIG.slackToken, engineers);

    // Filter out engineers who are out of office or ill
    const availableEngineers = engineers.filter(userId => {
      const status = userStatuses[userId];
      if (!status) return true;

      const statusText = status.statusText.toLowerCase();
      const isOOO = statusText.includes('ooo') ||
        statusText.includes('out of office') ||
        statusText.includes('vacation') ||
        statusText.includes('holiday') ||
        statusText.includes('sick') ||
        statusText.includes('ill');

      return !isOOO;
    });

    // Handle different actions
    if (action === 'skip' && skipUserId) {
      // Skip a user's turn
      const updatedData = skipUser(rotationData, skipUserId);
      saveRotationData(dataPath, updatedData);
      console.log(`User ${skipUserId} has been skipped for this rotation.`);

      // Reassign if the skipped user was on current duty
      if (rotationData.currentEngineers.includes(skipUserId)) {
        const newEngineers = getNextEngineers(updatedData, availableEngineers, CONFIG.engineersPerShift);
        await postSupportAssignment(CONFIG.slackToken, CONFIG.channelId, newEngineers, 'Reassigning support due to skip request.');

        // Update rotation data
        const finalData = updateRotation(updatedData, newEngineers);
        saveRotationData(dataPath, finalData);
      }
    } else {
      // Check if it's time for a new rotation (every other day)
      const today = new Date();
      const lastRotationDate = rotationData.lastRotationDate ? new Date(rotationData.lastRotationDate) : null;

      // Calculate days since last rotation
      const daysSinceLastRotation = lastRotationDate
        ? Math.floor((today - lastRotationDate) / (1000 * 60 * 60 * 24))
        : CONFIG.daysPerRotation; // Force rotation if no last date

      if (daysSinceLastRotation >= CONFIG.daysPerRotation) {
        console.log('Time for a new rotation.');

        // Get next engineers
        const nextEngineers = getNextEngineers(rotationData, availableEngineers, CONFIG.engineersPerShift);

        // Post to Slack
        await postSupportAssignment(CONFIG.slackToken, CONFIG.channelId, nextEngineers);

        // Update rotation data
        const updatedData = updateRotation(rotationData, nextEngineers);
        saveRotationData(dataPath, updatedData);

        console.log(`New support assignment: ${nextEngineers.join(', ')}`);
      } else {
        console.log(`Not time for rotation yet. Days since last rotation: ${daysSinceLastRotation}`);
      }
    }

    console.log('Support rotation process completed successfully.');
  } catch (error) {
    console.error('Error in support rotation:', error);
    process.exit(1);
  }
}

main();