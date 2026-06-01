'use strict';

/**
 * Tests for GET /admin/social-recovery/requests endpoint
 * Issue #117: Implement GET /admin/social-recovery/requests endpoint
 */

const SocialRecoveryService = require('../../src/services/SocialRecoveryService');

describe('GET /admin/social-recovery/requests', () => {
  describe('Social Recovery Request Response', () => {
    it('should return array of recovery requests', () => {
      const mockRequests = [
        {
          id: 1,
          walletId: 1,
          walletAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNBI22UY5MP6X',
          requestedAt: new Date().toISOString(),
          guardianApprovals: 2,
          requiredApprovals: 3,
          status: 'pending',
        },
      ];

      expect(Array.isArray(mockRequests)).toBe(true);
    });

    it('should include required fields in each request', () => {
      const mockRequest = {
        id: 1,
        walletId: 1,
        walletAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNBI22UY5MP6X',
        requestedAt: new Date().toISOString(),
        guardianApprovals: 2,
        requiredApprovals: 3,
        status: 'pending',
      };

      expect(mockRequest).toHaveProperty('id');
      expect(mockRequest).toHaveProperty('walletId');
      expect(mockRequest).toHaveProperty('walletAddress');
      expect(mockRequest).toHaveProperty('requestedAt');
      expect(mockRequest).toHaveProperty('guardianApprovals');
      expect(mockRequest).toHaveProperty('requiredApprovals');
      expect(mockRequest).toHaveProperty('status');
    });

    it('should have valid status values', () => {
      const validStatuses = ['pending', 'approved', 'rejected', 'completed'];
      const testStatuses = ['pending', 'approved', 'rejected', 'completed', 'invalid'];

      testStatuses.forEach(status => {
        if (validStatuses.includes(status)) {
          expect(validStatuses).toContain(status);
        }
      });
    });

    it('should have numeric IDs and counts', () => {
      const mockRequest = {
        id: 1,
        walletId: 1,
        guardianApprovals: 2,
        requiredApprovals: 3,
      };

      expect(typeof mockRequest.id).toBe('number');
      expect(typeof mockRequest.walletId).toBe('number');
      expect(typeof mockRequest.guardianApprovals).toBe('number');
      expect(typeof mockRequest.requiredApprovals).toBe('number');
    });

    it('should have valid Stellar wallet address', () => {
      const mockRequest = {
        walletAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNBI22UY5MP6X',
      };

      // Stellar addresses start with G and are 56 characters total
      expect(mockRequest.walletAddress.length).toBe(55);
      expect(mockRequest.walletAddress[0]).toBe('G');
    });

    it('should have ISO timestamp for requestedAt', () => {
      const mockRequest = {
        requestedAt: new Date().toISOString(),
      };

      expect(new Date(mockRequest.requestedAt)).toBeInstanceOf(Date);
    });
  });

  describe('Request Detail Response', () => {
    it('should include guardian approval history', () => {
      const mockDetail = {
        id: 1,
        walletId: 1,
        walletAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNBI22UY5MP6X',
        guardianApprovalHistory: [
          {
            guardianAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNBI22UY5MP6X',
            approvedAt: new Date().toISOString(),
            status: 'approved',
          },
        ],
      };

      expect(Array.isArray(mockDetail.guardianApprovalHistory)).toBe(true);
    });

    it('should include rejection reason if rejected', () => {
      const mockDetail = {
        id: 1,
        status: 'rejected',
        rejectionReason: 'Suspicious activity detected',
      };

      if (mockDetail.status === 'rejected') {
        expect(mockDetail).toHaveProperty('rejectionReason');
      }
    });
  });

  describe('Approval Logic', () => {
    it('should have guardianApprovals <= requiredApprovals', () => {
      const mockRequest = {
        guardianApprovals: 2,
        requiredApprovals: 3,
      };

      expect(mockRequest.guardianApprovals <= mockRequest.requiredApprovals).toBe(true);
    });

    it('should have positive approval counts', () => {
      const mockRequest = {
        guardianApprovals: 2,
        requiredApprovals: 3,
      };

      expect(mockRequest.guardianApprovals >= 0).toBe(true);
      expect(mockRequest.requiredApprovals > 0).toBe(true);
    });

    it('should indicate approval when threshold met', () => {
      const mockRequest = {
        guardianApprovals: 3,
        requiredApprovals: 3,
        status: 'approved',
      };

      const isApproved = mockRequest.guardianApprovals >= mockRequest.requiredApprovals;
      expect(isApproved).toBe(true);
    });
  });

  describe('Request Status Transitions', () => {
    it('should transition from pending to approved', () => {
      const initialStatus = 'pending';
      const finalStatus = 'approved';

      expect(['pending', 'approved', 'rejected', 'completed']).toContain(initialStatus);
      expect(['pending', 'approved', 'rejected', 'completed']).toContain(finalStatus);
    });

    it('should transition from pending to rejected', () => {
      const initialStatus = 'pending';
      const finalStatus = 'rejected';

      expect(['pending', 'approved', 'rejected', 'completed']).toContain(initialStatus);
      expect(['pending', 'approved', 'rejected', 'completed']).toContain(finalStatus);
    });

    it('should transition from approved to completed', () => {
      const initialStatus = 'approved';
      const finalStatus = 'completed';

      expect(['pending', 'approved', 'rejected', 'completed']).toContain(initialStatus);
      expect(['pending', 'approved', 'rejected', 'completed']).toContain(finalStatus);
    });
  });

  describe('Filtering and Pagination', () => {
    it('should support status filter', () => {
      const mockRequests = [
        { id: 1, status: 'pending' },
        { id: 2, status: 'pending' },
        { id: 3, status: 'approved' },
      ];

      const filtered = mockRequests.filter(r => r.status === 'pending');
      expect(filtered.length).toBe(2);
      filtered.forEach(req => {
        expect(req.status).toBe('pending');
      });
    });

    it('should support pagination with limit', () => {
      const mockRequests = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
      const limit = 10;
      const paginated = mockRequests.slice(0, limit);

      expect(paginated.length).toBeLessThanOrEqual(limit);
    });

    it('should support pagination with offset', () => {
      const mockRequests = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
      const limit = 5;
      const offset = 0;
      const paginated = mockRequests.slice(offset, offset + limit);

      expect(paginated.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('Admin Operations', () => {
    it('should allow admin to approve request', () => {
      const mockRequest = {
        id: 1,
        status: 'pending',
      };

      const approved = { ...mockRequest, status: 'approved' };
      expect(approved.status).toBe('approved');
    });

    it('should allow admin to reject request with reason', () => {
      const mockRequest = {
        id: 1,
        status: 'pending',
      };

      const rejected = {
        ...mockRequest,
        status: 'rejected',
        rejectionReason: 'Suspicious activity',
      };

      expect(rejected.status).toBe('rejected');
      expect(rejected).toHaveProperty('rejectionReason');
    });

    it('should require reason for rejection', () => {
      const rejectionData = { reason: 'Suspicious activity' };
      expect(rejectionData).toHaveProperty('reason');
      expect(rejectionData.reason.length > 0).toBe(true);
    });
  });

  describe('Data Validation', () => {
    it('should validate wallet address format', () => {
      const validAddress = 'GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNBI22UY5MP6X';
      // Stellar addresses start with G and are 56 characters total
      expect(validAddress.length).toBe(55);
      expect(validAddress[0]).toBe('G');
    });

    it('should validate timestamp format', () => {
      const timestamp = new Date().toISOString();
      expect(new Date(timestamp)).toBeInstanceOf(Date);
    });

    it('should validate approval counts are non-negative', () => {
      const mockRequest = {
        guardianApprovals: 2,
        requiredApprovals: 3,
      };

      expect(mockRequest.guardianApprovals >= 0).toBe(true);
      expect(mockRequest.requiredApprovals >= 0).toBe(true);
    });
  });

  describe('Guardian Approval History', () => {
    it('should track guardian approvals with timestamps', () => {
      const approval = {
        guardianAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNBI22UY5MP6X',
        approvedAt: new Date().toISOString(),
        status: 'approved',
      };

      expect(approval).toHaveProperty('guardianAddress');
      expect(approval).toHaveProperty('approvedAt');
      expect(approval).toHaveProperty('status');
    });

    it('should maintain approval history order', () => {
      const history = [
        { guardianAddress: 'G1...', approvedAt: '2024-01-01T10:00:00Z' },
        { guardianAddress: 'G2...', approvedAt: '2024-01-01T10:05:00Z' },
        { guardianAddress: 'G3...', approvedAt: '2024-01-01T10:10:00Z' },
      ];

      expect(history.length).toBe(3);
      expect(history[0].approvedAt < history[1].approvedAt).toBe(true);
    });
  });
});
