jest.mock('../../src/models/user', () => ({
  getById: jest.fn(),
}));

const User = require('../../src/models/user');
const { walletExists } = require('../../src/utils/validators');

describe('walletExists async contract', () => {
  afterEach(() => jest.resetAllMocks());

  it('awaits a matching wallet lookup', async () => {
    User.getById.mockResolvedValue({ id: 42 });

    await expect(walletExists(42)).resolves.toBe(true);
    expect(User.getById).toHaveBeenCalledWith(42);
  });

  it('resolves false for a missing wallet', async () => {
    User.getById.mockResolvedValue(null);

    await expect(walletExists(404)).resolves.toBe(false);
  });

  it('returns a promise even for invalid input', () => {
    expect(walletExists(null)).toBeInstanceOf(Promise);
  });
});
