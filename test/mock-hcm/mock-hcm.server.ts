import * as http from 'http';
import express from 'express';
import { randomUUID } from 'crypto';

type Express = express.Express;

interface CallLogEntry {
  method: string;
  path: string;
  body: any;
  timestamp: Date;
}

interface MockConfig {
  simulateInsufficientBalance: boolean;
  simulateNetworkTimeout: boolean;
  simulateDowntime: boolean;
}

export class MockHcmServer {
  private app: Express;
  private server: http.Server;
  private balances: Map<string, number>;
  private callLog: CallLogEntry[];
  private config: MockConfig;
  public port: number;

  constructor() {
    this.balances = new Map();
    this.callLog = [];
    this.config = {
      simulateInsufficientBalance: false,
      simulateNetworkTimeout: false,
      simulateDowntime: false,
    };
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Middleware to log all calls
    this.app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.callLog.push({
        method: req.method,
        path: req.path,
        body: req.body,
        timestamp: new Date(),
      });
      next();
    });

    // Middleware for downtime simulation
    this.app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (this.config.simulateDowntime) {
        return res.status(503).json({ error: 'HCM service unavailable' });
      }
      next();
    });

    // Middleware for network timeout simulation
    this.app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (this.config.simulateNetworkTimeout) {
        // Just hang — don't call next(), never respond
        return;
      }
      next();
    });

    // GET /hcm/balances/:employeeId/:locationId
    this.app.get('/hcm/balances/:employeeId/:locationId', (req: express.Request, res: express.Response) => {
      const { employeeId, locationId } = req.params;
      const key = `${employeeId}:${locationId}`;
      const balance = this.balances.get(key);

      if (balance === undefined) {
        return res.status(404).json({ error: 'Balance not found' });
      }

      res.json({ balance });
    });

    // POST /hcm/balances/deduct
    this.app.post('/hcm/balances/deduct', (req: express.Request, res: express.Response) => {
      const { employeeId, locationId, days } = req.body;
      const key = `${employeeId}:${locationId}`;
      const currentBalance = this.balances.get(key);

      if (currentBalance === undefined) {
        return res.status(404).json({ error: 'Balance not found' });
      }

      if (this.config.simulateInsufficientBalance || currentBalance < days) {
        return res.status(422).json({
          error: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Available: ${currentBalance}, Requested: ${days}`,
        });
      }

      this.balances.set(key, currentBalance - days);

      res.json({
        success: true,
        hcmRequestId: randomUUID(),
      });
    });

    // POST /hcm/balances/restore
    this.app.post('/hcm/balances/restore', (req: express.Request, res: express.Response) => {
      const { employeeId, locationId, days } = req.body;
      const key = `${employeeId}:${locationId}`;
      const currentBalance = this.balances.get(key);

      if (currentBalance === undefined) {
        return res.status(404).json({ error: 'Balance not found' });
      }

      this.balances.set(key, currentBalance + days);

      res.json({ success: true });
    });
  }

  seed(employeeId: string, locationId: string, balance: number): void {
    const key = `${employeeId}:${locationId}`;
    this.balances.set(key, balance);
  }

  setBalance(employeeId: string, locationId: string, balance: number): void {
    const key = `${employeeId}:${locationId}`;
    this.balances.set(key, balance);
  }

  getBalance(employeeId: string, locationId: string): number {
    const key = `${employeeId}:${locationId}`;
    return this.balances.get(key) ?? 0;
  }

  enableInsufficientBalance(): void {
    this.config.simulateInsufficientBalance = true;
  }

  disableInsufficientBalance(): void {
    this.config.simulateInsufficientBalance = false;
  }

  enableDowntime(): void {
    this.config.simulateDowntime = true;
  }

  disableDowntime(): void {
    this.config.simulateDowntime = false;
  }

  enableNetworkTimeout(): void {
    this.config.simulateNetworkTimeout = true;
  }

  disableNetworkTimeout(): void {
    this.config.simulateNetworkTimeout = false;
  }

  getCallLog(): CallLogEntry[] {
    return [...this.callLog];
  }

  clearCallLog(): void {
    this.callLog = [];
  }

  start(port = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, (err?: Error) => {
        if (err) return reject(err);
        const address = this.server.address() as { port: number };
        this.port = address.port;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}
