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
  /** Amount to sell in display units (e.g. 0.01 for 0.01 BTC) */
  fromAmount: number
}

export interface KaleidoswapQuoteResult {
  /** Raw input amount in smallest unit */
  tokenInAmount: bigint
  /** Raw output amount in smallest unit */
  tokenOutAmount: bigint
  /** RFQ ID — must be passed to swap() if you want to lock in this quote */
  rfqId: string
  /** Quote expiry as Unix timestamp (seconds) */
  expiresAt: number
  /** Price of 1 whole unit of fromAsset expressed in the smallest unit of toAsset */
  price: number
  /** Base fee in smallest unit of fromAsset */
  fee: bigint
}

export interface KaleidoswapSwapOptions extends KaleidoswapQuoteOptions {
  /** Destination address/invoice for the output asset */
  receiverAddress: string
  /** Format of the receiver address (e.g. 'RGB_INVOICE', 'BOLT11', 'BTC_ADDRESS') */
  receiverAddressFormat: string
}

export interface KaleidoswapSwapResult {
  /** Set to orderId to satisfy the base SwapResult contract */
  hash: string
  /** KaleidoSwap order ID */
  orderId: string
  /** Address/invoice the user must send the input funds to */
  depositAddress: string | null
  /** Format of the deposit address */
  depositAddressFormat: string | null
  /** Raw input amount in smallest unit */
  tokenInAmount: bigint
  /** Raw output amount in smallest unit */
  tokenOutAmount: bigint
  /** Base fee in smallest unit */
  fee: bigint
}

export type KaleidoswapOrderStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'FILLED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'

export interface KaleidoswapOrder {
  id: string
  rfq_id: string
  status: KaleidoswapOrderStatus
  from_asset: {
    asset_id: string
    name: string
    ticker: string
    layer: string
    amount: number
    precision: number
  }
  to_asset: {
    asset_id: string
    name: string
    ticker: string
    layer: string
    amount: number
    precision: number
  }
  price: number
  deposit_address?: { address: string; format: string } | null
  payout_address?: { address: string; format: string } | null
}

declare class KaleidoswapProtocol {
  constructor(account: unknown, config: KaleidoswapConfig)

  quoteSwap(options: KaleidoswapQuoteOptions): Promise<KaleidoswapQuoteResult>
  swap(options: KaleidoswapSwapOptions): Promise<KaleidoswapSwapResult>
  getOrderStatus(orderId: string): Promise<KaleidoswapOrder>
}

export default KaleidoswapProtocol
