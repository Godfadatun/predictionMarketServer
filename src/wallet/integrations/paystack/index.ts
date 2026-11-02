import { systemSettings } from '@/common/settings';
import { WALLET_SETTINGS } from '../../constants/wallet.constants';
import { paystackClient } from './client';
import { PaystackMockV1 } from './mocks/v1';

// Mock only when systemSettings enables it AND APP_ENV is staging. Production never mocks.
export const paystack = () => (systemSettings.useMock(WALLET_SETTINGS.PAYSTACK_MOCK_KEY) ? new PaystackMockV1() : paystackClient);
