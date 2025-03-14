import { getNextEngineers, updateRotation } from './rotation.js';
import { postSupportAssignment, getUserStatuses, getUserGroupMembers } from './slack.js';
import { loadRotationData, saveRotationData } from './storage.js';
import { getAvailableEngineers, addNonWorkingDays, removeNonWorkingDays, clearNonWorkingDays, isNonWorkingDay } from './nonWorkingDays.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
  slackToken: process.env.SLACK_TOKEN,
  channelId: 'cas-dev-away-days', // The channel to post to
  userGroupId: 'cas1-devs', // The user group to pull engineers from
  daysPerRotation: 0, // Number of days each rotation lasts
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
    const daysInput = process.env.DAYS || '';

    // Parse days input for actions
    const days = daysInput ? daysInput.split(',').map(d => d.trim()) : [];

    // Load current rotation data
    const dataPath = join(dirname(__dirname), 'data', 'rotation.json');
    const rotationData = loadRotationData(dataPath);

    // Handle different actions
    if (action === 'add_non_working_days' && userId && days.length > 0) {
      // Add non-working days for a user
      const updatedData = addNonWorkingDays(rotationData, userId, days);
      saveRotationData(dataPath, updatedData);
      console.log(`Added non-working days for user ${userId}: ${days.join(', ')}`);

      // Reassign if the affected user is on current duty and one of the dates is today or tomorrow
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      if (rotationData.currentEngineers.includes(userId) &&
        (isNonWorkingDay(updatedData, userId, today) || isNonWorkingDay(updatedData, userId, tomorrow))) {
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
        const availableEngineers = getAvailableEngineers(
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
        saveRotationData(dataPath, finalData);
      }
    } else if (action === 'add_recurring_days' && userId && days.length > 0) {
      // This is just for clarity in command usage - internally it uses the same function
      const updatedData = addNonWorkingDays(rotationData, userId, days);
      saveRotationData(dataPath, updatedData);
      console.log(`Added recurring non-working days for user ${userId}: ${days.join(', ')}`);

      // Same reassignment logic as add_non_working_days
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      if (rotationData.currentEngineers.includes(userId) &&
        (isNonWorkingDay(updatedData, userId, today) || isNonWorkingDay(updatedData, userId, tomorrow))) {
        // Similar logic as above - get engineers, filter, and reassign
        const engineers = await getUserGroupMembers(CONFIG.slackToken, CONFIG.userGroupId);
        const userStatuses = await getUserStatuses(CONFIG.slackToken, engineers);
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

        const availableEngineers = getAvailableEngineers(
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
          'Reassigning support due to recurring non-working days update.',
          CONFIG.daysPerRotation
        );

        const finalData = updateRotation(updatedData, newEngineers);
        saveRotationData(dataPath, finalData);
      }
    } else if (action === 'remove_non_working_days' && userId && days.length > 0) {
      // Remove non-working days for a user
      const updatedData = removeNonWorkingDays(rotationData, userId, days);
      saveRotationData(dataPath, updatedData);
      console.log(`Removed non-working days for user ${userId}: ${days.join(', ')}`);
    } else if (action === 'remove_recurring_days' && userId && days.length > 0) {
      // This is just for clarity in command usage - internally it uses the same function
      const updatedData = removeNonWorkingDays(rotationData, userId, days);
      saveRotationData(dataPath, updatedData);
      console.log(`Removed recurring non-working days for user ${userId}: ${days.join(', ')}`);
    } else if (action === 'clear_non_working_days' && userId) {
      // Clear all non-working days for a user
      const updatedData = clearNonWorkingDays(rotationData, userId);
      saveRotationData(dataPath, updatedData);
      console.log(`Cleared all non-working days for user ${userId}`);
    } else if (action === 'clear_recurring_days' && userId) {
      // Clear only recurring days
      const updatedData = clearNonWorkingDays(rotationData, userId, 'recurring');
      saveRotationData(dataPath, updatedData);
      console.log(`Cleared recurring non-working days for user ${userId}`);
    } else {
      // Check if it's time for a new rotation (every other day)
      const today = new Date();
      const lastRotationDate = rotationData.lastRotationDate ? new Date(rotationData.lastRotationDate) : null;

      // Calculate days since last rotation (excluding weekends)
      let daysSinceLastRotation = 0;

      if (lastRotationDate) {
        const currentDate = new Date(lastRotationDate);
        currentDate.setDate(currentDate.getDate() + 1); // Start with the day after last rotation

        while (currentDate <= today) {
          const dayOfWeek = currentDate.getDay();
          // Only count weekdays (Monday to Friday)
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            daysSinceLastRotation++;
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else {
        // Force rotation if no last date
        daysSinceLastRotation = CONFIG.daysPerRotation;
      }

      if (daysSinceLastRotation >= CONFIG.daysPerRotation) {
        console.log('Time for a new rotation.');

        // Make sure we're not starting a rotation on a weekend
        if (today.getDay() === 0 || today.getDay() === 6) {
          console.log('Today is a weekend day. Skipping rotation until next weekday.');
          return;
        }

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
        const availableEngineers = getAvailableEngineers(
          rotationData,
          statusFilteredEngineers,
          today,
          endDate
        );

        // Get next engineers
        const nextEngineers = getNextEngineers(rotationData, availableEngineers, CONFIG.engineersPerShift);

        // Post to Slack
        await postSupportAssignment(
          CONFIG.slackToken,
          CONFIG.channelId,
          nextEngineers,
          null,
          CONFIG.daysPerRotation
        );

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