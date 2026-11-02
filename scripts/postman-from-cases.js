#!/usr/bin/env node
/**
 * postman-from-cases.js — builds the counter-test Postman collection from the case table.
 * Rule: SKILL.md → Decisions → Counter-tests. Runs via newman against {{baseUrl}} = STAGING_BASE_URL.
 * Usage: node files/postman-from-cases.js cases.json > [FEATURE_NAME].postman_collection.json
 *
 * cases.json shape (export of case-table.md; endpoints only):
 * [{ "id":"H1", "path":"happy", "method":"POST", "url":"/transfers", "auth":"{{adminToken}}",
 *    "body":{ "amount":5000, "to":"ACC1" }, "expect":{ "status":201, "body":{ "status":"SUCCESS" } } }]
 */
const fs = require('fs');
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const item = cases.map(c => ({
  name: `${c.id} [${c.path}]`,
  request: {
    method: c.method, url: { raw: `{{baseUrl}}${c.url}`, host: ['{{baseUrl}}'], path: c.url.split('/').filter(Boolean) },
    header: [{ key: 'Content-Type', value: 'application/json' }, ...(c.auth ? [{ key: 'Authorization', value: `Bearer ${c.auth}` }] : [])],
    body: c.body ? { mode: 'raw', raw: JSON.stringify(c.body), options: { raw: { language: 'json' } } } : undefined,
  },
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    `pm.test("${c.id} status ${c.expect.status}", () => pm.response.to.have.status(${c.expect.status}));`,
    ...Object.entries(c.expect.body || {}).map(([k, v]) =>
      `pm.test("${c.id} body.${k}", () => pm.expect(pm.response.json().${k}).to.eql(${JSON.stringify(v)}));`),
  ] } }],
}));
process.stdout.write(JSON.stringify({
  info: { name: '[FEATURE_NAME] counter-test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item, variable: [{ key: 'baseUrl', value: '' }],
}, null, 2));
// Filled-in run: newman run transfers.postman_collection.json --env-var baseUrl=$STAGING_BASE_URL --env-var adminToken=$STAGING_ADMIN_TOKEN
