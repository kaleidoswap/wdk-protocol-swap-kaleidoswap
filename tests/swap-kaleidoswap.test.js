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
    precision: 6,
    protocol_ids: { RGB: USDT_ASSET_ID }
  }
]

const MOCK_PAIRS = [
  {
    base: { ticker: 'BTC', name: 'Bitcoin', precision: 8, protocol_ids: { BTC: 'BTC' } },
    quote: { ticker: 'USDT', name: 'Tether USD', precision: 6, protocol_ids: { RGB: USDT_ASSET_ID } },
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
    precision: 6
  },
  price: 95000,
  fee: { base_fee: 500, variable_fee: 100, final_fee: 600 },
  timestamp: 1700000000,
  expires_at: 1700000060
}

const MOCK_INIT = {
  payment_hash: 'ph-abc-123',
  swapstring: 'swapstr-abc-123',
  access_token: 'swap_tok_1'
}

const MOCK_EXECUTE = {
  status: 'Waiting'
}

const MOCK_ATOMIC_STATUS = {
  swap: {
    payment_hash: 'ph-abc-123',
    status: 'Succeeded',
    qty_from: 1000000,
    qty_to: 950000000
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Taker-account mock covering the surface swap() relies on. */
function makeAccount () {
  return {
    atomicTaker: jest.fn().mockResolvedValue(undefined),
    getTakerPubkey: jest.fn().mockResolvedValue('02deadbeef')
  }
}

/**
 * Sets up a mock fetch returning a sequence of JSON responses, then creates
 * a new KaleidoswapProtocol. openapi-fetch captures globalThis.fetch at
 * construction time, so the mock must be set BEFORE creating the protocol.
 */
function makeProtocol (account = makeAccount(), baseUrl = 'https://api.staging.kaleidoswap.com') {
  return new KaleidoswapProtocol(account, { baseUrl })
}

/**
 * Builds a mock fetch that returns the given responses in order, one per call.
 * Must be called BEFORE makeProtocol() so openapi-fetch captures the mock.
 */
function mockFetchSequence (...responses) {
  let call = 0
  globalThis.fetch = jest.fn().mockImplementation(() => {
    const res = responses[call++]
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: () => Promise.resolve(res !== undefined ? JSON.stringify(res) : '')
    })
  })
}

function mockFetchError (status, body) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  })
}

/** Returns the URL from the nth fetch call (openapi-fetch passes a Request object). */
function getRequestUrl (callIndex = 0) {
  return globalThis.fetch.mock.calls[callIndex][0].url
}

/** Returns the method from the nth fetch call. */
function getRequestMethod (callIndex = 0) {
  return globalThis.fetch.mock.calls[callIndex][0].method
}

/** Reads and parses the JSON body from the nth fetch call's Request object. */
async function getRequestBody (callIndex = 0) {
  return globalThis.fetch.mock.calls[callIndex][0].json()
}

const QUOTE_OPTS = {
  fromAssetId: BTC_ASSET_ID,
  toAssetId: USDT_ASSET_ID,
  fromLayer: 'BTC_LN',
  toLayer: 'RGB_LN',
  fromAmount: 1_000_000 // raw sats
}

