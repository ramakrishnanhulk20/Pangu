---
title: FAQ
description: Ten questions a judge or an issuer would ask about Pangu.
---

**Is this on mainnet?**
No. This submission runs entirely on Solana devnet, where the whole sale life and every attack have already been proven with real transactions. Mainnet is one deploy script and about 4 SOL away, and it is a decision that was deliberately parked for this submission rather than rushed.

**Can a holder ever get trapped, unable to sell?**
No. Selling back to the pool is a path that reads nothing that could be missing: not the cap, not the approval list, not the price. It is designed so that nothing, including a bug in another part of the program, can block it. This is proven by a real devnet transaction where a revoked wallet still sold successfully, and by 1,330 simulated exit sells inside the randomized attack tests.

**What happens if the price feed goes stale?**
Buying pauses. Every buy in a banded sale needs a price that is fresh, positive, and from the right source; if it is not, the buy is refused. This is also what a closed stock market looks like, since the real feed simply stops updating outside trading hours. Selling is never affected.

**Who can mint more of the sale token?**
Nobody, once the sale is open. A sale refuses to open at all on a token whose minting power has not already been given up. This was a finding from a code review: without it, an issuer could have minted new tokens straight into any wallet, skipping the cap and the approval list entirely.

**What happens when the sale finishes?**
Meteora's own code removes Pangu from the token, permanently, in the very same trade that completes the sale. From that moment the token trades freely with no rules from Pangu at all, and the leftover liquidity moves into a fresh Meteora trading pool automatically.

**Can the issuer change the rules mid-sale?**
No. A sale's cap, its approval mode, and its price ceiling are all set once, when the sale is created, and there is no instruction in the program that can change them afterward.

**Why a cap per wallet, and not per person?**
Because a wallet is the only identity Solana itself can verify. Enforcing a real per-person limit needs a real identity check behind it, which is exactly what the optional credential-based approval mode is for: a wallet only counts as approved if a trusted verifier has issued it a credential. Without that, a cap is a speed bump against casual bot behaviour, not a hard guarantee against one person using many wallets.

**What does a buy cost?**
On Solana devnet, a buy through Pangu's rules runs about 105,000 to 156,000 compute units depending on which rules the sale has turned on, and the transaction itself is under 1,100 bytes, well inside Solana's limits. In practical terms that is a normal Solana transaction fee, nothing unusual.

**What did the forgery attempts on the price feed show?**
Four separate attempts to write a fake or replayed stock price into the account a banded sale reads were all refused on Solana devnet: a signature from a key that was not a real oracle, altered price bytes, a genuine update aimed at the wrong stock, and a genuine but aged-out update replayed later. None of them changed the account or cost more than a transaction fee. Full write-up on the security page.

**What is next?**
A mainnet deployment (the same script, about 4 SOL of mostly refundable rent), and, as a further step named in the project's own plan, a fee-sharing arrangement that would let a verifier who approves buyers earn a share of the issuer's own fees, giving verifiers a real reason to keep approving buyers after the hackathon ends.
