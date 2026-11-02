import { systemSettings } from '@/common/settings';
import { WALLET_SETTINGS } from '@/wallet/constants/wallet.constants';
import { paystackPayoutsClient } from './client';
import { PaystackPayoutsMockV1 } from './mocks/v1';

// Shares the paystack.mock switch with wallet; mock only on staging when enabled. Production never mocks.
export const paystackPayouts = () => (systemSettings.useMock(WALLET_SETTINGS.PAYSTACK_MOCK_KEY) ? new PaystackPayoutsMockV1() : paystackPayoutsClient);
