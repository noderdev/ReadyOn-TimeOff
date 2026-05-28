import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import {
  HcmService,
  HcmUnavailableException,
  HcmInsufficientBalanceException,
  HcmValidationException,
} from '../../src/hcm/hcm.service';

function makeAxiosResponse(data: any, status = 200): AxiosResponse {
  return { data, status, statusText: 'OK', headers: {}, config: { headers: {} } as any };
}

function makeAxiosError(status?: number, code?: string): AxiosError {
  const error = new AxiosError('Request failed', code);
  if (status !== undefined) {
    error.response = {
      status,
      data: {},
      statusText: 'Error',
      headers: {},
      config: { headers: {} } as any,
    };
  }
  if (code) {
    error.code = code;
  }
  return error;
}

describe('HcmService', () => {
  let service: HcmService;
  let httpService: jest.Mocked<HttpService>;
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Make setTimeout synchronous so retry delays don't slow tests
    setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((cb: any) => { cb(); return 0 as any; });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmService,
        {
          provide: HttpService,
          useValue: { get: jest.fn(), post: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: any) => {
              if (key === 'HCM_BASE_URL') return 'http://mock-hcm';
              if (key === 'HCM_TIMEOUT_MS') return 5000;
              if (key === 'HCM_RETRY_COUNT') return 2;
              return def;
            },
          },
        },
      ],
    }).compile();

    service = module.get<HcmService>(HcmService);
    httpService = module.get(HttpService);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('returns balance on success', async () => {
      httpService.get.mockReturnValue(of(makeAxiosResponse({ balance: 10 })));

      const result = await service.getBalance('emp-1', 'loc-1');

      expect(result).toEqual({ balance: 10 });
      expect(httpService.get).toHaveBeenCalledWith(
        'http://mock-hcm/hcm/balances/emp-1/loc-1',
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it('retries on HcmUnavailableException and succeeds on second attempt', async () => {
      httpService.get
        .mockReturnValueOnce(throwError(() => makeAxiosError(503)))
        .mockReturnValueOnce(of(makeAxiosResponse({ balance: 5 })));

      const result = await service.getBalance('emp-1', 'loc-1');

      expect(result).toEqual({ balance: 5 });
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('throws HcmUnavailableException after all retries exhausted', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(503)));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
      expect(httpService.get).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });

  describe('deductBalance', () => {
    it('returns success response', async () => {
      httpService.post.mockReturnValue(
        of(makeAxiosResponse({ success: true, hcmRequestId: 'hcm-abc' })),
      );

      const result = await service.deductBalance('emp-1', 'loc-1', 3, 'req-1');

      expect(result).toEqual({ success: true, hcmRequestId: 'hcm-abc' });
    });

    it('does NOT retry on failure (non-idempotent)', async () => {
      httpService.post.mockReturnValue(throwError(() => makeAxiosError(503)));

      await expect(service.deductBalance('emp-1', 'loc-1', 3, 'req-1')).rejects.toThrow(
        HcmUnavailableException,
      );
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it('throws HcmInsufficientBalanceException on 422', async () => {
      httpService.post.mockReturnValue(throwError(() => makeAxiosError(422)));

      await expect(service.deductBalance('emp-1', 'loc-1', 3, 'req-1')).rejects.toThrow(
        HcmInsufficientBalanceException,
      );
    });
  });

  describe('restoreBalance', () => {
    it('returns success response', async () => {
      httpService.post.mockReturnValue(of(makeAxiosResponse({ success: true })));

      const result = await service.restoreBalance('emp-1', 'loc-1', 3, 'req-1');

      expect(result).toEqual({ success: true });
    });

    it('retries on server error and succeeds on second attempt', async () => {
      httpService.post
        .mockReturnValueOnce(throwError(() => makeAxiosError(500)))
        .mockReturnValueOnce(of(makeAxiosResponse({ success: true })));

      const result = await service.restoreBalance('emp-1', 'loc-1', 3, 'req-1');

      expect(result).toEqual({ success: true });
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleAxiosError — all error branches', () => {
    it('re-throws HcmInsufficientBalanceException without wrapping', async () => {
      const original = new HcmInsufficientBalanceException('already typed');
      httpService.post.mockReturnValue(throwError(() => original));

      await expect(service.deductBalance('emp-1', 'loc-1', 3, 'req-1')).rejects.toThrow(
        HcmInsufficientBalanceException,
      );
      // deductBalance has retry=false, so only 1 call
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it('re-throws HcmUnavailableException (retries exhausted)', async () => {
      const original = new HcmUnavailableException('already typed');
      httpService.get.mockReturnValue(throwError(() => original));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(
        HcmUnavailableException,
      );
      // HcmUnavailableException is retried — expects 3 calls
      expect(httpService.get).toHaveBeenCalledTimes(3);
    });

    it('throws HcmValidationException on 400 response', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(400)));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmValidationException);
    });

    it('throws HcmUnavailableException on 500 response', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(500)));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
    });

    it('throws HcmUnavailableException on unexpected 4xx response (e.g. 403)', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(403)));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
    });

    it('throws HcmUnavailableException on ECONNABORTED (client timeout)', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(undefined, 'ECONNABORTED')));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
    });

    it('throws HcmUnavailableException on ETIMEDOUT', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(undefined, 'ETIMEDOUT')));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
    });

    it('throws HcmUnavailableException on ECONNREFUSED', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(undefined, 'ECONNREFUSED')));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
    });

    it('throws HcmUnavailableException on ENOTFOUND', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(undefined, 'ENOTFOUND')));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
    });

    it('throws HcmUnavailableException on unknown error with no response or code', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('something weird')));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmUnavailableException);
    });
  });

  describe('withRetry — business logic errors skip retries', () => {
    it('does not retry on HcmValidationException (400)', async () => {
      httpService.get.mockReturnValue(throwError(() => makeAxiosError(400)));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(HcmValidationException);
      expect(httpService.get).toHaveBeenCalledTimes(1);
    });

    it('does not retry on HcmInsufficientBalanceException (422)', async () => {
      httpService.post.mockReturnValue(throwError(() => makeAxiosError(422)));

      await expect(service.deductBalance('emp-1', 'loc-1', 3, 'req-1')).rejects.toThrow(
        HcmInsufficientBalanceException,
      );
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });
  });
});
