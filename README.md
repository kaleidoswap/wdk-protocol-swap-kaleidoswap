# @kaleidorg/wdk-protocol-swap-kaleidoswap

WDK **SwapProtocol** plugin for [KaleidoSwap](https://kaleidoswap.com) — trade Bitcoin and RGB assets (USDT, XAU₮) on the Lightning Network with atomic swaps.

## Overview

`KaleidoswapProtocol` extends the WDK `SwapProtocol` base class and implements KaleidoSwap's **atomic HTLC swap flow**: quote → init → whitelist → execute → poll. Settlement is atomic over Lightning between the KaleidoSwap maker and the taker's own RGB Lightning Node (RLN): there is no deposit address and no receiver address.

```
WDK host app
  └── new KaleidoswapProtocol(rlnAccount, { baseUrl })
        ├── quoteSwap()       ──HTTPS──▶  KaleidoSwap API  POST /api/v1/market/quote
        ├── swap()            ──HTTPS──▶                   POST /api/v1/swaps/init
        │     ├── rlnAccount.atomicTaker(swapstring)    (whitelist HTLC on taker node)
        │     └──             ──HTTPS──▶                   POST /api/v1/swaps/execute
        └── getOrderStatus()  ──HTTPS──▶                   POST /api/v1/swaps/atomic/status
```

**Key properties:**
- Built on the official [`kaleido-sdk`](https://www.npmjs.com/package/kaleido-sdk) maker client
- **All amounts are raw base units** (satoshis for BTC, the asset's smallest unit for RGB assets), matching the WDK `SwapProtocol` contract. Fractional amounts are rejected, so passing display units fails loudly instead of scaling the trade by 10^precision. Display conversion is the host UI's job — use `getAsset()` to read `precision`.
- `swap()` is bound to the quote: it takes the `rfqId` plus the exact quoted raw amounts
- Asset list and trading pairs cached for 5 minutes

## Installation

```bash
npm install @kaleidorg/wdk-protocol-swap-kaleidoswap
```

Requires `@tetherto/wdk-wallet` as a peer dependency:

```bash
npm install @tetherto/wdk-wallet
```

The protocol needs the taker's RLN account, which must expose `atomicTaker(swapstring)` and `getTakerPubkey()` — e.g. from [`@kaleidorg/wdk-wallet-rln`](https://github.com/kaleidoswap/wdk-wallet-rln):

```bash
npm install @kaleidorg/wdk-wallet-rln
```

## Usage

```js
import RlnWalletManager from '@kaleidorg/wdk-wallet-rln'
import KaleidoswapProtocol from '@kaleidorg/wdk-protocol-swap-kaleidoswap'

const manager = new RlnWalletManager(null, { nodeUrl: 'http://localhost:3001' })
const account = await manager.getAccount()

const protocol = new KaleidoswapProtocol(account, {
  baseUrl: 'https://api.staging.kaleidoswap.com'
})

// 1. Get a quote — amounts in RAW base units
const quote = await protocol.quoteSwap({
  fromAssetId: 'BTC',
  toAssetId: 'rgb:2dkSTbr-...',   // USDT on staging
  fromLayer: 'BTC_LN',
  toLayer: 'RGB_LN',
  fromAmount: 1_000_000            // 1,000,000 sats (0.01 BTC)
})

console.log(quote.tokenInAmount)   // raw sats in (bigint)
console.log(quote.tokenOutAmount)  // raw USDT units out (bigint)
console.log(quote.price)

// 2. Execute the atomic swap for that quote
const swap = await protocol.swap({
  rfqId: quote.rfqId,
  fromAssetId: 'BTC',
  toAssetId: 'rgb:2dkSTbr-...',
  tokenInAmount: quote.tokenInAmount,
  tokenOutAmount: quote.tokenOutAmount
})

console.log(swap.paymentHash)
console.log(swap.accessToken)      // issued once — persist it with the payment hash

// 3. Poll swap status
const status = await protocol.getOrderStatus(swap.paymentHash, swap.accessToken)
console.log(status.status)          // 'Waiting' | 'Pending' | 'Succeeded' | 'Expired' | 'Failed'

// Convert raw amounts for display
const usdt = await protocol.getAsset('rgb:2dkSTbr-...')
console.log(Number(quote.tokenOutAmount) / 10 ** usdt.precision)
```

## API

### Constructor

```js
new KaleidoswapProtocol(account, { baseUrl })
```

| Option | Required | Description |
|--------|----------|-------------|
| `account` | ✅ | Taker's RLN account exposing `atomicTaker()` and `getTakerPubkey()` |
| `baseUrl` | ✅ | KaleidoSwap API base URL (trailing slash is stripped) |

### `quoteSwap(options)`

Returns a price quote without committing to a swap. Provide the amount on **exactly one** leg: `fromAmount` to sell a fixed input, or `toAmount` to buy a fixed output.

```ts
quoteSwap({
  fromAssetId: string,          // ticker or protocol ID (e.g. 'BTC')
  toAssetId: string,            // protocol ID (e.g. 'rgb:2dkSTbr-...')
  fromLayer: string,            // e.g. 'BTC_LN'
  toLayer: string,              // e.g. 'RGB_LN'
  fromAmount?: number | bigint, // raw base units — OR —
  toAmount?: number | bigint    // raw base units
}) → {
  tokenInAmount: bigint,        // raw units in
  tokenOutAmount: bigint,       // raw units out
  rfqId: string,                // quote ID — pass to swap()
  expiresAt: number,            // Unix timestamp (seconds)
  price: number,
  fee: bigint                   // final fee, raw units of the from asset
}
```

### `swap(options)`

Executes an atomic swap for a previously obtained quote:

1. initiates the swap at the maker (`/api/v1/swaps/init`),
2. whitelists the HTLC on the taker's RLN node via `account.atomicTaker(swapstring)`,
3. confirms execution with the taker pubkey (`/api/v1/swaps/execute`).

Whitelisting happens before execution; if it fails, execution is never confirmed.

```ts
swap({
  rfqId: string,                    // from quoteSwap()
  fromAssetId: string,
  toAssetId: string,
  tokenInAmount: number | bigint,   // raw, exactly as quoted
  tokenOutAmount: number | bigint   // raw, exactly as quoted
}) → {
  hash: string,                     // = paymentHash
  paymentHash: string,              // identifies the swap — use with getOrderStatus()
  swapstring: string,               // whitelisted on the taker node
  accessToken: string | null,       // issued once — required to poll status
  status: string,                   // 'Waiting' initially
  tokenInAmount: bigint,
  tokenOutAmount: bigint
}
```

### `getOrderStatus(paymentHash, accessToken?)`

Polls an atomic swap's state (`/api/v1/swaps/atomic/status`).

```ts
getOrderStatus(paymentHash: string, accessToken?: string) → KaleidoswapAtomicSwap
// { payment_hash, status, qty_from, qty_to, from_asset, to_asset, ... }
// status: 'Waiting' | 'Pending' | 'Succeeded' | 'Expired' | 'Failed'
```

### `getAsset(assetId)`

Resolves a ticker or protocol ID to its maker listing, exposing `precision` so hosts can convert raw amounts for display.

```ts
getAsset(assetId: string) → { ticker, name, precision, protocol_ids? }
```

## Asset IDs

KaleidoSwap uses protocol IDs (RGB asset IDs or `'BTC'`) — not tickers:

| Asset | Layer | ID |
|-------|-------|-----|
| BTC | `BTC_LN` | `BTC` |
| USDT | `RGB_LN` | `rgb:2JEUOrsc-...` (staging) |
| XAU₮ | `RGB_LN` | `rgb:Vf25LAhx-...` (staging) |

Use `GET /api/v1/market/assets` to discover IDs for any environment.

## Caching

Asset and pair lists (used by `getAsset()`) are cached in-memory for **5 minutes**. Cache is per-instance.

## Tests

```bash
npm test
```

Unit tests covering `quoteSwap`, `swap`, `getOrderStatus`, `getAsset`, and error paths.

## License

Apache-2.0 — [KaleidoSwap](https://kaleidoswap.com)

---

To build on KaleidoSwap, check the [KaleidoSDK page](https://kaleidoswap.com/products/sdk).
