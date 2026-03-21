'use strict'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import KaleidoswapProtocol from '../src/swap-kaleidoswap.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BTC_ASSET_ID = 'BTC'
const USDT_ASSET_ID = 'rgb:2dkSTbr-AmBoqH57-zy4NHN8H-StWuPPfb-mFnQUeCY-vEmB37A'

const MOCK_ASSETS = [
  {
    ticker: 'BTC',
    name: 'Bitcoin',
    precision: 8,
    protocol_ids: { BTC: 'BTC' }
  },
  {
    ticker: 'USDT',
    name: 'Tether USD',
    precision: 8,
    protocol_ids: { RGB: USDT_ASSET_ID }
  }
]

const MOCK_PAIRS = [
  {
    base: { ticker: 'BTC', name: 'Bitcoin', precision: 8, protocol_ids: { BTC: 'BTC' } },
    quote: { ticker: 'USDT', name: 'Tether USD', precision: 8, protocol_ids: { RGB: USDT_ASSET_ID } },
    routes: [{ from_layer: 'BTC_LN', to_layer: 'RGB_LN' }]
  }
]

const MOCK_QUOTE = {
  rfq_id: 'rfq-abc-123',
  from_asset: {
    asset_id: BTC_ASSET_ID,
    name: 'Bitcoin',
    ticker: 'BTC',
    layer: 'BTC_LN',
    amount: 1000000,
    precision: 8
  },
  to_asset: {
    asset_id: USDT_ASSET_ID,
    name: 'Tether USD',
    ticker: 'USDT',
    layer: 'RGB_LN',
    amount: 950000000,
    precision: 8
  },
  price: 95000,
  fee: { base_fee: 500, proportional_fee: 0 },
  timestamp: 1700000000,
  expires_at: 1700000060
}

const MOCK_ORDER = {
  id: 'order-xyz-789',
  rfq_id: 'rfq-abc-123',
  status: 'PENDING',
  deposit_address: { address: 'lnbc10u1p...', format: 'BOLT11' }
}

const MOCK_ORDER_STATUS = {
  order: {
    id: 'order-xyz-789',
    rfq_id: 'rfq-abc-123',
    status: 'FILLED',
    from_asset: MOCK_QUOTE.from_asset,
    to_asset: MOCK_QUOTE.to_asset,
    price: MOCK_QUOTE.price,
    deposit_address: MOCK_ORDER.deposit_address
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DUMMY_ACCOUNT = {}

function makeProtocol (baseUrl = 'https://api.staging.kaleidoswap.com') {
  return new KaleidoswapProtocol(DUMMY_ACCOUNT, { baseUrl })
}

/**
 * Builds a mock fetch that returns the given responses in order,
 * one per call. Installs it on globalThis.
 */
function mockFetchSequence (...responses) {
  let call = 0
  globalThis.fetch = jest.fn().mockImplementation(() => {
    const res = responses[call++]
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(res)
    })
  })
}

