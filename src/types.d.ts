export {};

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id?: string | number;
        keyId?: string | number;
        key?: string;
        keySecret?: string;
        keyPrefix?: string;
        name?: string;
        role?: string;
        scopes?: string[];
        subject?: string;
        isLegacy?: boolean;
        monthlyQuota?: number;
        quotaUsed?: number;
        quotaResetAt?: string | number | Date;
      };
      user?: {
        id?: string | number;
        role?: string;
        subject?: string;
        authMethod?: string;
        wallet?: unknown;
        [claim: string]: unknown;
      };
      id?: string;
    }
  }
}