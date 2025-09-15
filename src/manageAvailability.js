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
  engineersPerShift: parseInt(process.env.ENGINEERS_PER_SHIFT || '2', 10), // Number of engineers on support at once
  slackEnabled: process.env.SLACK_ENABLED !== 'false' // Whether to post to Slack (default: false)
};

async function main() {
  try {
    // Check if we have the necessary configuration
    if (CONFIG.slackEnabled && !CONFIG.slackToken) {
      throw new Error('SLACK_TOKEN is required when Slack is enabled');
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

    let engineers = [];
    let userStatuses = {};

    if (CONFIG.slackEnabled) {
      // Get all members of the engineering group
      engineers = await getUserGroupMembers(CONFIG.slackToken, CONFIG.userGroupId);
      // Get user statuses to check for out-of-office or illness
      userStatuses = await getUserStatuses(CONFIG.slackToken, engineers);
    } else {
      console.log('Slack is disabled. Using engineers from rotation data.');
      // Use engineers from rotation data when Slack is disabled
      engineers = updatedData.rotationOrder.length > 0 ? updatedData.rotationOrder : ['U123456', 'U234567', 'U345678', 'U456789'];
    }

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
    // Post to Slack or log to console
    if (CONFIG.slackEnabled) {
      await postSupportAssignment(
          CONFIG.slackToken,
          CONFIG.channelId,
          newEngineers,
          'Reassigning support due to non-working days update.',
          CONFIG.daysPerRotation
      );
    } else {
      logSupportAssignment(newEngineers, 'Reassigning support due to non-working days update.', CONFIG.daysPerRotation);
    }

    // Update rotation data
    const finalData = updateRotation(updatedData, newEngineers);

    // Load the data path again to ensure we're using the correct path
    const dataPath = join(dirname(__dirname), 'data', 'rotation.json');
    saveRotationData(dataPath, finalData);

    console.log(`Support reassigned to: ${newEngineers.join(', ')}`);
  }
}

/**
 * Log support assignment to console when Slack is disabled
 * @param {string[]} engineers - Array of engineer user IDs
 * @param {string} customMessage - Optional custom message
 * @param {number} daysPerRotation - Number of days per rotation
 */
function logSupportAssignment(engineers, customMessage = null, daysPerRotation = 2) {
  // Format the engineers as user mentions (or just IDs when Slack is disabled)
  const engineerMentions = engineers.map(id => `<@${id}>`).join(' and ');

  // Create the message
  const message = customMessage || `:sunny: Good morning team! :sunny:`;
  const supportMessage = `${engineerMentions} are on application support for the next ${daysPerRotation} working days. During this time please keep an eye on the #cas-events channel and monitor any alerts that appear there.\n\nIf you are unable to immediately put in a fix for the alert, please document it in some way - either by creating a ticket in JIRA and/or commenting on the alert.\n
  \n<https://dsdmoj.atlassian.net/wiki/spaces/AP/pages/5006426252/CAS+Technical+Support|See support documentation for guidance>.\n
  \nTo add in your non-working days, <https://github.com/ministryofjustice/hmpps-community-accommodation-services-support-bot/actions/workflows/manage-non-working-days.yml|please use the action on the support bot here>.`;

  console.log('\n' + '='.repeat(80));
  console.log('SUPPORT ASSIGNMENT (Slack Disabled)');
  console.log('='.repeat(80));
  console.log(`${message}\n`);
  console.log(`:sunflower: *Support Assignment* :sunflower:`);
  console.log(supportMessage);
  console.log('='.repeat(80));
  console.log('\n📋 COPY THE ABOVE MESSAGE TO YOUR SLACK CHANNEL MANUALLY');
  console.log('='.repeat(80) + '\n');
}

// Run the main function
main();