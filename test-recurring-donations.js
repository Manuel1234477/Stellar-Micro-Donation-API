const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

// Test data - using existing users from the database
const testData = {
  donorPublicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU',
  recipientPublicKey: 'GCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X',
  amount: 10.5,
  frequency: 'daily'
};

async function testCreateRecurringDonation() {
  console.log('Test 1: Create recurring donation schedule');
  console.log('==========================================\n');

  try {
    const response = await axios.post(`${BASE_URL}/stream/create`, testData);
    console.log('✓ Success!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('\n');
    return response.data.data.scheduleId;
  } catch (error) {
    console.error('✗ Failed:', error.response?.data || error.message);
    console.log('\n');
    return null;
  }
}

async function testGetAllSchedules() {
  console.log('Test 2: Get all recurring donation schedules');
  console.log('============================================\n');

  try {
    const response = await axios.get(`${BASE_URL}/stream/schedules`);
    console.log('✓ Success!');
    console.log(`Found ${response.data.count} schedule(s)`);
    console.log('Schedules:', JSON.stringify(response.data.data, null, 2));
    console.log('\n');
  } catch (error) {
    console.error('✗ Failed:', error.response?.data || error.message);
    console.log('\n');
  }
}

async function testGetScheduleById(scheduleId) {
  console.log(`Test 3: Get schedule by ID (${scheduleId})`);
  console.log('==========================================\n');

  try {
    const response = await axios.get(`${BASE_URL}/stream/schedules/${scheduleId}`);
    console.log('✓ Success!');
    console.log('Schedule:', JSON.stringify(response.data.data, null, 2));
    console.log('\n');
  } catch (error) {
    console.error('✗ Failed:', error.response?.data || error.message);
    console.log('\n');
  }
}

async function testCreateWithInvalidData() {
  console.log('Test 4: Create with invalid data (should fail)');
  console.log('===============================================\n');

  try {
    await axios.post(`${BASE_URL}/stream/create`, {
      donorPublicKey: testData.donorPublicKey,
      recipientPublicKey: testData.recipientPublicKey,
      amount: -5, // Invalid amount
      frequency: 'daily'
    });
    console.log('✗ Should have failed but succeeded');
    console.log('\n');
  } catch (error) {
    console.log('✓ Correctly rejected invalid data');
    console.log('Error:', error.response?.data?.error);
    console.log('\n');
  }
}

async function testCreateWithInvalidFrequency() {
  console.log('Test 5: Create with invalid frequency (should fail)');
  console.log('===================================================\n');

  try {
    await axios.post(`${BASE_URL}/stream/create`, {
      donorPublicKey: testData.donorPublicKey,
      recipientPublicKey: testData.recipientPublicKey,
      amount: 10,
      frequency: 'hourly' // Invalid frequency
    });
    console.log('✗ Should have failed but succeeded');
    console.log('\n');
  } catch (error) {
    console.log('✓ Correctly rejected invalid frequency');
    console.log('Error:', error.response?.data?.error);
    console.log('\n');
  }
}

async function testCancelSchedule(scheduleId) {
  console.log(`Test 6: Cancel schedule (${scheduleId})`);
  console.log('==========================================\n');

  try {
    const response = await axios.delete(`${BASE_URL}/stream/schedules/${scheduleId}`);
    console.log('✓ Success!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('\n');
  } catch (error) {
    console.error('✗ Failed:', error.response?.data || error.message);
    console.log('\n');
  }
}

async function runTests() {
  console.log('Testing Recurring Donations API');
  console.log('================================\n');

  // Test 1: Create a recurring donation
  const scheduleId = await testCreateRecurringDonation();

  // Test 2: Get all schedules
  await testGetAllSchedules();

  // Test 3: Get schedule by ID
  if (scheduleId) {
    await testGetScheduleById(scheduleId);
  }

  // Test 4: Invalid amount
  await testCreateWithInvalidData();

  // Test 5: Invalid frequency
  await testCreateWithInvalidFrequency();

  // Test 6: Cancel schedule
  if (scheduleId) {
    await testCancelSchedule(scheduleId);
  }

  console.log('All tests completed!');
}

// Check if server is running
axios.get(`${BASE_URL}/health`)
  .then(() => {
    runTests();
  })
  .catch(() => {
    console.error('Error: Server is not running at', BASE_URL);
    console.error('Please start the server with: npm start');
    process.exit(1);
  });
