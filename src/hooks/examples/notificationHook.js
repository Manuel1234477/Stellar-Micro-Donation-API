/**
 * Notification Hook Example
 *
 * This hook sends notifications for donation lifecycle events.
 * It demonstrates async hook operations and error handling.
 *
 * Usage:
 *   const notificationHook = require('./hooks/examples/notificationHook');
 *   notificationHook.register();
 */

const donationEvents = require('../../events/donationEvents');

/**
 * Simulated email service
 * In production, replace with actual email service (SendGrid, AWS SES, etc.)
 */
const emailService = {
  async send(to, subject, body) {
    // Simulate async email sending
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log(`[Email] To: ${to}`);
        console.log(`[Email] Subject: ${subject}`);
        console.log(`[Email] Body: ${body}`);
        resolve({ success: true });
      }, 100);
    });
  }
};

/**
 * Simulated SMS service
 * In production, replace with actual SMS service (Twilio, AWS SNS, etc.)
 */
const smsService = {
  async send(to, message) {
    // Simulate async SMS sending
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log(`[SMS] To: ${to}`);
        console.log(`[SMS] Message: ${message}`);
        resolve({ success: true });
      }, 100);
    });
  }
};

/**
 * Send notification for donation creation
 * @param {Object} payload - donation.created event payload
 */
async function notifyCreation(payload) {
  const { transaction } = payload;

  try {
    // Send confirmation email to donor
    await emailService.send(
      transaction.donor,
      'Donation Received - Thank You!',
      `Dear ${transaction.donor},\n\nThank you for your generous donation of $${transaction.amount} to ${transaction.recipient}.\n\nTransaction ID: ${transaction.id}\nTimestamp: ${transaction.timestamp}\n\nYour support makes a difference!\n\nBest regards,\nDonation Platform`
    );

    // Send notification to recipient
    await emailService.send(
      transaction.recipient,
      'New Donation Received',
      `You have received a new donation of $${transaction.amount} from ${transaction.donor}.\n\nTransaction ID: ${transaction.id}\nTimestamp: ${transaction.timestamp}`
    );

    console.log('[Notification] Creation notifications sent successfully');
  } catch (error) {
    console.error('[Notification] Error sending creation notifications:', error.message);
  }
}

/**
 * Send notification for donation submission
 * @param {Object} payload - donation.submitted event payload
 */
async function notifySubmission(payload) {
  try {
    console.log('[Notification] Donation submitted for verification:', {
      hash: payload.transactionHash,
      id: payload.transactionId
    });

    // In production, you might send a notification here
    // For now, just log it
  } catch (error) {
    console.error('[Notification] Error processing submission notification:', error.message);
  }
}

/**
 * Send notification for successful verification
 * @param {Object} payload - donation.confirmed event payload
 */
async function notifyConfirmation(payload) {
  try {
    // Send verification success notification
    console.log('[Notification] Sending verification success notification');

    // In production, send actual notification
    // await emailService.send(
    //   donor,
    //   'Donation Verified',
    //   `Your donation has been successfully verified on the blockchain.\n\nTransaction Hash: ${payload.transactionHash}`
    // );

    console.log('[Notification] Confirmation notification sent successfully');
  } catch (error) {
    console.error('[Notification] Error sending confirmation notification:', error.message);
  }
}

/**
 * Send notification for donation failure
 * @param {Object} payload - donation.failed event payload
 */
async function notifyFailure(payload) {
  try {
    const { errorCode, errorMessage, context } = payload;

    console.log('[Notification] Sending failure notification');

    if (context.stage === 'creation') {
      // Notify about creation failure
      console.log(`[Notification] Donation creation failed: ${errorMessage}`);

      // In production, send notification to support team
      // await emailService.send(
      //   'support@example.com',
      //   'Donation Creation Failed',
      //   `Error: ${errorCode}\nMessage: ${errorMessage}\nContext: ${JSON.stringify(context)}`
      // );
    } else if (context.stage === 'verification') {
      // Notify about verification failure
      console.log(`[Notification] Donation verification failed: ${errorMessage}`);

      // In production, send notification to donor
      // await emailService.send(
      //   donor,
      //   'Donation Verification Failed',
      //   `We were unable to verify your donation.\n\nError: ${errorMessage}\n\nPlease contact support if you need assistance.`
      // );
    }

    console.log('[Notification] Failure notification sent successfully');
  } catch (error) {
    console.error('[Notification] Error sending failure notification:', error.message);
  }
}

/**
 * Register notification hook for all lifecycle events
 */
function register() {
  const events = donationEvents.constructor.EVENTS;

  donationEvents.registerHook(events.CREATED, (payload) => {
    // Use async IIFE to handle async operations
    (async () => {
      try {
        await notifyCreation(payload);
      } catch (error) {
        console.error('Notification hook error (creation):', error.message);
      }
    })();
  });

  donationEvents.registerHook(events.SUBMITTED, (payload) => {
    (async () => {
      try {
        await notifySubmission(payload);
      } catch (error) {
        console.error('Notification hook error (submission):', error.message);
      }
    })();
  });

  donationEvents.registerHook(events.CONFIRMED, (payload) => {
    (async () => {
      try {
        await notifyConfirmation(payload);
      } catch (error) {
        console.error('Notification hook error (confirmation):', error.message);
      }
    })();
  });

  donationEvents.registerHook(events.FAILED, (payload) => {
    (async () => {
      try {
        await notifyFailure(payload);
      } catch (error) {
        console.error('Notification hook error (failure):', error.message);
      }
    })();
  });

  console.log('Notification hook registered for all donation events');
}

module.exports = {
  register,
  // Export services for testing/mocking
  emailService,
  smsService
};
