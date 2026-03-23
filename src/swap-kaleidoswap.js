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
 * WDK SwapProtocol implementation for KaleidoSwap.
 *
 * Flow: quoteSwap() → swap() returns a deposit address → user sends funds →
 * server completes the swap. Poll getOrderStatus() for final state.
 */
export default class KaleidoswapProtocol extends SwapProtocol {
  /**
   * @param {import('@tetherto/wdk-wallet').IWalletAccount} account
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
   * Returns a price quote without committing to a swap.
   *
   * @param {{ fromAssetId: string, toAssetId: string, fromLayer: string, toLayer: string, fromAmount: number }} options
   * @returns {Promise<{ tokenInAmount: bigint, tokenOutAmount: bigint, rfqId: string, expiresAt: number, price: number, fee: bigint }>}
   */
  async quoteSwap (options) {
    const { fromAssetId, toAssetId, fromLayer, toLayer, fromAmount } = options

    const fromAsset = await this._getAsset(fromAssetId)
    const rawAmount = toRaw(fromAmount, fromAsset.precision)

    const quote = await this._maker.getQuote({
      from_asset: {
        asset_id: fromAssetId,
        layer: fromLayer,
        amount: rawAmount
      },
      to_asset: {
        asset_id: toAssetId,
        layer: toLayer
      }
    })

    return {
      tokenInAmount: BigInt(quote.from_asset.amount),
      tokenOutAmount: BigInt(quote.to_asset.amount),
      rfqId: quote.rfq_id,
      expiresAt: quote.expires_at,
      price: quote.price,
      fee: BigInt(quote.fee?.base_fee ?? 0)
    }
  }

  /**
   * Obtains a fresh quote and creates a swap order.
   * Returns the deposit address the user must send funds to.
   *
   * @param {{ fromAssetId: string, toAssetId: string, fromLayer: string, toLayer: string, fromAmount: number, receiverAddress: string, receiverAddressFormat: string }} options
   * @returns {Promise<{ hash: string, orderId: string, depositAddress: string|null, depositAddressFormat: string|null, tokenInAmount: bigint, tokenOutAmount: bigint, fee: bigint }>}
   */
  async swap (options) {
    const {
      fromAssetId,
      toAssetId,
      fromLayer,
      toLayer,
      fromAmount,
      receiverAddress,
      receiverAddressFormat
    } = options

    const fromAsset = await this._getAsset(fromAssetId)
    const toAsset = await this._getAsset(toAssetId)

    const rawAmount = toRaw(fromAmount, fromAsset.precision)

    const quote = await this._maker.getQuote({
      from_asset: {
        asset_id: fromAssetId,
        layer: fromLayer,
        amount: rawAmount
      },
      to_asset: {
        asset_id: toAssetId,
        layer: toLayer
      }
    })

    const order = await this._maker.createSwapOrder({
      rfq_id: quote.rfq_id,
      from_asset: {
        asset_id: quote.from_asset.asset_id,
        name: quote.from_asset.name,
        ticker: quote.from_asset.ticker,
        layer: quote.from_asset.layer,
        amount: quote.from_asset.amount,
        precision: fromAsset.precision
      },
      to_asset: {
        asset_id: quote.to_asset.asset_id,
        name: quote.to_asset.name,
        ticker: quote.to_asset.ticker,
        layer: quote.to_asset.layer,
        amount: quote.to_asset.amount,
        precision: toAsset.precision
      },
      receiver_address: {
        address: receiverAddress,
        format: receiverAddressFormat
      },
      min_onchain_conf: 1
    })

    return {
      hash: order.id,
      orderId: order.id,
      depositAddress: order.deposit_address?.address ?? null,
      depositAddressFormat: order.deposit_address?.format ?? null,
      tokenInAmount: BigInt(quote.from_asset.amount),
      tokenOutAmount: BigInt(quote.to_asset.amount),
      fee: BigInt(quote.fee?.base_fee ?? 0)
    }
  }

  /**
   * Polls the status of an existing swap order.
   *
   * @param {string} orderId
   * @returns {Promise<import('../types/index.d.ts').KaleidoswapOrder>}
   */
  async getOrderStatus (orderId) {
    const response = await this._maker.getSwapOrderStatus({ order_id: orderId })
    return response.order
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

  /** @private */
  async _getAsset (assetId) {
    const { assets } = await this._getAssetsAndPairs()

    const asset = assets.find(a =>
      (a.protocol_ids && Object.values(a.protocol_ids).includes(assetId)) ||
      a.ticker === assetId
    )

    if (!asset) throw new Error(`KaleidoSwap: unknown asset "${assetId}"`)

    return asset
  }
}

/** @param {number} amount @param {number} precision */
function toRaw (amount, precision) {
  return Math.round(amount * Math.pow(10, precision))
}
