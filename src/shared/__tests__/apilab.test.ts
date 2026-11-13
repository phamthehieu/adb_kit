import { describe, expect, it } from 'vitest'
import {
  applyLiveAuth,
  evalProbe,
  exportPostmanCollection,
  fromCurl,
  importPostmanCollection,
  probesForRequest,
  requestFromCall,
  resolveEnvVars,
  toCurl
} from '../apilab'
import { checkJsonExpr, type NetCall } from '../automation'
import type { ReqApi } from '../reqdoc'

const SAMPLE_CALL: NetCall = {
  id: 'chk-42',
  kind: 'http',
  source: 'chucker',
  method: 'POST',
  url: 'https://api.staging.example.com/v1/orders/create?channel=mobile',
  reqHeaders: [
    { name: ':authority', value: 'api.staging.example.com' },
    { name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.live' },
    { name: 'Content-Type', value: 'application/json' },
    { name: 'X-Device-Id', value: 'SM-S918B' }
  ],
  args: '{"customerId":"CUST01","amount":150000,"note":"Giao giờ hành chính"}',
  status: 200,
  result: '{"success":true,"code":"00","data":{"orderId":"ORD999"}}',
  startedAt: 1700000000000,
  durationMs: 120
}

describe('apilab', () => {
  it('converts a captured NetCall (including Chucker) into an editable ApiRequest and filters pseudo-headers', () => {
    const req = requestFromCall(SAMPLE_CALL)
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://api.staging.example.com/v1/orders/create?channel=mobile')
    expect(req.headers.map((h) => h.name)).toEqual(['Authorization', 'Content-Type', 'X-Device-Id'])
    expect(JSON.parse(req.body)).toEqual({
      customerId: 'CUST01',
      amount: 150000,
      note: 'Giao giờ hành chính'
    })
  })

  it('round-trips cURL export and import', () => {
    const req = requestFromCall(SAMPLE_CALL)
    const curl = toCurl(req)
    expect(curl).toContain('curl -X POST')
    expect(curl).toContain('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.live')
    const parsed = fromCurl(curl)
    expect(parsed).not.toBeNull()
    expect(parsed!.method).toBe('POST')
    expect(parsed!.url).toBe(req.url)
    expect(parsed!.headers.find((h) => h.name === 'Authorization')?.value).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.live')
    expect(JSON.parse(parsed!.body)).toEqual(JSON.parse(req.body))
  })

  it('syncs the freshest auth token from recent device calls', () => {
    const oldReq = requestFromCall(SAMPLE_CALL)
    oldReq.headers[0].value = 'Bearer old_expired_token'
    const newerCall: NetCall = {
      ...SAMPLE_CALL,
      id: 'chk-99',
      startedAt: 1700000050000,
      reqHeaders: [{ name: 'Authorization', value: 'Bearer fresh_token_from_phone' }]
    }
    const { req: synced, updated } = applyLiveAuth(oldReq, [SAMPLE_CALL, newerCall])
    expect(updated).toEqual(['Authorization'])
    expect(synced.headers.find((h) => h.name === 'Authorization')?.value).toBe('Bearer fresh_token_from_phone')
  })

  it('generates happy, auth, missing-field, empty, type and injection probes from request + BA doc', () => {
    const req = requestFromCall(SAMPLE_CALL)
    const apiSpec: ReqApi = {
      id: 'api1',
      name: 'API create-order',
      method: 'POST',
      url: '/v1/orders/create',
      purpose: 'Tạo đơn hàng mới',
      inputs: [
        { name: 'customerId', type: 'String', required: true, desc: 'Mã KH' },
        { name: 'amount', type: 'Number', required: true, desc: 'Số tiền' },
        { name: 'note', type: 'String', required: false, desc: 'Ghi chú' }
      ],
      outputs: [],
      outputText: '',
      steps: [],
      codes: []
    }
    const probes = probesForRequest(req, apiSpec)
    const ids = probes.map((p) => p.id)
    expect(ids).toContain('happy')
    expect(ids).toContain('unauth')
    expect(ids).toContain('bad_token')
    expect(ids).toContain('missing:customerId')
    expect(ids).toContain('empty:customerId')
    expect(ids).toContain('missing:amount')
    expect(ids).toContain('type:amount')
    expect(ids).toContain('inj:customerId')
  })

  it('evaluates server responses accurately for happy, auth, validation and 500 crashes', () => {
    const req = requestFromCall(SAMPLE_CALL)
    const probes = probesForRequest(req)
    const happy = probes.find((p) => p.id === 'happy')!
    const unauth = probes.find((p) => p.id === 'unauth')!
    const missing = probes.find((p) => p.id.startsWith('missing:'))!

    // 1. Happy case 200 OK
    expect(
      evalProbe(happy, {
        ok: true,
        status: 200,
        statusText: 'OK',
        durationMs: 85,
        headers: [],
        body: '{"success":true,"code":"00"}',
        size: 29
      }).pass
    ).toBe(true)

    // 2. Unauth probe: if server returns 200 success -> security bug (FAIL)
    const unauthFail = evalProbe(unauth, {
      ok: true,
      status: 200,
      statusText: 'OK',
      durationMs: 50,
      headers: [],
      body: '{"success":true,"data":{}}',
      size: 26
    })
    expect(unauthFail.pass).toBe(false)
    expect(unauthFail.reason).toContain('Lỗ hổng bảo mật')

    // 3. Unauth probe: 401 -> PASS
    expect(
      evalProbe(unauth, {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        durationMs: 30,
        headers: [],
        body: '{"error":"Unauthorized"}',
        size: 24
      }).pass
    ).toBe(true)

    // 4. Validation probe: 500 crash -> FAIL
    const crash500 = evalProbe(missing, {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 40,
      headers: [],
      body: '{"error":"NullPointerException"}',
      size: 32
    })
    expect(crash500.pass).toBe(false)
    expect(crash500.reason).toContain('HTTP 500')

    // 5. Validation probe: HTTP 200 with business error success:false -> PASS
    expect(
      evalProbe(missing, {
        ok: true,
        status: 200,
        statusText: 'OK',
        durationMs: 40,
        headers: [],
        body: '{"success":false,"code":"ERR_MISSING","message":"Thiếu customerId"}',
        size: 67
      }).pass
    ).toBe(true)
  })

  it('substitutes {{token}}, {{baseUrl}} from live calls and custom environment variables', () => {
    const template = {
      method: 'POST',
      url: '{{baseUrl}}/v1/profile/{{userId}}',
      headers: [{ name: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
      body: '{"org":"{{orgCode}}"}'
    }
    const resolved = resolveEnvVars(template, { userId: 'u88', orgCode: 'VIETTEL' }, [SAMPLE_CALL])
    expect(resolved.url).toBe('https://api.staging.example.com/v1/profile/u88')
    expect(resolved.headers[0].value).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.live')
    expect(resolved.body).toBe('{"org":"VIETTEL"}')
  })

  it('exports and imports Postman Collection v2.1 with folders and variables', () => {
    const req = requestFromCall(SAMPLE_CALL)
    const exported = exportPostmanCollection(
      'My Mobile APIs',
      [{ id: '1', name: 'Orders / Create Order', req, updatedAt: 1000 }],
      { env: 'staging' }
    )
    const imported = importPostmanCollection(exported, 'com.example.app')
    expect(imported.name).toBe('My Mobile APIs')
    expect(imported.vars).toEqual({ env: 'staging' })
    expect(imported.items).toHaveLength(1)
    expect(imported.items[0].name).toBe('Orders / Create Order')
    expect(imported.items[0].req.method).toBe('POST')
    expect(imported.items[0].req.url).toBe(req.url)
  })

  it('evaluates dotted JSON field assertions via checkJsonExpr', () => {
    const body = JSON.stringify({
      code: '00',
      success: true,
      data: {
        status: 'ACTIVE',
        total: 3,
        items: [{ id: 1 }, { id: 2 }]
      }
    })
    expect(checkJsonExpr(body, 'code=00')).toBeNull()
    expect(checkJsonExpr(body, 'data.status == ACTIVE')).toBeNull()
    expect(checkJsonExpr(body, 'data.items.length > 0')).toBeNull()
    expect(checkJsonExpr(body, 'data.total >= 3')).toBeNull()
    expect(checkJsonExpr(body, 'data.status != LOCKED')).toBeNull()
    expect(checkJsonExpr(body, 'code=99')).toContain('JSON "code" = "00"')
    expect(checkJsonExpr(body, 'data.items.length > 5')).toContain('JSON "data.items.length" = 2')
  })
})
