import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest, { SuperAgentTest } from 'supertest';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { MockHcmServer } from '../mock-hcm/mock-hcm.server';
import { BalanceService } from '../../src/balance/balance.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;
  let dataSource: DataSource;
  let balanceService: BalanceService;
  let request: any;

  beforeAll(async () => {
    mockHcm = new MockHcmServer();
    await mockHcm.start(0);

    process.env.HCM_BASE_URL = `http://localhost:${mockHcm.port}`;
    process.env.DB_PATH = ':memory:';
    process.env.HCM_TIMEOUT_MS = '5000';
    process.env.HCM_RETRY_COUNT = '0';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();

    dataSource = moduleFixture.get<DataSource>(getDataSourceToken());
    balanceService = moduleFixture.get<BalanceService>(BalanceService);
    request = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
    await mockHcm.stop();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM time_off_requests');
    await dataSource.query('DELETE FROM balances');
    await dataSource.query('DELETE FROM sync_logs');
    mockHcm.clearCallLog();
    mockHcm.disableDowntime();
    mockHcm.disableInsufficientBalance();
    mockHcm.disableNetworkTimeout();
    balanceService.clearProcessedBatchIds();
  });

  async function seedBalance(employeeId: string, locationId: string, balance: number) {
    mockHcm.seed(employeeId, locationId, balance);
    await request
      .post('/api/v1/balances/sync')
      .send({ employeeId, locationId })
      .expect(200);
  }

  describe('POST /api/v1/time-off-requests', () => {
    it('returns 201 on valid request', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const response = await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-key-1')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        })
        .expect(201);

      expect(response.body.status).toBe('PENDING_APPROVAL');
      expect(response.body.id).toBeDefined();
    });

    it('returns 422 on insufficient balance', async () => {
      await seedBalance('emp-1', 'loc-1', 1);

      await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-key-insuf')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        })
        .expect(422);
    });

    it('returns 409 on duplicate Idempotency-Key', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-dup-key')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 2,
        })
        .expect(201);

      await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-dup-key')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 2,
        })
        .expect(409);
    });
  });

  describe('POST /api/v1/time-off-requests/:id/approve', () => {
    it('returns 200 with HCM_CONFIRMED on success', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const createRes = await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-approve-1')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        })
        .expect(201);

      const approveRes = await request
        .post(`/api/v1/time-off-requests/${createRes.body.id}/approve`)
        .send({ managerId: 'mgr-1' })
        .expect(200);

      expect(approveRes.body.status).toBe('HCM_CONFIRMED');
    });
  });

  describe('GET /api/v1/balances/:emp/:loc', () => {
    it('returns 200 with correct availableDays', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const response = await request
        .get('/api/v1/balances/emp-1/loc-1')
        .expect(200);

      expect(response.body.hcmBalance).toBe(10);
      expect(response.body.availableDays).toBe(10);
    });

    it('returns 404 when balance not found', async () => {
      await request
        .get('/api/v1/balances/emp-nonexistent/loc-nonexistent')
        .expect(404);
    });
  });

  describe('GET /api/v1/balances/:emp/:loc?refresh=true', () => {
    it('triggers HCM call on refresh=true', async () => {
      await seedBalance('emp-1', 'loc-1', 10);
      mockHcm.clearCallLog();

      await request
        .get('/api/v1/balances/emp-1/loc-1?refresh=true')
        .expect(200);

      const hcmCalls = mockHcm.getCallLog().filter((c) =>
        c.path.includes('balances/emp-1'),
      );
      expect(hcmCalls.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/balances/batch', () => {
    it('returns 202 and updates balance', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const response = await request
        .post('/api/v1/balances/batch')
        .send({
          batchId: 'e2e-batch-1',
          generatedAt: new Date().toISOString(),
          balances: [
            { employeeId: 'emp-1', locationId: 'loc-1', balance: 20 },
          ],
        })
        .expect(202);

      expect(response.body.status).toBe('ACCEPTED');
      expect(response.body.recordCount).toBe(1);

      const balanceRes = await request
        .get('/api/v1/balances/emp-1/loc-1')
        .expect(200);

      expect(balanceRes.body.hcmBalance).toBe(20);
    });
  });

  describe('POST /api/v1/time-off-requests/:id/reject', () => {
    it('returns 200 with REJECTED status', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const createRes = await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-reject-1')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        })
        .expect(201);

      const rejectRes = await request
        .post(`/api/v1/time-off-requests/${createRes.body.id}/reject`)
        .send({ managerId: 'mgr-1', reason: 'Not approved' })
        .expect(200);

      expect(rejectRes.body.status).toBe('REJECTED');
    });
  });

  describe('POST /api/v1/time-off-requests/:id/cancel', () => {
    it('returns 200 with CANCELLED status from PENDING_APPROVAL', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const createRes = await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-cancel-1')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        })
        .expect(201);

      const cancelRes = await request
        .post(`/api/v1/time-off-requests/${createRes.body.id}/cancel`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');
    });

    it('returns 200 with CANCELLED status from HCM_CONFIRMED', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const createRes = await request
        .post('/api/v1/time-off-requests')
        .set('idempotency-key', 'e2e-cancel-2')
        .send({
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        })
        .expect(201);

      await request
        .post(`/api/v1/time-off-requests/${createRes.body.id}/approve`)
        .send({ managerId: 'mgr-1' })
        .expect(200);

      const cancelRes = await request
        .post(`/api/v1/time-off-requests/${createRes.body.id}/cancel`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');
    });
  });
});
