// Copyright 2024 KaleidoSwap
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { SwapProtocol } from '@tetherto/wdk-wallet/protocols'
import { KaleidoClient } from 'kaleido-sdk'

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * @typedef {Object} KaleidoswapConfig
 * @property {string} baseUrl - KaleidoSwap API base URL (e.g. 'https://api.kaleidoswap.com')
 */

/**
 * WDK SwapProtocol implementation for KaleidoSwap's atomic HTLC swaps.
 *
 * All amounts cross this API in RAW base units (satoshis for BTC, the
 * asset's smallest unit for RGB assets), matching the WDK SwapProtocol
 * contract and the maker wire format. Display-unit conversion is the
 * host UI's job.
 *
 * Flow: quoteSwap() → swap() initiates the swap at the maker, whitelists
 * the HTLC on the taker's own RLN node (`account`), and confirms
 * execution. Settlement is atomic over Lightning — no deposit address,
 * no receiver address. Poll getOrderStatus(paymentHash) for final state.
 */
export default class KaleidoswapProtocol extends SwapProtocol {
  /**
   * @param {import('@kaleidorg/wdk-wallet-rln').RlnAccount} account - the taker's
   *        RLN account (must expose atomicTaker + getTakerPubkey)
   * @param {KaleidoswapConfig} config
   */
  constructor (account, config = {}) {
    super(account, config)

    if (!config.baseUrl) throw new Error('KaleidoswapProtocol: config.baseUrl is required')

    this._baseUrl = config.baseUrl.replace(/\/$/, '')
    this._maker = KaleidoClient.create({ baseUrl: this._baseUrl }).maker
    this._cache = null
    this._cacheTime = 0
  }

  /**
   * Returns a price quote without committing to a swap. Provide the amount on
   * exactly one leg: `fromAmount` to sell a fixed input, `toAmount` to buy a
   * fixed output — both in RAW base units.
   *
   * @param {{ fromAssetId: string, toAssetId: string, fromLayer: string, toLayer: string, fromAmount?: number | bigint, toAmount?: number | bigint }} options
   * @returns {Promise<{ tokenInAmount: bigint, tokenOutAmount: bigint, rfqId: string, expiresAt: number, price: number, fee: bigint }>}
   */
  async quoteSwap (options) {
    const { fromAssetId, toAssetId, fromLayer, toLayer, fromAmount, toAmount } = options

    if ((fromAmount == null) === (toAmount == null)) {
      throw new Error('KaleidoswapProtocol: provide exactly one of fromAmount or toAmount (raw base units)')
    }

    const fromLeg = { asset_id: fromAssetId, layer: fromLayer }
    const toLeg = { asset_id: toAssetId, layer: toLayer }
    if (fromAmount != null) fromLeg.amount = toRawInt(fromAmount, 'fromAmount')
    else toLeg.amount = toRawInt(toAmount, 'toAmount')

    const quote = await this._maker.getQuote({ from_asset: fromLeg, to_asset: toLeg })

    return {
      tokenInAmount: BigInt(quote.from_asset.amount),
      tokenOutAmount: BigInt(quote.to_asset.amount),
      rfqId: quote.rfq_id,
      expiresAt: quote.expires_at,
      price: quote.price,
      fee: BigInt(quote.fee?.final_fee ?? quote.fee?.base_fee ?? 0)
    }
  }

  /**
   * Executes an atomic swap for a previously obtained quote:
   * initiates at the maker, whitelists the HTLC on the taker's RLN node,
   * then confirms execution. Amounts must be the RAW base-unit amounts
   * returned by quoteSwap() — the maker binds them to the rfqId.
   *
   * The returned `accessToken` is issued ONCE at initiation and is required
   * to poll getOrderStatus() — persist it alongside the payment hash.
   *
   * @param {{ rfqId: string, fromAssetId: string, toAssetId: string, tokenInAmount: number | bigint, tokenOutAmount: number | bigint }} options
   * @returns {Promise<{ hash: string, paymentHash: string, swapstring: string, accessToken: string | null, status: string, tokenInAmount: bigint, tokenOutAmount: bigint }>}
   */
  async swap (options) {
    const { rfqId, fromAssetId, toAssetId, tokenInAmount, tokenOutAmount } = options

    if (!rfqId) throw new Error('KaleidoswapProtocol: swap() requires the rfqId from quoteSwap()')

    const init = await this._maker.initSwap({
      rfq_id: rfqId,
      from_asset: fromAssetId,
      from_amount: toRawInt(tokenInAmount, 'tokenInAmount'),
      to_asset: toAssetId,
      to_amount: toRawInt(tokenOutAmount, 'tokenOutAmount')
    })

    // Whitelist BEFORE confirming execution: once the maker starts the swap
    // it routes the HTLC immediately, and an un-whitelisted node rejects it.
    await this._account.atomicTaker(init.swapstring)
    const takerPubkey = await this._account.getTakerPubkey()

    const confirmed = await this._maker.executeSwap({
      swapstring: init.swapstring,
      taker_pubkey: takerPubkey,
      payment_hash: init.payment_hash
    })

    return {
      hash: init.payment_hash,
      paymentHash: init.payment_hash,
      swapstring: init.swapstring,
      accessToken: init.access_token ?? null,
      // /swaps/execute responds with an HTTP-style {status: 200, message} —
      // the swap itself starts in 'Waiting'; poll getOrderStatus for truth.
      status: 'Waiting',
      tokenInAmount: BigInt(options.tokenInAmount),
      tokenOutAmount: BigInt(options.tokenOutAmount)
    }
  }

  /**
   * Polls the status of an atomic swap.
   *
   * @param {string} paymentHash
   * @param {string} [accessToken] - Per-swap token returned by swap()
   * @returns {Promise<import('../types/index.d.ts').KaleidoswapAtomicSwap>}
   */
  async getOrderStatus (paymentHash, accessToken = '') {
    const response = await this._maker.getAtomicSwapStatus({
      payment_hash: paymentHash,
      access_token: accessToken
    })
    return response.swap ?? response
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** @private */
  async _getAssetsAndPairs () {
    const now = Date.now()

    if (this._cache && (now - this._cacheTime) < CACHE_TTL) {
      return this._cache
    }

    const [assetsResponse, pairsResponse] = await Promise.all([
      this._maker.listAssets(),
      this._maker.listPairs()
    ])

    this._cache = { assets: assetsResponse.assets, pairs: pairsResponse.pairs }
    this._cacheTime = now

    return this._cache
  }

  /**
   * Resolves an asset (ticker or protocol ID) to its maker listing, exposing
   * `precision` so hosts can convert raw amounts for display.
   *
   * @param {string} assetId
   * @returns {Promise<{ ticker: string, name: string, precision: number, protocol_ids?: Record<string, string> }>}
   */
  async getAsset (assetId) {
    const { assets } = await this._getAssetsAndPairs()

    const asset = assets.find(a =>
      (a.protocol_ids && Object.values(a.protocol_ids).includes(assetId)) ||
      a.ticker === assetId
    )

    if (!asset) throw new Error(`KaleidoSwap: unknown asset "${assetId}"`)

    return asset
  }
}

/**
 * Coerces a raw base-unit amount to a safe positive integer for the wire.
 * Rejects fractions: a fractional value here means the caller passed display
 * units, which silently scales the order by 10^precision.
 *
 * @param {number | bigint} amount
 * @param {string} field
 * @returns {number}
 */
function toRawInt (amount, field) {
  const n = Number(amount)
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`KaleidoswapProtocol: ${field} must be a positive integer in raw base units, got ${String(amount)}`)
  }
  return n
}