const SWAP_OPTS = {
  rfqId: 'rfq-abc-123',
  fromAssetId: BTC_ASSET_ID,
  toAssetId: USDT_ASSET_ID,
  tokenInAmount: 1_000_000,
  tokenOutAmount: 950_000_000
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KaleidoswapProtocol', () => {
  beforeEach(() => {
    globalThis.fetch = undefined
  })

  // -------------------------------------------------------------------------
  describe('constructor', () => {
    test('throws if baseUrl is missing', () => {
      expect(() => new KaleidoswapProtocol(makeAccount(), {}))
        .toThrow('config.baseUrl is required')
    })

    test('strips trailing slash from baseUrl', () => {
      globalThis.fetch = jest.fn()
      const p = new KaleidoswapProtocol(makeAccount(), { baseUrl: 'https://api.example.com/' })
      expect(p._baseUrl).toBe('https://api.example.com')
    })
  })

  // -------------------------------------------------------------------------
  describe('quoteSwap()', () => {
    test('POSTs the raw sell amount and returns a shaped quote', async () => {
      mockFetchSequence(MOCK_QUOTE)

      const p = makeProtocol()
      const result = await p.quoteSwap(QUOTE_OPTS)

      expect(result.tokenInAmount).toBe(BigInt(MOCK_QUOTE.from_asset.amount))
      expect(result.tokenOutAmount).toBe(BigInt(MOCK_QUOTE.to_asset.amount))
      expect(result.rfqId).toBe('rfq-abc-123')
      expect(result.expiresAt).toBe(MOCK_QUOTE.expires_at)
      expect(result.price).toBe(MOCK_QUOTE.price)
      expect(result.fee).toBe(BigInt(600)) // final_fee, not base_fee

      expect(getRequestUrl()).toContain('/api/v1/market/quote')
      const quoteBody = await getRequestBody()
      expect(quoteBody.from_asset.asset_id).toBe(BTC_ASSET_ID)
      expect(quoteBody.from_asset.layer).toBe('BTC_LN')
      // Raw units pass through untouched — no display-unit scaling.
      expect(quoteBody.from_asset.amount).toBe(1_000_000)
      expect(quoteBody.to_asset.asset_id).toBe(USDT_ASSET_ID)
      expect(quoteBody.to_asset.amount).toBeUndefined()
    })

    test('quotes a fixed buy via toAmount on the to leg', async () => {
      mockFetchSequence(MOCK_QUOTE)

      const p = makeProtocol()
      await p.quoteSwap({ ...QUOTE_OPTS, fromAmount: undefined, toAmount: 950_000_000 })

      const quoteBody = await getRequestBody()
      expect(quoteBody.from_asset.amount).toBeUndefined()
      expect(quoteBody.to_asset.amount).toBe(950_000_000)
    })

    test('rejects when both or neither amount is given', async () => {
      globalThis.fetch = jest.fn()
      const p = makeProtocol()
      await expect(p.quoteSwap({ ...QUOTE_OPTS, toAmount: 1 }))
        .rejects.toThrow(/exactly one of fromAmount or toAmount/)
      await expect(p.quoteSwap({ ...QUOTE_OPTS, fromAmount: undefined }))
        .rejects.toThrow(/exactly one of fromAmount or toAmount/)
    })

    test('rejects fractional amounts (display units passed by mistake)', async () => {
      globalThis.fetch = jest.fn()
      const p = makeProtocol()
      await expect(p.quoteSwap({ ...QUOTE_OPTS, fromAmount: 0.01 }))
        .rejects.toThrow(/raw base units/)
    })
  })

  // -------------------------------------------------------------------------
  describe('swap()', () => {
    test('runs init → whitelist → execute and returns the shaped result', async () => {
      mockFetchSequence(
        MOCK_INIT, // POST /api/v1/swaps/init
        MOCK_EXECUTE // POST /api/v1/swaps/execute
      )

      const account = makeAccount()
      const p = makeProtocol(account)
      const result = await p.swap(SWAP_OPTS)

      expect(result.hash).toBe('ph-abc-123')
      expect(result.paymentHash).toBe('ph-abc-123')
      expect(result.swapstring).toBe('swapstr-abc-123')
      expect(result.accessToken).toBe('swap_tok_1')
      expect(result.status).toBe('Waiting')
      expect(result.tokenInAmount).toBe(BigInt(1_000_000))
      expect(result.tokenOutAmount).toBe(BigInt(950_000_000))

      // init payload carries the rfq_id and the exact quoted raw amounts
      expect(getRequestUrl(0)).toContain('/api/v1/swaps/init')
      const initBody = await getRequestBody(0)
      expect(initBody).toEqual({
        rfq_id: 'rfq-abc-123',
        from_asset: BTC_ASSET_ID,
        from_amount: 1_000_000,
        to_asset: USDT_ASSET_ID,
        to_amount: 950_000_000
      })

      // whitelist happened on the taker node BEFORE execute
      expect(account.atomicTaker).toHaveBeenCalledWith('swapstr-abc-123')
      const whitelistOrder = account.atomicTaker.mock.invocationCallOrder[0]
      const executeCall = globalThis.fetch.mock.invocationCallOrder[1]
      expect(whitelistOrder).toBeLessThan(executeCall)

      // execute payload
      expect(getRequestUrl(1)).toContain('/api/v1/swaps/execute')
      const execBody = await getRequestBody(1)
      expect(execBody).toEqual({
        swapstring: 'swapstr-abc-123',
        taker_pubkey: '02deadbeef',
        payment_hash: 'ph-abc-123'
      })
    })

    test('requires the rfqId from quoteSwap()', async () => {
      globalThis.fetch = jest.fn()
      const p = makeProtocol()
      await expect(p.swap({ ...SWAP_OPTS, rfqId: undefined }))
        .rejects.toThrow(/requires the rfqId/)
    })

    test('rejects fractional amounts before touching the maker', async () => {
      globalThis.fetch = jest.fn()
      const p = makeProtocol()
      await expect(p.swap({ ...SWAP_OPTS, tokenInAmount: 0.01 }))
        .rejects.toThrow(/raw base units/)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    test('does not confirm execution when whitelisting fails', async () => {
      mockFetchSequence(MOCK_INIT, MOCK_EXECUTE)
      const account = makeAccount()
      account.atomicTaker.mockRejectedValue(new Error('node unreachable'))
      const p = makeProtocol(account)

      await expect(p.swap(SWAP_OPTS)).rejects.toThrow('node unreachable')
      // Only init hit the wire — execute never did.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  describe('getOrderStatus()', () => {
    test('POSTs to /api/v1/swaps/atomic/status and returns the swap object', async () => {
      mockFetchSequence(MOCK_ATOMIC_STATUS)
      const p = makeProtocol()
      const swap = await p.getOrderStatus('ph-abc-123', 'swap_tok_1')

      expect(swap.payment_hash).toBe('ph-abc-123')
      expect(swap.status).toBe('Succeeded')

      expect(getRequestUrl()).toContain('/api/v1/swaps/atomic/status')
      expect(getRequestMethod()).toBe('POST')
      const body = await getRequestBody()
      expect(body).toEqual({ payment_hash: 'ph-abc-123', access_token: 'swap_tok_1' })
    })

    test('defaults access_token to empty when not supplied', async () => {
      mockFetchSequence(MOCK_ATOMIC_STATUS)
      const p = makeProtocol()
      await p.getOrderStatus('ph-abc-123')
      const body = await getRequestBody()
      expect(body).toEqual({ payment_hash: 'ph-abc-123', access_token: '' })
    })
  })

  // -------------------------------------------------------------------------
  describe('getAsset()', () => {
    test('resolves by protocol ID and exposes precision', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },
        { pairs: MOCK_PAIRS }
      )
      const p = makeProtocol()
      const asset = await p.getAsset(USDT_ASSET_ID)
      expect(asset.ticker).toBe('USDT')
      expect(asset.precision).toBe(6)
    })

    test('caches assets/pairs within TTL', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },
        { pairs: MOCK_PAIRS }
      )
      const p = makeProtocol()
      await p.getAsset('BTC')
      await p.getAsset('USDT')
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })

    test('throws when asset is not found in catalog', async () => {
      mockFetchSequence(
        { assets: MOCK_ASSETS },
        { pairs: MOCK_PAIRS }
      )
      const p = makeProtocol()
      await expect(p.getAsset('UNKNOWN'))
        .rejects.toThrow('KaleidoSwap: unknown asset "UNKNOWN"')
    })
  })

  // -------------------------------------------------------------------------
  describe('error handling', () => {
    test('throws on 4xx with detail field', async () => {
      mockFetchError(422, { detail: 'Amount below minimum order size' })
      const p = makeProtocol()
      await expect(p.getOrderStatus('bad-id'))
        .rejects.toThrow('Amount below minimum order size')
    })

    test('throws on 5xx with message field', async () => {
      mockFetchError(500, { message: 'Internal server error' })
      const p = makeProtocol()
      await expect(p.getOrderStatus('bad-id'))
        .rejects.toThrow('Internal server error')
    })

    test('throws when error response body cannot be read', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => null },
        text: () => Promise.reject(new Error('network read failure'))
      })
      const p = makeProtocol()
      await expect(p.getOrderStatus('bad-id'))
        .rejects.toThrow()
    })
  })
})
