export interface KaleidoswapConfig {
  /** KaleidoSwap API base URL (e.g. 'https://api.kaleidoswap.com') */
  baseUrl: string
}

export interface KaleidoswapQuoteOptions {
  /** Asset ID of the token to sell (ticker or protocol ID, e.g. 'BTC' or 'rgb:xxx...') */
  fromAssetId: string
  /** Asset ID of the token to buy */
  toAssetId: string
  /** Source layer (e.g. 'BTC_LN') */
  fromLayer: string
  /** Destination layer (e.g. 'RGB_LN') */
  toLayer: string
  /** Amount to sell in RAW base units (e.g. satoshis). Provide either fromAmount or toAmount, not both. */
  fromAmount?: number | bigint
  /** Amount to buy in RAW base units. Provide either fromAmount or toAmount, not both. */
  toAmount?: number | bigint
}

export interface KaleidoswapQuoteResult {
  /** Raw input amount in smallest unit */
  tokenInAmount: bigint
  /** Raw output amount in smallest unit */
  tokenOutAmount: bigint
  /** RFQ ID — pass to swap() together with the quoted raw amounts */
  rfqId: string
  /** Quote expiry as Unix timestamp (seconds) */
  expiresAt: number
  /** Price of 1 whole unit of fromAsset expressed in the smallest unit of toAsset */
  price: number
  /** Total fee (final_fee) in smallest unit of fromAsset */
  fee: bigint
}

export interface KaleidoswapSwapOptions {
  /** RFQ ID from quoteSwap() — the maker binds the swap to this quote */
  rfqId: string
  /** Asset ID of the token to sell */
  fromAssetId: string
  /** Asset ID of the token to buy */
  toAssetId: string
  /** Raw input amount from the quote (tokenInAmount) */
  tokenInAmount: number | bigint
  /** Raw output amount from the quote (tokenOutAmount) */
  tokenOutAmount: number | bigint
}

export interface KaleidoswapSwapResult {
  /** Set to paymentHash to satisfy the base SwapResult contract */
  hash: string
  /** Payment hash identifying the atomic swap — use with getOrderStatus() */
  paymentHash: string
  /** Swapstring whitelisted on the taker node */
  swapstring: string
  /** Per-swap token required to poll getOrderStatus(). Issued once — persist it. */
  accessToken: string | null
  /** Initial swap status ('Waiting' until the maker routes the HTLC) */
  status: string
  /** Raw input amount in smallest unit */
  tokenInAmount: bigint
  /** Raw output amount in smallest unit */
  tokenOutAmount: bigint
}

export type KaleidoswapAtomicSwapStatus =
  | 'Waiting'
  | 'Pending'
  | 'Succeeded'
  | 'Expired'
  | 'Failed'

export interface KaleidoswapAtomicSwap {
  payment_hash?: string
  status: KaleidoswapAtomicSwapStatus | string
  qty_from?: number
  qty_to?: number
  from_asset?: string | null
  to_asset?: string | null
  [key: string]: unknown
}

export interface KaleidoswapAsset {
  ticker: string
  name: string
  precision: number
  protocol_ids?: Record<string, string>
}

declare class KaleidoswapProtocol {
  constructor(account: unknown, config: KaleidoswapConfig)

  quoteSwap(options: KaleidoswapQuoteOptions): Promise<KaleidoswapQuoteResult>
  swap(options: KaleidoswapSwapOptions): Promise<KaleidoswapSwapResult>
  getOrderStatus(paymentHash: string, accessToken?: string): Promise<KaleidoswapAtomicSwap>
  getAsset(assetId: string): Promise<KaleidoswapAsset>
}

export default KaleidoswapProtocol
