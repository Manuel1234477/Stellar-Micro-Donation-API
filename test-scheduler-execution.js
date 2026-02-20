const Database = require('./src/utils/database');

async function createImmediateSchedule() {
  console.log('Creating a schedule that should execute immediately...\n');

  try {
    // Create a schedule with nextExecutionDate in the past
    const pastDate = new Date();
    pastDate.setMinutes(pastDate.getMinutes() - 5); // 5 minutes ago

    const result = await Database.run(
      `INSERT INTO recurring_donations 
       (donorId, recipientId, amount, frequency, nextExecutionDate, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [1, 3, 5.0, 'daily', pastDate.toISOString(), 'active']
    );

    console.log(`✓ Created schedule ${result.id} with past execution date`);
    console.log(`  Next execution date: ${pastDate.toISOString()}`);
    console.log(`  Current time: ${new Date().toISOString()}`);
    console.log('\nThe scheduler should execute this within 60 seconds...');
    console.log('Check the server logs for execution confirmation.\n');

    // Wait a bit and check if it was executed
    console.log('Waiting 65 seconds for scheduler to run...');
    await new Promise(resolve => setTimeout(resolve, 65000));

    // Check the schedule status
    const schedule = await Database.get(
      'SELECT * FROM recurring_donations WHERE id = ?',
      [result.id]
    );

    console.log('\nSchedule after execution:');
    console.log(`  Execution count: ${schedule.executionCount}`);
    console.log(`  Last execution: ${schedule.lastExecutionDate}`);
    console.log(`  Next execution: ${schedule.nextExecutionDate}`);

    if (schedule.executionCount > 0) {
      console.log('\n✓ Scheduler successfully executed the donation!');
      
      // Check if transaction was created
      const transaction = await Database.get(
        `SELECT * FROM transactions 
         WHERE senderId = ? AND receiverId = ? 
         ORDER BY timestamp DESC LIMIT 1`,
        [1, 3]
      );

      if (transaction) {
        console.log('\n✓ Transaction was recorded in database:');
        console.log(`  Amount: ${transaction.amount}`);
        console.log(`  Memo: ${transaction.memo}`);
        console.log(`  Timestamp: ${transaction.timestamp}`);
      }
    } else {
      console.log('\n✗ Scheduler did not execute the donation yet');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

createImmediateSchedule();
