import { MockHcmServer } from '../test/mock-hcm/mock-hcm.server';

const server = new MockHcmServer();

// Pre-seed some employees with balances
server.seed('emp-1', 'loc-NYC', 10);
server.seed('emp-2', 'loc-LA', 8);

server.start(3001).then(() => {
  console.log('Mock HCM server running on http://localhost:3001');
  console.log('Pre-seeded balances:');
  console.log('  emp-1 / loc-NYC: 10 days');
  console.log('  emp-2 / loc-LA:  8 days');
});
