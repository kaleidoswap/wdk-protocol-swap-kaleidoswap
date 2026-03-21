# @kaleidoswap/wdk-protocol-swap-kaleidoswap

WDK **SwapProtocol** plugin for [KaleidoSwap](https://kaleidoswap.com) — trade Bitcoin and RGB assets (USDT, XAU₮) on the Lightning Network.

## Overview

`KaleidoswapProtocol` extends the WDK `SwapProtocol` base class and implements the KaleidoSwap REST API flow: quote → order → deposit → fill. It integrates directly into the WDK account model and can be registered alongside any `WalletManager`.

```
WDK host app
  └── account.registerProtocol('bitcoin', 'kaleidoswap', KaleidoswapProtocol)
        └── KaleidoswapProtocol  ──HTTPS──▶  KaleidoSwap API
                                              /api/v1/market/quote
                                              /api/v1/swaps/orders
                                              /api/v1/swaps/orders/status
```

**Key properties:**
- No extra runtime dependencies — uses native `fetch`
- Asset list and trading pairs cached for 5 minutes
- Amounts converted to/from raw integers using asset precision
- Supports all RGB asset pairs available on KaleidoSwap

## Installation

```bash
npm install @kaleidoswap/wdk-protocol-swap-kaleidoswap
```

Requires `@tetherto/wdk-wallet` as a peer dependency:

```bash
npm install @tetherto/wdk-wallet
```

## Usage

```js
import RlnWalletManager from '@kaleidoswap/wdk-wallet-rln'
import KaleidoswapProtocol from '@kaleidoswap/wdk-protocol-swap-kaleidoswap'

const manager = new RlnWalletManager(null, { nodeUrl: 'http://localhost:3001' })
const account = await manager.getAccount()

// Register the KaleidoSwap swap protocol on the account
account.registerProtocol('bitcoin', 'kaleidoswap', KaleidoswapProtocol, {
  baseUrl: 'https://api.staging.kaleidoswap.com'
})

// Get a quote
const quote = await account.quoteSwap('bitcoin', 'kaleidoswap', {
  fromAssetId: 'BTC',
  toAssetId: 'rgb:2dkSTbr-...',   // USDT on staging
  fromLayer: 'lightning',
  toLayer: 'lightning',
  fromAmount: 0.001                // 0.001 BTC
})

console.log(quote.tokenInAmount)   // raw sats in
console.log(quote.tokenOutAmount)  // raw USDT units out
console.log(quote.price)

// Place a swap order
const swap = await account.swap('bitcoin', 'kaleidoswap', {
  fromAssetId: 'BTC',
  toAssetId: 'rgb:2dkSTbr-...',
  fromLayer: 'lightning',
  toLayer: 'lightning',
  fromAmount: 0.001,
  receiverAddress: '<your-rgb-invoice>',
  receiverAddressFormat: 'rgb_invoice'
})

console.log(swap.orderId)
console.log(swap.depositAddress)    // send funds here to trigger the swap

// Poll order status
const status = await protocol.getOrderStatus(swap.orderId)
console.log(status.status)          // 'Waiting' | 'Filled' | 'Failed'
```

## API

### Constructor

```js
new KaleidoswapProtocol(account, { baseUrl })
```

| Option | Required | Description |
|--------|----------|-------------|
| `baseUrl` | ✅ | KaleidoSwap API base URL |

### `quoteSwap(options)`

Returns a price quote without creating an order.

```ts
quoteSwap({
  fromAssetId: string,     // asset protocol ID or ticker (e.g. 'BTC')
  toAssetId: string,       // asset protocol ID (e.g. 'rgb:2dkSTbr-...')
  fromLayer: string,       // 'lightning' | 'bitcoin'
  toLayer: string,
  fromAmount: number       // human-readable amount (e.g. 0.001 BTC)
}) → {
  tokenInAmount: bigint,   // raw units in
  tokenOutAmount: bigint,  // raw units out
  rfqId: string,           // quote ID (valid ~10 seconds)
  expiresAt: number,
  price: number,
  fee: bigint
}
```

### `swap(options)`

Gets a fresh quote and creates a swap order. Returns a deposit address the caller must fund to trigger the swap.

```ts
swap({
  fromAssetId: string,
  toAssetId: string,
  fromLayer: string,
  toLayer: string,
  fromAmount: number,
  receiverAddress: string,         // where to receive the output asset
  receiverAddressFormat: string    // e.g. 'rgb_invoice' | 'lightning_invoice'
}) → {
  hash: string,                    // order ID
  orderId: string,
  depositAddress: string | null,   // fund this address to trigger the swap
  depositAddressFormat: string | null,
  tokenInAmount: bigint,
  tokenOutAmount: bigint,
  fee: bigint
}
```

### `getOrderStatus(orderId)`

Polls an order's state.

```ts
getOrderStatus(orderId: string) → KaleidoswapOrder
// { id, status, from_asset, to_asset, created_at, ... }
```

## Asset IDs

KaleidoSwap uses protocol IDs (RGB asset IDs or `'BTC'`) — not tickers:

| Asset | Layer | ID |
|-------|-------|-----|
| BTC | lightning | `BTC` |
| USDT | lightning | `rgb:2JEUOrsc-...` (staging) |
| XAU₮ | lightning | `rgb:Vf25LAhx-...` (staging) |

Use `GET /api/v1/market/assets` to discover IDs for any environment.

## Caching

Asset and pair lists are cached in-memory for **5 minutes** to reduce API calls during rapid quoting. Cache is per-instance.

## Tests

```bash
npm test
```

12 unit tests covering `quoteSwap`, `swap`, `getOrderStatus`, and error paths.

## License

Apache-2.0 — [KaleidoSwap](https://kaleidoswap.com)
