import { WebClient } from '@slack/web-api';

/**
 * Post a support assignment message to Slack
 * @param {string} token - Slack API token
 * @param {string} channel - Channel to post to (without the #)
 * @param {string[]} engineers - Array of engineer user IDs
 * @param {string} customMessage - Optional custom message
 * @param {number} daysPerRotation - Number of days per rotation
 */
export async function postSupportAssignment(token, channel, engineers, customMessage = null, daysPerRotation = 2) {
  const client = new WebClient(token);

  // Format the engineers as user mentions
  const engineerMentions = engineers.map(id => `<@${id}>`).join(' and ');

  // Create the message
  const message = customMessage || `Good morning team! :sunny:`;
  const supportMessage = `${engineerMentions} are on application support for the next ${daysPerRotation} working days.`;

  try {
    await client.chat.postMessage({
      channel,
      text: `${message}\n\n${supportMessage}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: message
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rotating_light: *Support Assignment* :rotating_light:\n${supportMessage}`
          }
        },
        {
          type: "divider"
        }
      ]
    });

    console.log(`Posted support assignment to #${channel}`);
  } catch (error) {
    console.error('Error posting to Slack:', error);
    throw error;
  }
}

/**
 * Get all members of a user group
 * @param {string} token - Slack API token
 * @param {string} userGroupId - User group ID (without the @)
 * @returns {Promise<string[]>} Array of user IDs
 */
export async function getUserGroupMembers(token, userGroupId) {
  const client = new WebClient(token);

  try {
    // First, find the user group ID if we only have the handle
    const userGroupsResponse = await client.usergroups.list();

    if (!userGroupsResponse.ok) {
      throw new Error(`Failed to list user groups: ${userGroupsResponse.error}`);
    }

    // Find the group that matches our ID or handle
    const userGroup = userGroupsResponse.usergroups.find(group =>
      group.id === userGroupId || group.handle === userGroupId
    );

    if (!userGroup) {
      throw new Error(`User group "${userGroupId}" not found`);
    }

    // Get members of the group
    const membersResponse = await client.usergroups.users.list({
      usergroup: userGroup.id
    });

    if (!membersResponse.ok) {
      throw new Error(`Failed to list user group members: ${membersResponse.error}`);
    }

    return membersResponse.users;
  } catch (error) {
    console.error('Error getting user group members:', error);
    throw error;
  }
}

/**
 * Get statuses for a list of users
 * @param {string} token - Slack API token
 * @param {string[]} userIds - Array of user IDs
 * @returns {Promise<Object>} Map of user IDs to their status objects
 */
export async function getUserStatuses(token, userIds) {
  const client = new WebClient(token);
  const statuses = {};

  try {
    // Get status for each user
    // We're doing this in parallel for better performance
    await Promise.all(userIds.map(async (userId) => {
      try {
        const userInfo = await client.users.info({ user: userId });

        if (userInfo.ok && userInfo.user.profile) {
          statuses[userId] = {
            statusEmoji: userInfo.user.profile.status_emoji || '',
            statusText: userInfo.user.profile.status_text || '',
            statusExpiration: userInfo.user.profile.status_expiration || 0
          };
        }
      } catch (userError) {
        console.warn(`Error getting status for user ${userId}:`, userError);
        // Continue with other users
      }
    }));

    return statuses;
  } catch (error) {
    console.error('Error getting user statuses:', error);
    throw error;
  }
}