import { loadRotationData, saveRotationData } from './storage.js';
import * as NonWorkingDaysModule from './nonWorkingDays.js';
import { postSupportAssignment, getUserStatuses, getUserGroupMembers } from './slack.js';
import { getNextEngineers, updateRotation } from './rotation.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
  slackToken: process.env.SLACK_TOKEN,
  channelId: process.env.SLACK_CHANNEL_ID || 'cas-dev', // The channel to post to
  userGroupId: process.env.SLACK_USERGROUP_ID || 'cas-engineers', // The user group to pull engineers from
  daysPerRotation: parseInt(process.env.DAYS_PER_ROTATION || '2', 10), // Number of days each rotation lasts
  engineersPerShift: parseInt(process.env.ENGINEERS_PER_SHIFT || '2', 10) // Number of engineers on support at once
};

async function main() {
  try {
    // Check if we have the necessary configuration
    if (!CONFIG.slackToken) {
      throw new Error('SLACK_TOKEN is required');
    }

    // Get inputs from environment variables
    const action = process.env.ACTION || '';
    const userId = process.env.USER_ID || '';
    const daysInput = process.env.DAYS || '';

    if (!userId) {
      throw new Error('USER_ID is required');
    }

    if (!action) {
      throw new Error('ACTION is required');
    }

    // Parse days input
    const days = daysInput ? daysInput.split(',').map(d => d.trim()) : [];

    // Load current rotation data
    const dataPath = join(dirname(__dirname), 'data', 'rotation.json');
    const rotationData = loadRotationData(dataPath);

    // Handle different actions
    if (action === 'add_non_working_days' || action === 'add_recurring_days') {
      if (days.length === 0) {
        throw new Error('At least one day must be specified');
      }

      // Add non-working days for a user
      const updatedData = NonWorkingDaysModule.addNonWorkingDays(rotationData, userId, days);
      saveRotationData(dataPath, updatedData);
      console.log(`Added ${action === 'add_recurring_days' ? 'recurring ' : ''}non-working days for user ${userId}: ${days.join(', ')}`);

      // Check if this affects current rotation
      await checkAndReassignIfNeeded(rotationData, updatedData, userId);
    }
    else if (action === 'remove_non_working_days' || action === 'remove_recurring_days') {
      if (days.length === 0) {
        throw new Error('At least one day must be specified');
      }

      // Remove non-working days for a user
      const updatedData = NonWorkingDaysModule.removeNonWorkingDays(rotationData, userId, days);
      saveRotationData(dataPath, updatedData);
      console.log(`Removed ${action === 'remove_recurring_days' ? 'recurring ' : ''}non-working days for user ${userId}: ${days.join(', ')}`);
    }
    else if (action === 'clear_non_working_days') {
      // Clear all non-working days for a user
      const updatedData = NonWorkingDaysModule.clearNonWorkingDays(rotationData, userId);
      saveRotationData(dataPath, updatedData);
      console.log(`Cleared all non-working days for user ${userId}`);
    }
    else if (action === 'clear_recurring_days') {
      // Clear only recurring days
      const updatedData = NonWorkingDaysModule.clearNonWorkingDays(rotationData, userId, 'recurring');
      saveRotationData(dataPath, updatedData);
      console.log(`Cleared recurring non-working days for user ${userId}`);
    }
    else {
      throw new Error(`Unknown action: ${action}`);
    }

    console.log('Non-working days management completed successfully.');
  } catch (error) {
    console.error('Error in non-working days management:', error);
    process.exit(1);
  }
}

/**
 * Check if the user is currently on support and if the changes affect the current rotation
 * @param {Object} originalData - Original rotation data
 * @param {Object} updatedData - Updated rotation data
 * @param {string} userId - User ID that was modified
 */
async function checkAndReassignIfNeeded(originalData, updatedData, userId) {
  // Only check if the user is currently on support
  if (!originalData.currentEngineers.includes(userId)) {
    return;
  }

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  // Check if today or tomorrow is now a non-working day for this user
  if (NonWorkingDaysModule.isNonWorkingDay(updatedData, userId, today) ||
    NonWorkingDaysModule.isNonWorkingDay(updatedData, userId, tomorrow)) {
    console.log(`User ${userId} is currently on support but now has a non-working day. Reassigning...`);

    // Get all members of the engineering group
    const engineers = await getUserGroupMembers(CONFIG.slackToken, CONFIG.userGroupId);

    // Get user statuses to check for out-of-office or illness
    const userStatuses = await getUserStatuses(CONFIG.slackToken, engineers);

    // Filter out engineers who are out of office or ill
    const statusFilteredEngineers = engineers.filter(engineerId => {
      const status = userStatuses[engineerId];
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
    // We need to find a date range that contains CONFIG.daysPerRotation weekdays
    const endDate = new Date(today);
    let weekdaysCount = 0;

    while (weekdaysCount < CONFIG.daysPerRotation) {
      endDate.setDate(endDate.getDate() + 1);
      const dayOfWeek = endDate.getDay();
      // Only count weekdays (Monday to Friday)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        weekdaysCount++;
      }
    }

    // Further filter by non-working days
    const availableEngineers = NonWorkingDaysModule.getAvailableEngineers(
      updatedData,
      statusFilteredEngineers,
      today,
      endDate
    );

    const newEngineers = getNextEngineers(updatedData, availableEngineers, CONFIG.engineersPerShift);
    await postSupportAssignment(
      CONFIG.slackToken,
      CONFIG.channelId,
      newEngineers,
      'Reassigning support due to non-working days update.',
      CONFIG.daysPerRotation
    );

    // Update rotation data
    const finalData = updateRotation(updatedData, newEngineers);

    // Load the data path again to ensure we're using the correct path
    const dataPath = join(dirname(__dirname), 'data', 'rotation.json');
    saveRotationData(dataPath, finalData);

    console.log(`Support reassigned to: ${newEngineers.join(', ')}`);
  }
}

// Run the main function
main();