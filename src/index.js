import { getNextEngineers, updateRotation } from './rotation.js';
import { postSupportAssignment, getUserStatuses, getUserGroupMembers } from './slack.js';
import { loadRotationData, saveRotationData } from './storage.js';
import { getAvailableEngineers, isNonWorkingDay } from './nonWorkingDays.js';
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

    // Determine what action to take
    const action = process.env.ACTION || 'assign';

    // Load current rotation data
    const dataPath = join(dirname(__dirname), 'data', 'rotation.json');
    const rotationData = loadRotationData(dataPath);

    const today = new Date();

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
      engineers = rotationData.rotationOrder.length > 0 ? rotationData.rotationOrder : ['U123456', 'U234567', 'U345678', 'U456789'];
    }

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

    if (action === 'force_reassign') {
      console.log('Forcing support reassignment.');

      // Try to get different engineers than currently assigned
      let nextEngineers;
      let attempts = 0;
      const maxAttempts = 5;

      do {
        // Get next engineers
        nextEngineers = getNextEngineers(rotationData, availableEngineers, CONFIG.engineersPerShift);

        // Shuffle the rotation order to get different engineers on next attempt
        if (availableEngineers.length > CONFIG.engineersPerShift) {
          shuffleArray(rotationData.rotationOrder);
        }

        attempts++;
        // Break if we've tried several times or have limited engineers
        if (attempts >= maxAttempts || availableEngineers.length <= CONFIG.engineersPerShift) {
          break;
        }
      } while (arraysHaveSameElements(nextEngineers, rotationData.currentEngineers));

      // Post to Slack or log to console
      if (CONFIG.slackEnabled) {
        await postSupportAssignment(
            CONFIG.slackToken,
            CONFIG.channelId,
            nextEngineers,
            'Support duty has been reassigned.',
            CONFIG.daysPerRotation
        );
      } else {
        logSupportAssignment(nextEngineers, 'Support duty has been reassigned.', CONFIG.daysPerRotation);
      }

      // Update rotation data
      const updatedData = updateRotation(rotationData, nextEngineers);
      saveRotationData(dataPath, updatedData);

      console.log(`Support reassigned to: ${nextEngineers.join(', ')}`);
    } else {
      // Regular assignment logic
      // Check if it's time for a new rotation (every other working day)
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

        // Get next engineers
        const nextEngineers = getNextEngineers(rotationData, availableEngineers, CONFIG.engineersPerShift);

        // Post to Slack or log to console
        if (CONFIG.slackEnabled) {
          await postSupportAssignment(
              CONFIG.slackToken,
              CONFIG.channelId,
              nextEngineers,
              null,
              CONFIG.daysPerRotation
          );
        } else {
          logSupportAssignment(nextEngineers, null, CONFIG.daysPerRotation);
        }

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

/**
 * Helper function to check if arrays have the same elements (regardless of order)
 * @param {Array} arr1 - First array
 * @param {Array} arr2 - Second array
 * @returns {boolean} True if arrays have the same elements
 */
function arraysHaveSameElements(arr1, arr2) {
  if (!arr1 || !arr2) return false;
  if (arr1.length !== arr2.length) return false;

  const set1 = new Set(arr1);
  return arr2.every(item => set1.has(item));
}

/**
 * Helper function to shuffle an array
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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

main();