function mockFetchError (status, body) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KaleidoswapProtocol', () => {
  beforeEach(() => {
    // Reset fetch mock between tests
    globalThis.fetch = undefined
  })

  // -------------------------------------------------------------------------
  describe('constructor', () => {
    test('throws if baseUrl is missing', () => {
      expect(() => new KaleidoswapProtocol(DUMMY_ACCOUNT, {}))
        .toThrow('config.baseUrl is required')
    })

    test('strips trailing slash from baseUrl', () => {
      const p = new KaleidoswapProtocol(DUMMY_ACCOUNT, { baseUrl: 'https://api.example.com/' })
      expect(p._baseUrl).toBe('https://api.example.com')
    })
  })

  // -------------------------------------------------------------------------
  describe('quoteSwap()', () => {
    test('calls the correct endpoints and returns a shaped quote', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },  // GET /api/v1/market/assets
        { pairs: MOCK_PAIRS },    // GET /api/v1/market/pairs
        MOCK_QUOTE                // POST /api/v1/market/quote
      )

      const p = makeProtocol()
      const result = await p.quoteSwap({
        fromAssetId: BTC_ASSET_ID,
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01
      })

      // Shape check
      expect(result.tokenInAmount).toBe(BigInt(MOCK_QUOTE.from_asset.amount))
      expect(result.tokenOutAmount).toBe(BigInt(MOCK_QUOTE.to_asset.amount))
      expect(result.rfqId).toBe('rfq-abc-123')
      expect(result.expiresAt).toBe(MOCK_QUOTE.expires_at)
      expect(result.price).toBe(MOCK_QUOTE.price)
      expect(result.fee).toBe(BigInt(500))

      // The quote POST must carry the right body
      const [, , quoteCall] = globalThis.fetch.mock.calls
      const quoteBody = JSON.parse(quoteCall[1].body)
      expect(quoteBody.from_asset.asset_id).toBe(BTC_ASSET_ID)
      expect(quoteBody.from_asset.layer).toBe('BTC_LN')
      // 0.01 BTC with precision 8 → 1_000_000 sats
      expect(quoteBody.from_asset.amount).toBe(1_000_000)
      expect(quoteBody.to_asset.asset_id).toBe(USDT_ASSET_ID)
      expect(quoteBody.to_asset.layer).toBe('RGB_LN')
    })
  })

  // -------------------------------------------------------------------------
  describe('swap()', () => {
    test('gets a quote then creates an order and returns the shaped result', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },  // GET assets (cache miss)
        { pairs: MOCK_PAIRS },    // GET pairs  (cache miss)
        MOCK_QUOTE,               // POST /api/v1/market/quote
        MOCK_ORDER                // POST /api/v1/swaps/orders
      )

      const p = makeProtocol()
      const result = await p.swap({
        fromAssetId: BTC_ASSET_ID,
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01,
        receiverAddress: 'rgb:invoice-example',
        receiverAddressFormat: 'RGB_INVOICE'
      })

      // SwapResult contract
      expect(result.hash).toBe('order-xyz-789')
      expect(result.orderId).toBe('order-xyz-789')
      expect(result.depositAddress).toBe('lnbc10u1p...')
      expect(result.depositAddressFormat).toBe('BOLT11')
      expect(result.tokenInAmount).toBe(BigInt(MOCK_QUOTE.from_asset.amount))
      expect(result.tokenOutAmount).toBe(BigInt(MOCK_QUOTE.to_asset.amount))
      expect(result.fee).toBe(BigInt(500))

      // Order creation payload
      const [, , , orderCall] = globalThis.fetch.mock.calls
      const orderBody = JSON.parse(orderCall[1].body)
      expect(orderBody.rfq_id).toBe('rfq-abc-123')
      expect(orderBody.from_asset.asset_id).toBe(BTC_ASSET_ID)
      expect(orderBody.to_asset.asset_id).toBe(USDT_ASSET_ID)
      expect(orderBody.receiver_address.address).toBe('rgb:invoice-example')
      expect(orderBody.receiver_address.format).toBe('RGB_INVOICE')
      expect(orderBody.min_onchain_conf).toBe(1)
    })

    test('returns null depositAddress when the order has none', async () => {
      const orderNoDeposit = { id: 'ord-1', rfq_id: 'rfq-1', status: 'PENDING' }
      mockFetchSequence(
        { assets: MOCK_ASSETS },
        { pairs: MOCK_PAIRS },
        MOCK_QUOTE,
        orderNoDeposit
      )

      const p = makeProtocol()
      const result = await p.swap({
        fromAssetId: BTC_ASSET_ID,
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01,
        receiverAddress: 'rgb:invoice-example',
        receiverAddressFormat: 'RGB_INVOICE'
      })

      expect(result.depositAddress).toBeNull()
      expect(result.depositAddressFormat).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  describe('getOrderStatus()', () => {
    test('POSTs to /api/v1/swaps/orders/status and returns the order object', async () => {
      mockFetchSequence(MOCK_ORDER_STATUS)

      const p = makeProtocol()
      const order = await p.getOrderStatus('order-xyz-789')

      expect(order.id).toBe('order-xyz-789')
      expect(order.status).toBe('FILLED')

      const [url, opts] = globalThis.fetch.mock.calls[0]
      expect(url).toContain('/api/v1/swaps/orders/status')
      expect(opts.method).toBe('POST')
      expect(JSON.parse(opts.body)).toEqual({ order_id: 'order-xyz-789' })
    })
  })

  // -------------------------------------------------------------------------
  describe('asset cache TTL', () => {
    test('does not re-fetch assets/pairs within TTL', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },  // 1st load
        { pairs: MOCK_PAIRS },
        MOCK_QUOTE,               // 1st quoteSwap
        MOCK_QUOTE                // 2nd quoteSwap (assets cached — no extra GETs)
      )

      const p = makeProtocol()

      await p.quoteSwap({
        fromAssetId: BTC_ASSET_ID,
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01
      })

      await p.quoteSwap({
        fromAssetId: BTC_ASSET_ID,
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01
      })

      // 4 total calls: 2 for asset/pairs load + 2 for the two quotes
      // If cache didn't work, we'd see 6 (2 loads + 2 loads + 2 quotes)
      expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    })

    test('re-fetches assets/pairs after TTL expires', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },  // 1st load
        { pairs: MOCK_PAIRS },
        MOCK_QUOTE,               // 1st quoteSwap
        { assets: MOCK_ASSETS },  // 2nd load after TTL
        { pairs: MOCK_PAIRS },
        MOCK_QUOTE                // 2nd quoteSwap
      )

      const p = makeProtocol()

      await p.quoteSwap({
        fromAssetId: BTC_ASSET_ID,
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01
      })

      // Expire the cache
      p._cacheTime = 0

      await p.quoteSwap({
        fromAssetId: BTC_ASSET_ID,
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01
      })

      expect(globalThis.fetch).toHaveBeenCalledTimes(6)
    })
  })

  // -------------------------------------------------------------------------
  describe('error handling', () => {
    test('throws a readable error on 4xx with detail field', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: 'Amount below minimum order size' })
      })

      const p = makeProtocol()
      await expect(p.getOrderStatus('bad-id'))
        .rejects.toThrow('KaleidoSwap API error: Amount below minimum order size')
    })

    test('throws a readable error on 5xx with message field', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' })
      })

      const p = makeProtocol()
      await expect(p.getOrderStatus('bad-id'))
        .rejects.toThrow('KaleidoSwap API error: Internal server error')
    })

    test('falls back to HTTP status when body has no detail/message', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error('not JSON'))
      })

      const p = makeProtocol()
      await expect(p.getOrderStatus('bad-id'))
        .rejects.toThrow('KaleidoSwap API error: HTTP 503')
    })

    test('throws when asset is not found in catalog', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },
        { pairs: MOCK_PAIRS }
      )

      const p = makeProtocol()
      await expect(p.quoteSwap({
        fromAssetId: 'UNKNOWN',
        toAssetId: USDT_ASSET_ID,
        fromLayer: 'BTC_LN',
        toLayer: 'RGB_LN',
        fromAmount: 0.01
      })).rejects.toThrow('KaleidoSwap: unknown asset "UNKNOWN"')
    })
  })
})
