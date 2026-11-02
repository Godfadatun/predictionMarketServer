import nock from 'nock';
import { ctx } from './bootstrap';

beforeAll(async () => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  await ctx.start();
});
afterAll(async () => {
  await ctx.stop();
  nock.cleanAll();
  nock.enableNetConnect();
});
