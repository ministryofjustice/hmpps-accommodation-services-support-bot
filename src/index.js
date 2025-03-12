import { getNextEngineers, updateRotation } from './rotation.js';
import { postSupportAssignment, getUserStatuses, getUserGroupMembers } from './slack.js';
import { loadRotationData, saveRotationData } from './storage.js';
import { getAvailableEngineers, addNonWorkingDays, removeNonWorkingDays, clearNonWorkingDays } from './nonWorkingDays.js';
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
    const userId = process.env.USER_ID || '';
    const datesInput = process.env.DATES || '';

    // Parse dates for non-working days actions
    const dates = datesInput ? datesInput.split(',').map(d => d.trim()) : [];

    // Load current rotation data
    const dataPath = join(dirname(__dirname), 'data', 'rotation.json');
    const rotationData = loadRotationData(dataPath);

    // Handle different actions
    if (action === 'add_non_working_days' && userId && dates.length > 0) {
      // Add non-working days for a user
      const updatedData = addNonWorkingDays(rotationData, userId, dates);
      saveRotationData(dataPath, updatedData);
      console.log(`Added non-working days for user ${userId}: ${dates.join(', ')}`);

      // Reassign if the affected user is on current duty and one of the dates is today or tomorrow
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const todayStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      if (rotationData.currentEngineers.includes(userId) &&
        (dates.includes(todayStr) || dates.includes(tomorrowStr))) {
        // Get all members of the engineering group
        const engineers = await getUserGroupMembers(CONFIG.slackToken, CONFIG.userGroupId);

        // Get user statuses to check for out-of-office or illness
        const userStatuses = await getUserStatuses(CONFIG.slackToken, engineers);

        // Filter out engineers who are out of office or ill
        const statusFilteredEngineers = engineers.filter(userId => {
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

        // Calculate date range for this rotation
        const endDate = new Date(today);
        endDate.setDate(today.getDate() + CONFIG.daysPerRotation - 1);

        // Further filter by non-working days
        const availableEngineers = getAvailableEngineers(
          updatedData,
          statusFilteredEngineers,
          today,
          endDate
        );

        const newEngineers = getNextEngineers(updatedData, availableEngineers, CONFIG.engineersPerShift);
        await postSupportAssignment(CONFIG.slackToken, CONFIG.channelId, newEngineers, 'Reassigning support due to non-working days update.');

        // Update rotation data
        const finalData = updateRotation(updatedData, newEngineers);
        saveRotationData(dataPath, finalData);
      }
    } else if (action === 'remove_non_working_days' && userId && dates.length > 0) {
      // Remove non-working days for a user
      const updatedData = removeNonWorkingDays(rotationData, userId, dates);
      saveRotationData(dataPath, updatedData);
      console.log(`Removed non-working days for user ${userId}: ${dates.join(', ')}`);
    } else if (action === 'clear_non_working_days' && userId) {
      // Clear all non-working days for a user
      const updatedData = clearNonWorkingDays(rotationData, userId);
      saveRotationData(dataPath, updatedData);
      console.log(`Cleared all non-working days for user ${userId}`);
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

        // Get all members of the engineering group
        const engineers = await getUserGroupMembers(CONFIG.slackToken, CONFIG.userGroupId);

        // Get user statuses to check for out-of-office or illness
        const userStatuses = await getUserStatuses(CONFIG.slackToken, engineers);

        // Filter out engineers who are out of office or ill
        const statusFilteredEngineers = engineers.filter(userId => {
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

        // Calculate date range for this rotation
        const endDate = new Date(today);
        endDate.setDate(today.getDate() + CONFIG.daysPerRotation - 1);

        // Further filter by non-working days
        const availableEngineers = getAvailableEngineers(
          rotationData,
          statusFilteredEngineers,
          today,
          endDate
        );

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